import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  loadConfig,
  loadMeter,
  loadQuota,
  loadTheme,
  renderHud,
  sampleFiles,
  saveQuota,
  schedule,
  upsertClaimant,
  viewFor,
} from "./kernel.mjs";

const ADAPTER = "claude-code";
const METER_THROTTLE_MS = 10 * 1000;
const LIVENESS_THROTTLE_MS = 15 * 1000;
const HISTORY_LIMIT = 96;
const STALE_READING_MS = 10 * 60 * 1000;
const MAX_SUBAGENT_DEPTH = 4;
const WRAP_TIMEOUT_MS = 2000;

function readInput() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw ? { payload: JSON.parse(raw), raw } : null;
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

function normalizeWindows(rateLimits) {
  const windows = {};
  for (const key of ["five_hour", "seven_day", "spend_limit"]) {
    const window = rateLimits?.[key];
    if (!window || typeof window.used_percentage !== "number") continue;
    windows[key] = { usedPercent: window.used_percentage, resetsAt: window.resets_at };
  }
  return windows;
}

function buildReading(payload, now) {
  const windows = normalizeWindows(payload.rate_limits);
  if (Object.keys(windows).length === 0) return null;
  return { at: now, source: "statusline", sessionId: String(payload.session_id ?? ""), windows, history: [] };
}

function persistReading(reading, metered) {
  const previous = loadQuota(ADAPTER);
  const history = Array.isArray(previous?.history) ? previous.history : [];
  const last = history[history.length - 1];
  const point = {
    at: reading.at,
    metered,
    five_hour: reading.windows.five_hour?.usedPercent ?? null,
    seven_day: reading.windows.seven_day?.usedPercent ?? null,
  };
  const changed =
    !last ||
    last.five_hour !== point.five_hour ||
    last.seven_day !== point.seven_day ||
    reading.at - last.at > 10 * 60 * 1000;
  saveQuota(ADAPTER, {
    ...reading,
    meteredTokens: metered,
    history: changed ? [...history, point].slice(-HISTORY_LIMIT) : history,
  });
}

function meterSession(payload, now) {
  const id = String(payload.session_id ?? "");
  if (!id) return;
  const record = loadMeter(ADAPTER, id);
  if (now - (record.meteredAt ?? 0) < METER_THROTTLE_MS) return;
  const files = transcriptFiles(payload);
  if (files.length === 0) return;
  sampleFiles(ADAPTER, id, files, now);
}

function keepAlive(payload, now) {
  const id = String(payload.session_id ?? "");
  if (!id) return;
  const project = payload.cwd || payload.workspace?.current_dir || "";
  const label = project ? path.basename(project) : String(payload.session_name || "session");
  const current = schedule(ADAPTER, now);
  const view = viewFor(current, id);
  if (view && now - view.claimant.lastSeen < LIVENESS_THROTTLE_MS && view.claimant.label === label) return;
  upsertClaimant(ADAPTER, id, { project, label });
}

function wrappedOutput(config, raw) {
  const command = config.wrappedStatusLine;
  if (!command) return "";
  try {
    return String(
      execSync(command, { input: raw, encoding: "utf8", timeout: WRAP_TIMEOUT_MS, stdio: ["pipe", "pipe", "ignore"] }),
    ).trim();
  } catch {
    return "";
  }
}

function run() {
  const input = readInput();
  if (!input) return;
  const { payload, raw } = input;
  const now = Date.now();
  const config = loadConfig();

  keepAlive(payload, now);
  meterSession(payload, now);

  const reading = buildReading(payload, now);
  const plan = schedule(ADAPTER, now, "five_hour", reading);
  if (reading) persistReading(reading, plan.totalWeighted);

  const view = viewFor(plan, String(payload.session_id ?? ""));
  const theme = loadTheme(config.theme.hud);
  const quota = {};
  for (const key of ["five_hour", "seven_day", "spend_limit"]) {
    const window = plan.quota?.windows?.[key];
    if (window && (typeof window.resetsAt !== "number" || window.resetsAt * 1000 > now)) quota[key] = window;
  }

  const line = renderHud(
    config.layout.hud,
    {
      label: view?.claimant.label || (payload.cwd ? path.basename(payload.cwd) : "session"),
      target: view?.allocation.target ?? 1,
      observed: view?.observed ?? 0,
      used: view?.attributedPercent ?? null,
      pressure: view?.pressure.value ?? 0,
      priority: view?.claimant.priority ?? "normal",
      quota,
      stale: !reading && Object.keys(quota).length > 0 && now - (plan.quota?.at ?? 0) > STALE_READING_MS,
      now,
    },
    theme,
  );

  const prefix = wrappedOutput(config, raw);
  process.stdout.write(prefix ? `${prefix}  ${line}\n` : `${line}\n`);
}

try {
  run();
} catch {}
process.exit(0);
