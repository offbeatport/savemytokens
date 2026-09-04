import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  windowBounds,
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

const WINDOW_SPAN_MS = { five_hour: 5 * 3600_000, seven_day: 7 * 24 * 3600_000, spend_limit: 31 * 24 * 3600_000 };
const SLACK_MS = 6 * 3600_000;

function plausibleReset(key, resetsAt, now) {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const ms = resetsAt * 1000;
  if (ms <= now) return null;
  if (ms - now > (WINDOW_SPAN_MS[key] ?? WINDOW_SPAN_MS.seven_day) + SLACK_MS) return null;
  return resetsAt;
}

function mergeWindows(stored, incoming, now) {
  const merged = {};
  for (const [key, window] of Object.entries(stored ?? {})) {
    if (typeof window?.usedPercent !== "number") continue;
    if (window.resetsAt !== undefined && plausibleReset(key, window.resetsAt, now) === null) continue;
    merged[key] = window;
  }
  for (const [key, window] of Object.entries(incoming)) {
    if (window.resetsAt !== undefined && plausibleReset(key, window.resetsAt, now) === null) continue;
    const previous = merged[key];
    if (!previous) {
      merged[key] = { ...window, at: now };
      continue;
    }
    const older = (window.resetsAt ?? 0) < (previous.resetsAt ?? 0);
    if (older) continue;
    const sameWindow = (window.resetsAt ?? 0) === (previous.resetsAt ?? 0);
    merged[key] = {
      ...window,
      usedPercent: sameWindow ? Math.max(previous.usedPercent, window.usedPercent) : window.usedPercent,
      at: now,
    };
  }
  return merged;
}

function buildReading(payload, now) {
  const incoming = normalizeWindows(payload.rate_limits);
  const stored = loadQuota(ADAPTER);
  const windows = mergeWindows(stored?.windows, incoming, now);
  if (Object.keys(windows).length === 0) return null;
  if (Object.keys(incoming).length === 0 && stored) return { ...stored, windows };
  return {
    at: now,
    source: "statusline",
    sessionId: String(payload.session_id ?? ""),
    windows,
    history: Array.isArray(stored?.history) ? stored.history : [],
  };
}

function persistReading(reading, metered, turnAt) {
  const previous = loadQuota(ADAPTER);
  const history = Array.isArray(previous?.history) ? previous.history : [];
  const last = history[history.length - 1];
  const point = {
    at: reading.at,
    metered,
    turnAt,
    five_hour: reading.windows.five_hour?.usedPercent ?? null,
    seven_day: reading.windows.seven_day?.usedPercent ?? null,
  };
  const changed =
    !last ||
    last.five_hour !== point.five_hour ||
    last.seven_day !== point.seven_day ||
    last.turnAt !== point.turnAt ||
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
  upsertClaimant(ADAPTER, id, { project, label, heartbeat: now });
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
  const fresh = Object.keys(normalizeWindows(payload.rate_limits)).length > 0;
  const plan = schedule(ADAPTER, now, "five_hour", reading);
  if (reading && fresh) {
    let turnAt = 0;
    for (const claimant of plan.claimants) turnAt = Math.max(turnAt, loadMeter(ADAPTER, claimant.claimant.id).lastAt ?? 0);
    persistReading(reading, plan.totalWeighted, turnAt);
  }

  const view = viewFor(plan, String(payload.session_id ?? ""));
  const theme = loadTheme(config.theme.hud);
  const quota = {};
  for (const key of ["five_hour", "seven_day", "spend_limit"]) {
    const window = plan.quota?.windows?.[key];
    if (window && (window.resetsAt === undefined || plausibleReset(key, window.resetsAt, now) !== null)) quota[key] = window;
  }

  const bounds = windowBounds(plan.quota, "five_hour", now);
  const history = (plan.quota?.history ?? [])
    .filter((point) => typeof point.five_hour === "number" && point.at >= bounds.from)
    .map((point) => point.five_hour);
  const rate = (() => {
    const points = (plan.quota?.history ?? []).filter((point) => typeof point.five_hour === "number" && point.at >= now - 45 * 60 * 1000);
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || last.at <= first.at) return null;
    return ((last.five_hour - first.five_hour) / (last.at - first.at)) * 3600000;
  })();

  const line = renderHud(
    config.hud?.segments ?? config.layout.hud,
    {
      label: view?.claimant.label || (payload.cwd ? path.basename(payload.cwd) : "session"),
      target: view?.allocation.target ?? 1,
      observed: view?.observed ?? 0,
      used: view?.attributedPercent ?? null,
      pressure: view?.pressure.value ?? 0,
      priority: view?.claimant.priority ?? "normal",
      quota,
      history,
      rate,
      from: bounds.from,
      to: bounds.to,
      stale: !fresh && Object.keys(quota).length > 0 && now - (plan.quota?.at ?? 0) > STALE_READING_MS,
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
