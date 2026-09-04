import fs from "node:fs";
import path from "node:path";
import {
  addDeferred,
  adviceFor,
  consumeSignal,
  deferredAdvice,
  loadConfig,
  loadDeferred,
  loadMeter,
  openingAdvice,
  policyFor,
  sampleFiles,
  schedule,
  stageFor,
  upsertClaimant,
  viewFor,
  writeJson,
  readJson,
  HOME,
} from "./kernel.mjs";

const ADAPTER = "claude-code";
const NUDGE_FILE = path.join(HOME, "nudges.json");
const NUDGE_THRESHOLD = 150000;
const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;
const NUDGE_HORIZON_TURNS = 10;
const NUDGE_TAIL_BYTES = 262144;
const RATE_PER_TOKEN = 5 / 1000000;
const CACHE_READ_WEIGHT = 0.1;
const MAX_SUBAGENT_DEPTH = 4;
const ANAPHORIC =
  /^\s*(ok|okay|now|also|and|then|next|again|yes|no|nope|yep|same|do the same|the other|these|those|them|it|that|this|continue|carry on|keep going|go on|more|another|fix (it|that|this)|try again|redo|revert|undo|hmm|wait|great|nice|thanks|perfect|good)\b/i;

function readInput() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function nested(dir, depth, out) {
  if (depth > MAX_SUBAGENT_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) nested(full, depth + 1, out);
    else if (entry.name.endsWith(".jsonl")) out.push(full);
  }
}

function transcriptFiles(payload) {
  const transcript = payload.transcript_path;
  if (typeof transcript !== "string" || !transcript) return [];
  const files = [transcript];
  nested(path.join(path.dirname(transcript), String(payload.session_id ?? "")), 1, files);
  return files;
}

function projectOf(payload) {
  return payload.cwd || payload.workspace?.current_dir || "";
}

function labelOf(project) {
  return project ? path.basename(project) : "session";
}

function settingsFor(project) {
  const config = loadConfig();
  return {
    preserve: config.preserveFor?.[project] ?? config.preserveFor?.default ?? [],
    policy: policyFor(config, project),
    custom: config.customAdvice?.[project] ?? config.customAdvice?.default ?? "",
  };
}

function guidance(id, project, now) {
  const plan = schedule(ADAPTER, now);
  const view = viewFor(plan, id);
  if (!view) return "";
  const { preserve, policy, custom } = settingsFor(project);
  const stage = stageFor(view.pressure.value, policy);
  if (stage === 0) return "";
  const advice = view.claimant.advice ?? { stage: 0, window: 0 };
  if (advice.window === plan.windowId && advice.stage >= stage) return "";
  upsertClaimant(ADAPTER, id, { advice: { stage, at: now, window: plan.windowId } });
  return adviceFor(stage, {
    target: view.allocation.target,
    observed: view.observed,
    pressure: view.pressure.value,
    basis: view.pressure.basis,
    preserve,
    policy,
    custom,
  });
}

function selfContained(prompt) {
  const text = String(prompt || "").trim();
  return text.length >= 40 && !ANAPHORIC.test(text);
}

function tailContext(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return 0;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - NUDGE_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes('"usage"')) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = record?.message?.usage;
      if (!usage) continue;
      const total =
        (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      if (total > 0) return total;
    }
    return 0;
  } catch {
    return 0;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}

function deadCarryNudge(payload, now) {
  if (!selfContained(payload.prompt)) return "";
  const transcript = payload.transcript_path;
  if (typeof transcript !== "string" || !fs.existsSync(transcript)) return "";
  const context = tailContext(transcript);
  if (context < NUDGE_THRESHOLD) return "";

  const state = readJson(NUDGE_FILE, null);
  const events = Array.isArray(state?.events) ? state.events : [];
  const previous = events.filter((event) => event.session === payload.session_id).pop();
  if (previous && now - previous.at < NUDGE_COOLDOWN_MS) return "";

  const horizon = context * CACHE_READ_WEIGHT * RATE_PER_TOKEN * NUDGE_HORIZON_TURNS;
  events.push({ at: now, session: payload.session_id, context, usd: horizon });
  writeJson(NUDGE_FILE, { installedAt: state?.installedAt ?? now, events: events.slice(-500) });

  return `[savemytokens] This reads as a new task and ${Math.round(context / 1000)}k tokens of earlier work are still in context, about $${horizon.toFixed(2)} per ${NUDGE_HORIZON_TURNS} turns from here. Open your reply with one short line saying so, and that /clear or a fresh session drops it. Then do what was asked.`;
}

function run() {
  const event = process.argv[2] ?? "";
  const payload = readInput();
  if (!payload || !payload.session_id) return;

  const now = Date.now();
  const id = String(payload.session_id);
  const project = projectOf(payload);
  const files = transcriptFiles(payload);
  const lines = [];

  if (event === "session-end") {
    if (files.length > 0) sampleFiles(ADAPTER, id, files, now);
    const { defers } = consumeSignal(ADAPTER, id);
    addDeferred(ADAPTER, project || loadMeter(ADAPTER, id).project, defers, id, now);
    upsertClaimant(ADAPTER, id, { state: "done", endedAt: now, signal: "SESSION_END" });
    return;
  }

  upsertClaimant(ADAPTER, id, {
    project,
    label: labelOf(project),
    ...(event === "session-start" ? { state: "active", endedAt: null, signal: null } : {}),
  });

  if (files.length > 0) sampleFiles(ADAPTER, id, files, now);

  if (event === "session-start") {
    const view = viewFor(schedule(ADAPTER, now), id);
    const { preserve, policy } = settingsFor(project);
    if (policy.name !== "off") {
      lines.push(openingAdvice({ target: view ? view.allocation.target : 1, preserve, policy }));
    }
    const deferred = loadDeferred(ADAPTER, project, now);
    if (deferred.length > 0) lines.push(deferredAdvice(deferred));
  }

  if (event === "prompt") {
    const record = loadMeter(ADAPTER, id);
    const view = viewFor(schedule(ADAPTER, now), id);
    upsertClaimant(ADAPTER, id, {
      prompt: String(payload.prompt ?? record.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      ...(view && view.claimant.state !== "active" ? { state: "active", endedAt: null, signal: null } : {}),
    });
    const advice = guidance(id, project, now);
    if (advice) lines.push(advice);
    const nudge = deadCarryNudge(payload, now);
    if (nudge) lines.push(nudge);
  }

  if (event === "stop") {
    const { signal, defers } = consumeSignal(ADAPTER, id);
    addDeferred(ADAPTER, project || loadMeter(ADAPTER, id).project, defers, id, now);
    if (signal === "DONE") upsertClaimant(ADAPTER, id, { state: "done", signal, endedAt: now });
    else if (signal === "NEEDS_MORE") upsertClaimant(ADAPTER, id, { state: "needs-more", signal });
    else if (signal === "BLOCKED") upsertClaimant(ADAPTER, id, { state: "blocked", signal });
    return;
  }

  if (lines.length > 0) process.stdout.write(lines.join("\n\n") + "\n");
}

try {
  run();
} catch {}
process.exit(0);
