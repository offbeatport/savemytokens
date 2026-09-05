import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = process.env.SAVEMYTOKENS_HOME || path.join(os.homedir(), ".savemytokens");
export const CLAIMANT_DIR = path.join(HOME, "claimants");
export const METER_DIR = path.join(HOME, "meter");
export const QUOTA_DIR = path.join(HOME, "quota");
export const THEME_DIR = path.join(HOME, "themes");
export const HOOKS_DIR = path.join(HOME, "hooks");
export const DEFER_DIR = path.join(HOME, "deferred");
export const PROJECT_DIR = path.join(HOME, "projects");
export const CONFIG_FILE = path.join(HOME, "config.json");

export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;
export const WINDOW_MS = { five_hour: FIVE_HOUR_MS, seven_day: SEVEN_DAY_MS, spend_limit: SEVEN_DAY_MS };
export const WINDOW_LABEL = { five_hour: "5h", seven_day: "7d", spend_limit: "spend" };

const BUCKET_MS = 5 * 60 * 1000;
const RETENTION_MS = 9 * 24 * 60 * 60 * 1000;
const CLAIMANT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SEEN_LIMIT = 400;
const LOCKOUT_GAP_MS = 5 * 60 * 1000;
const STALE_MS = 45 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const RECENT_MS = 24 * 60 * 60 * 1000;
const DEFER_LIMIT = 12;
const DEFER_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const CHUNK = 1 << 20;
const MAX_BACKFILL = 32 * 1024 * 1024;
const WEIGHTS = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
const EPSILON = 1e-9;

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function listJson(dir) {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

export const DEFAULT_CONFIG = {
  version: 1,
  createdAt: 0,
  preferencesSetAt: 0,
  offeredInstallAt: 0,
  theme: { tui: "default", hud: "default" },
  layout: { hud: "allocation" },
  policy: "finish",
  policyFor: {},
  columns: ["allocation", "used", "priority", "last prompt"],
  hud: { segments: ["project", "pair", "5h", "reset"] },
  preserveFor: {},
  customAdvice: {},
  wrappedStatusLine: null,
};

const COLUMN_RENAMES = { target: "allocation", "of target": "used", used: null, share: "share" };

function migrateColumns(stored) {
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_CONFIG.columns;
  if (stored.every((name) => COLUMNS.includes(name))) return stored;
  const out = [];
  for (const name of stored) {
    const mapped = name in COLUMN_RENAMES ? COLUMN_RENAMES[name] : name;
    if (mapped && COLUMNS.includes(mapped) && !out.includes(mapped)) out.push(mapped);
  }
  return out.length > 0 ? out : DEFAULT_CONFIG.columns;
}

export function loadConfig() {
  const stored = readJson(CONFIG_FILE, null);
  if (!stored || typeof stored !== "object") return { ...DEFAULT_CONFIG, createdAt: Date.now() };
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    theme: {
      ...DEFAULT_CONFIG.theme,
      ...(stored.theme || {}),
      ...(stored.theme?.tui && THEME_RENAMES[stored.theme.tui] ? { tui: THEME_RENAMES[stored.theme.tui] } : {}),
      ...(stored.theme?.hud && THEME_RENAMES[stored.theme.hud] ? { hud: THEME_RENAMES[stored.theme.hud] } : {}),
    },
    layout: { ...DEFAULT_CONFIG.layout, ...(stored.layout || {}) },
    columns: migrateColumns(stored.columns),
    hud: {
      segments:
        Array.isArray(stored.hud?.segments) && stored.hud.segments.length > 0
          ? stored.hud.segments
          : presetSegments(stored.layout?.hud) ?? DEFAULT_CONFIG.hud.segments,
    },
    policyFor: { ...(stored.policyFor || {}) },
    preserveFor: { ...(stored.preserveFor || {}) },
    customAdvice: { ...(stored.customAdvice || {}) },
  };
}

export function saveConfig(config) {
  return writeJson(CONFIG_FILE, config);
}

export function claimantFile(adapter, id) {
  return path.join(CLAIMANT_DIR, adapter, `${id}.json`);
}

export function meterFile(adapter, id) {
  return path.join(METER_DIR, adapter, `${id}.json`);
}

export function quotaFile(adapter) {
  return path.join(QUOTA_DIR, `${adapter}.json`);
}

function blankClaimant(adapter, id, now) {
  return {
    schema: 1,
    adapter,
    id,
    resourceId: `${adapter}:five_hour`,
    label: "",
    project: "",
    share: null,
    priority: "normal",
    cap: null,
    state: "active",
    startedAt: now,
    lastSeen: now,
    endedAt: null,
    heartbeat: 0,
    pinned: false,
    parked: false,
    prompt: "",
    signal: null,
    advice: { stage: 0, at: 0, window: 0 },
  };
}

export function loadClaimant(adapter, id) {
  return readJson(claimantFile(adapter, id), null);
}

export function upsertClaimant(adapter, id, patch = {}) {
  const now = Date.now();
  const current = loadClaimant(adapter, id) || blankClaimant(adapter, id, now);
  const next = {
    ...blankClaimant(adapter, id, now),
    ...current,
    ...patch,
    adapter,
    id,
    lastSeen: typeof patch.lastSeen === "number" ? patch.lastSeen : now,
  };
  writeJson(claimantFile(adapter, id), next);
  return next;
}

const SEEN_MS = 30 * 24 * 60 * 60 * 1000;

function lastPromptIn(file) {
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - 96 * 1024);
    const handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    fs.closeSync(handle);
    const lines = buffer.toString("utf8").split("\n");
    for (let at = lines.length - 1; at >= 0; at--) {
      const line = lines[at];
      if (!line || line[0] !== "{") continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.type !== "user" || row.isMeta) continue;
      const content = row.message?.content;
      const text = typeof content === "string" ? content : content?.find?.((part) => part.type === "text")?.text;
      if (typeof text === "string" && text.trim() && !text.startsWith("<")) return text.trim().replace(/\s+/g, " ").slice(0, 200);
    }
  } catch {}
  return "";
}

function cwdOf(file) {
  try {
    const handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(8192);
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
    fs.closeSync(handle);
    for (const line of buffer.toString("utf8", 0, read).split("\n")) {
      if (!line || line[0] !== "{") continue;
      try {
        const row = JSON.parse(line);
        if (typeof row.cwd === "string" && row.cwd) return row.cwd;
      } catch {}
    }
  } catch {}
  return "";
}

export function seenProjects(root, now = Date.now(), limit = 60) {
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return out;
  }
  for (const dir of dirs) {
    const full = path.join(root, dir.name);
    let newest = null;
    try {
      for (const name of fs.readdirSync(full)) {
        if (!name.endsWith(".jsonl")) continue;
        const file = path.join(full, name);
        const at = fs.statSync(file).mtimeMs;
        if (!newest || at > newest.at) newest = { file, at };
      }
    } catch {
      continue;
    }
    if (!newest || now - newest.at > SEEN_MS) continue;
    out.push({ dir: full, file: newest.file, at: newest.at });
  }
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, limit).map((entry) => {
    const cwd = cwdOf(entry.file);
    return {
      project: cwd || entry.dir,
      label: cwd ? "" : (path.basename(entry.dir).split("-").filter(Boolean).pop() ?? ""),
      lastSeen: entry.at,
      prompt: lastPromptIn(entry.file),
    };
  });
}

export function loadClaimants(adapter) {
  const dir = path.join(CLAIMANT_DIR, adapter);
  const cutoff = Date.now() - CLAIMANT_RETENTION_MS;
  const out = [];
  for (const name of listJson(dir)) {
    const record = readJson(path.join(dir, name), null);
    if (!record || typeof record !== "object") continue;
    if ((record.lastSeen ?? 0) < cutoff && !record.pinned) {
      try {
        fs.rmSync(path.join(dir, name));
      } catch {}
      continue;
    }
    out.push({ ...blankClaimant(adapter, record.id ?? name.slice(0, -5), record.startedAt ?? 0), ...record });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export function heartbeatsLive(claimants, now = Date.now()) {
  let latest = 0;
  for (const claimant of claimants) latest = Math.max(latest, claimant.heartbeat ?? 0);
  return latest > 0 && now - latest <= HEARTBEAT_MS;
}

export function isStale(claimant, now = Date.now(), strict = false) {
  const beat = claimant.heartbeat ?? 0;
  if (now - (claimant.lastSeen ?? 0) <= HEARTBEAT_MS) return false;
  if (beat > 0 || strict) return now - beat > HEARTBEAT_MS;
  return now - (claimant.lastSeen ?? 0) > STALE_MS;
}

export function bucketFor(claimant, now = Date.now(), strict = false) {
  if (claimant.parked) return "parked";
  const state = effectiveState(claimant, now, strict);
  if (state === "active" || state === "needs-more") return "active";
  if (now - (claimant.lastSeen ?? 0) <= RECENT_MS) return "recent";
  return "parked";
}

export function effectiveState(claimant, now = Date.now(), strict = false) {
  if (claimant.state === "done" || claimant.state === "blocked") return claimant.state;
  if (claimant.endedAt) return "done";
  if (isStale(claimant, now, strict)) return "done";
  return claimant.state;
}

export function projectKey(project) {
  return String(project || "unknown").replace(/[^a-zA-Z0-9]/g, "-").slice(-90);
}

function blankProject(project) {
  return { schema: 1, project, label: project ? project.split("/").filter(Boolean).pop() : "unknown", share: null, priority: "normal", cap: null, pinned: false, parked: false, kept: null };
}

export function loadProject(adapter, project) {
  const stored = readJson(path.join(PROJECT_DIR, adapter, `${projectKey(project)}.json`), null);
  const record = { ...blankProject(project), ...(stored && typeof stored === "object" ? stored : {}) };
  if (typeof record.share === "number") {
    const rounded = Math.round(Math.max(0, Math.min(1, record.share)) * 200) / 200;
    record.share = rounded < 0.005 ? 0 : rounded;
  }
  return record;
}

export function upsertProject(adapter, project, patch = {}) {
  const next = { ...loadProject(adapter, project), ...patch, project };
  writeJson(path.join(PROJECT_DIR, adapter, `${projectKey(project)}.json`), next);
  return next;
}

export function loadProjects(adapter) {
  const dir = path.join(PROJECT_DIR, adapter);
  const out = [];
  for (const name of listJson(dir)) {
    const stored = readJson(path.join(dir, name), null);
    if (stored && typeof stored === "object" && stored.project) out.push({ ...blankProject(stored.project), ...stored });
  }
  return out;
}

export function saveQuota(adapter, reading) {
  return writeJson(quotaFile(adapter), reading);
}

export function loadQuota(adapter) {
  const reading = readJson(quotaFile(adapter), null);
  if (!reading || typeof reading !== "object" || !reading.windows) return null;
  return reading;
}

export function liveWindow(reading, key, now = Date.now()) {
  if (!reading) return null;
  const window = reading.windows?.[key];
  if (!window || typeof window.usedPercent !== "number") return null;
  if (typeof window.resetsAt === "number" && window.resetsAt * 1000 <= now) return null;
  return window;
}

export function windowBounds(reading, key, now = Date.now()) {
  const span = WINDOW_MS[key] ?? FIVE_HOUR_MS;
  const window = liveWindow(reading, key, now);
  if (window && typeof window.resetsAt === "number") {
    const to = window.resetsAt * 1000;
    return { from: to - span, to, anchored: true };
  }
  return { from: now - span, to: now, anchored: false };
}

function newMeter(adapter, id) {
  return {
    schema: 1,
    adapter,
    id,
    files: {},
    buckets: [],
    seen: [],
    lockouts: [],
    lastAt: 0,
    meteredAt: 0,
    project: "",
    prompt: "",
    prompts: [],
    signal: null,
    defers: [],
  };
}

export function loadMeter(adapter, id) {
  const record = readJson(meterFile(adapter, id), null);
  if (!record || typeof record !== "object" || !Array.isArray(record.buckets)) return newMeter(adapter, id);
  return { ...newMeter(adapter, id), ...record };
}

function bucketStart(at) {
  return Math.floor(at / BUCKET_MS) * BUCKET_MS;
}

function addUsage(map, at, usage) {
  const key = bucketStart(at);
  const row = map.get(key) || [key, 0, 0, 0, 0, 0];
  row[1] += usage.input;
  row[2] += usage.output;
  row[3] += usage.cacheWrite;
  row[4] += usage.cacheRead;
  row[5] += 1;
  map.set(key, row);
}

function scanLines(file, from, to, onLine, skipFirst = false) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return from;
  }
  let position = from;
  let skip = skipFirst;
  let carry = Buffer.alloc(0);
  const buffer = Buffer.allocUnsafe(CHUNK);
  try {
    while (position < to) {
      const want = Math.min(buffer.length, to - position);
      const read = fs.readSync(fd, buffer, 0, want, position);
      if (read <= 0) break;
      position += read;
      let chunk = carry.length > 0 ? Buffer.concat([carry, buffer.subarray(0, read)]) : Buffer.from(buffer.subarray(0, read));
      let start = 0;
      for (;;) {
        const index = chunk.indexOf(0x0a, start);
        if (index === -1) break;
        if (skip) skip = false;
        else onLine(chunk.toString("utf8", start, index));
        start = index + 1;
      }
      carry = chunk.subarray(start);
    }
  } catch {
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
  return position - carry.length;
}

export function openBuckets(record) {
  return new Map(record.buckets.map((row) => [row[0], [...row]]));
}

export function addSample(buckets, at, usage) {
  addUsage(buckets, at, usage);
}

export function scanNew(record, files, onLine) {
  for (const file of files) {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    const previous = record.files[file] ?? 0;
    let from = size < previous ? 0 : previous;
    const truncated = from === 0 && size > MAX_BACKFILL;
    if (truncated) from = size - MAX_BACKFILL;
    if (size <= from) continue;
    record.files[file] = scanLines(file, from, size, onLine, truncated);
  }
  return record;
}

export function commitMeter(adapter, id, record, buckets, fresh, now = Date.now()) {
  const cutoff = now - RETENTION_MS;
  record.buckets = [...buckets.values()].filter((row) => row[0] >= cutoff).sort((a, b) => a[0] - b[0]);
  record.lockouts = record.lockouts.filter((at) => at >= cutoff).slice(-50);
  record.seen = [...record.seen, ...fresh].slice(-SEEN_LIMIT);
  record.meteredAt = now;
  writeJson(meterFile(adapter, id), record);
  return record;
}

function truncatedFile(record, files) {
  for (const file of files) {
    const previous = record.files[file];
    if (previous === undefined) continue;
    try {
      if (fs.statSync(file).size < previous) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function sampleFiles(adapter, id, files, now = Date.now()) {
  let record = loadMeter(adapter, id);
  if (truncatedFile(record, files)) {
    record = { ...newMeter(adapter, id), project: record.project, prompts: record.prompts ?? [] };
  }
  const seen = new Set(record.seen);
  const buckets = openBuckets(record);
  let lastLockout = record.lockouts.length > 0 ? record.lockouts[record.lockouts.length - 1] : 0;
  const fresh = [];

  scanNew(record, files, (line) => {
      if (line.length < 2 || line.charCodeAt(0) !== 123) return;
      const hasUsage = line.includes('"usage"');
      const hasPrompt = line.includes('"promptSource"');
      const hasError = line.includes('"isApiErrorMessage":true');
      const hasSignal = line.includes("SMT:");
      if (!hasUsage && !hasPrompt && !hasError && !hasSignal) return;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      const stamp = Number.isFinite(at) ? at : now;

      if (entry.type === "assistant" && entry.message) {
        const messageId = entry.message.id;
        const usage = entry.message.usage;
        if (usage && messageId && !seen.has(messageId)) {
          seen.add(messageId);
          fresh.push(messageId);
          addUsage(buckets, stamp, {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cacheWrite: usage.cache_creation_input_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
          });
          if (stamp > record.lastAt) record.lastAt = stamp;
        }
        if (entry.isApiErrorMessage && (entry.quotaLimits || /\blimit\b/i.test(JSON.stringify(entry.message.content ?? "")))) {
          if (stamp - lastLockout > LOCKOUT_GAP_MS) {
            record.lockouts.push(stamp);
            lastLockout = stamp;
          }
        }
        const text = signalIn(entry.message.content);
        if (text) record.signal = text;
        for (const deferred of defersIn(entry.message.content)) {
          if (!record.defers.includes(deferred)) record.defers.push(deferred);
        }
      } else if (entry.type === "user" && typeof entry.message?.content === "string") {
        if (entry.promptSource === "typed" || entry.origin?.kind === "human") {
          const text = entry.message.content.replace(/\s+/g, " ").trim().slice(0, 120);
          record.prompt = text;
          if (!Array.isArray(record.prompts)) record.prompts = [];
          if (text && record.prompts[record.prompts.length - 1] !== text) {
            record.prompts = [...record.prompts, text].slice(-5);
          }
        }
      }
      if (!record.project && typeof entry.cwd === "string") record.project = entry.cwd;
    });

  record.defers = record.defers.slice(-DEFER_LIMIT);
  return commitMeter(adapter, id, record, buckets, fresh, now);
}

export function consumeSignal(adapter, id) {
  const record = loadMeter(adapter, id);
  const signal = record.signal;
  const defers = record.defers ?? [];
  if (signal || defers.length > 0) writeJson(meterFile(adapter, id), { ...record, signal: null, defers: [] });
  return { signal, defers };
}

function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) if (typeof block?.text === "string") parts.push(block.text);
  return parts.join("\n");
}

export function trailingSignals(content) {
  const lines = blockText(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const block = [];
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index] ?? "";
    if (!/^SMT:\s*(DONE|NEEDS_MORE|BLOCKED|DEFER\b)/.test(line)) break;
    block.unshift(line);
  }
  let signal = null;
  const defers = [];
  for (const line of block) {
    const state = /^SMT:\s*(DONE|NEEDS_MORE|BLOCKED)$/.exec(line);
    if (state) {
      signal = state[1];
      continue;
    }
    const defer = /^SMT:\s*DEFER\s+(.+)$/.exec(line);
    if (defer) {
      const text = String(defer[1]).replace(/\s+/g, " ").trim().slice(0, 140);
      if (text) defers.push(text);
    }
  }
  return { signal, defers };
}

export function signalIn(content) {
  return trailingSignals(content).signal;
}

export function defersIn(content) {
  return trailingSignals(content).defers;
}

export function deferFile(adapter, project) {
  const key = (project || "default").replace(/[^a-zA-Z0-9]/g, "-").slice(-90);
  return path.join(DEFER_DIR, adapter, `${key}.json`);
}

export function loadDeferred(adapter, project, now = Date.now()) {
  const stored = readJson(deferFile(adapter, project), null);
  const items = Array.isArray(stored?.items) ? stored.items : [];
  return items.filter((item) => now - (item.at ?? 0) < DEFER_RETENTION_MS);
}

export function addDeferred(adapter, project, texts, sessionId, now = Date.now()) {
  if (texts.length === 0) return [];
  const current = loadDeferred(adapter, project, now);
  const known = new Set(current.map((item) => item.text));
  for (const text of texts) {
    if (known.has(text)) continue;
    known.add(text);
    current.push({ at: now, text, session: sessionId, project });
  }
  const items = current.slice(-DEFER_LIMIT);
  writeJson(deferFile(adapter, project), { schema: 1, project, items });
  return items;
}

export function clearDeferred(adapter, project) {
  writeJson(deferFile(adapter, project), { schema: 1, project, items: [] });
}

export function deferredProjects(adapter, now = Date.now()) {
  const dir = path.join(DEFER_DIR, adapter);
  const out = [];
  for (const name of listJson(dir)) {
    const stored = readJson(path.join(dir, name), null);
    const items = Array.isArray(stored?.items) ? stored.items : [];
    const live = items.filter((item) => now - (item.at ?? 0) < DEFER_RETENTION_MS);
    if (live.length > 0) out.push({ project: stored.project ?? name.slice(0, -5), items: live });
  }
  return out.sort((a, b) => b.items.length - a.items.length);
}

export function usageInWindow(record, from, to) {
  const total = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, requests: 0 };
  for (const row of record.buckets) {
    if (row[0] < from || row[0] > to) continue;
    total.input += row[1];
    total.output += row[2];
    total.cacheWrite += row[3];
    total.cacheRead += row[4];
    total.requests += row[5];
  }
  const tokens = total.input + total.output + total.cacheWrite + total.cacheRead;
  const weighted =
    total.input * WEIGHTS.input +
    total.output * WEIGHTS.output +
    total.cacheWrite * WEIGHTS.cacheWrite +
    total.cacheRead * WEIGHTS.cacheRead;
  return { ...total, tokens, weighted };
}

export function allocate(entries) {
  const targets = new Map();
  const eligible = [];
  let reserved = 0;
  let released = 0;

  for (const entry of entries) {
    const state = entry.state;
    if (state === "active" || state === "needs-more") {
      eligible.push(entry);
      continue;
    }
    const keep = Math.max(0, Math.min(1, entry.consumed || 0));
    reserved += keep;
    if (typeof entry.share === "number" && entry.share > keep) released += entry.share - keep;
    targets.set(entry.id, { claimantId: entry.id, target: keep, pinned: false, pool: 0, released: true });
  }

  if (reserved > 1) {
    const shrink = 1 / reserved;
    for (const allocation of targets.values()) allocation.target *= shrink;
    released *= shrink;
    reserved = 1;
  }

  let budget = Math.max(0, 1 - Math.min(1, reserved));
  if (eligible.length === 0) return { targets, unusedPool: budget };

  const pinned = eligible.filter((entry) => typeof entry.share === "number" && entry.share >= 0);
  const free = eligible.filter((entry) => !(typeof entry.share === "number" && entry.share >= 0));
  const pinnedSum = pinned.reduce((sum, entry) => sum + entry.share, 0);
  const scale = pinnedSum > budget && pinnedSum > 0 ? budget / pinnedSum : 1;

  for (const entry of pinned) {
    targets.set(entry.id, { claimantId: entry.id, target: entry.share * scale, pinned: true, pool: 0, released: false });
  }
  const spent = Math.min(pinnedSum, budget);
  const spare = Math.max(0, budget - spent);
  const handedBack = Math.min(spare, released);
  const base = Math.max(0, spare - handedBack);
  const even = free.length > 0 ? base / free.length : 0;
  for (const entry of free) {
    targets.set(entry.id, { claimantId: entry.id, target: even, pinned: false, pool: 0, released: false });
  }

  let pool = handedBack;
  const idle = free.length > 0 ? 0 : spare - handedBack;
  for (const entry of eligible) {
    const allocation = targets.get(entry.id);
    const cap = typeof entry.cap === "number" ? entry.cap : 1;
    if (allocation.target > cap) {
      pool += allocation.target - cap;
      allocation.target = cap;
    }
  }

  const tiers = new Map();
  for (const entry of eligible) {
    const rank = PRIORITY_RANK[entry.priority] ?? 1;
    if (!tiers.has(rank)) tiers.set(rank, []);
    tiers.get(rank).push(entry);
  }

  for (const rank of [...tiers.keys()].sort((a, b) => a - b)) {
    if (pool <= EPSILON) break;
    let takers = tiers.get(rank);
    while (pool > EPSILON && takers.length > 0) {
      const slice = pool / takers.length;
      const next = [];
      let moved = 0;
      for (const entry of takers) {
        const allocation = targets.get(entry.id);
        const cap = typeof entry.cap === "number" ? entry.cap : 1;
        const room = cap - allocation.target;
        if (room <= EPSILON) continue;
        const give = Math.min(slice, room);
        allocation.target += give;
        allocation.pool += give;
        moved += give;
        if (room - give > EPSILON) next.push(entry);
      }
      pool -= moved;
      if (moved <= EPSILON) break;
      takers = next;
    }
  }

  for (const allocation of targets.values()) {
    if (allocation.target < EPSILON * 1000) allocation.target = 0;
    if (allocation.pool < EPSILON * 1000) allocation.pool = 0;
  }
  return { targets, unusedPool: Math.max(0, pool + idle) };
}

export function schedule(adapter, now = Date.now(), key = "five_hour", quotaOverride = null, transcriptRoot = null) {
  const quota = quotaOverride ?? loadQuota(adapter);
  const bounds = windowBounds(quota, key, now);
  const claimants = loadClaimants(adapter);
  const usage = new Map();
  const lockouts = [];
  let total = 0;

  for (const claimant of claimants) {
    const record = loadMeter(adapter, claimant.id);
    const window = usageInWindow(record, bounds.from, bounds.to);
    usage.set(claimant.id, window);
    total += window.weighted;
    for (const at of record.lockouts) if (at >= bounds.from && at <= bounds.to) lockouts.push(at);
  }

  const live = liveWindow(quota, key, now);
  const strict = heartbeatsLive(claimants, now);
  const groups = new Map();

  for (const claimant of claimants) {
    const project = claimant.project || claimant.label || claimant.id;
    let group = groups.get(project);
    if (!group) {
      group = { project, settings: loadProject(adapter, project), sessions: [], observed: 0, weighted: 0, tokens: 0, requests: 0, lastSeen: 0 };
      groups.set(project, group);
    }
    const window = usage.get(claimant.id);
    const observed = total > 0 ? window.weighted / total : 0;
    const state = effectiveState(claimant, now, strict);
    group.sessions.push({ claimant, window, observed, state, bucket: bucketFor(claimant, now, strict) });
    group.observed += observed;
    group.weighted += window.weighted;
    group.tokens += window.tokens;
    group.requests += window.requests;
    group.lastSeen = Math.max(group.lastSeen, claimant.lastSeen ?? 0);
  }

  const entries = [...groups.values()].map((group) => {
    const running = group.sessions.some((session) => session.bucket === "active");
    return {
      id: group.project,
      share: group.settings.share,
      priority: group.settings.priority,
      state: running ? "active" : "done",
      consumed: live ? (live.usedPercent / 100) * group.observed : 0,
      cap: group.settings.cap,
    };
  });

  const eligible = entries.filter((entry) => entry.state === "active").length;
  const { targets, unusedPool } = allocate(entries);

  const projects = [...groups.values()].map((group) => {
    const allocation = targets.get(group.project) ?? {
      claimantId: group.project,
      target: 0,
      pinned: false,
      pool: 0,
      released: true,
    };
    const running = group.sessions.filter((session) => session.bucket === "active");
    const liveWeight = running.reduce((sum, session) => sum + session.window.weighted, 0);
    const sessions = group.sessions
      .map((session) => {
        const alive = session.bucket === "active";
        const slice = alive
          ? liveWeight > 0
            ? session.window.weighted / liveWeight
            : 1 / Math.max(1, running.length)
          : 0;
        const target = allocation.target * slice;
        const pressure =
          live || eligible > 1
            ? pressureFor(session.observed, target, live ? live.usedPercent : null)
            : { value: 0, basis: "share" };
        return {
          claimant: session.claimant,
          allocation: { claimantId: session.claimant.id, target, pinned: allocation.pinned, pool: 0, released: !alive },
          usage: session.window,
          observed: session.observed,
          state: session.state,
          bucket: session.bucket,
          stale: isStale(session.claimant, now, strict),
          pressure,
          attributedPercent: live ? live.usedPercent * session.observed : null,
          project: group.project,
        };
      })
      .sort((a, b) => b.observed - a.observed);

    const bucket = sessions.some((session) => session.bucket === "active")
      ? "active"
      : group.settings.parked
        ? "parked"
        : sessions.some((session) => session.bucket === "recent")
          ? "recent"
          : "parked";

    return {
      project: group.project,
      label: group.settings.label || group.project.split("/").filter(Boolean).pop() || group.project,
      settings: group.settings,
      sessions,
      allocation,
      observed: group.observed,
      usage: { tokens: group.tokens, weighted: group.weighted, requests: group.requests },
      lastSeen: group.lastSeen,
      bucket,
      attributedPercent: live ? live.usedPercent * group.observed : null,
      pressure:
        live || eligible > 1
          ? pressureFor(group.observed, allocation.target, live ? live.usedPercent : null)
          : { value: 0, basis: "share" },
      prompt: sessions[0]?.claimant.prompt ?? "",
      liveSessions: sessions.filter((session) => session.bucket === "active").length,
    };
  });

  const known = new Set(projects.map((view) => view.project));
  for (const seen of transcriptRoot ? seenProjects(transcriptRoot, now) : []) {
    if (!seen.project || known.has(seen.project)) continue;
    const settings = loadProject(adapter, seen.project);
    projects.push({
      project: seen.project,
      label: settings.label || seen.label || seen.project.split("/").filter(Boolean).pop() || seen.project,
      settings,
      sessions: [],
      allocation: { claimantId: seen.project, target: 0, pinned: false, pool: 0, released: true },
      observed: 0,
      usage: { tokens: 0, weighted: 0, requests: 0 },
      lastSeen: seen.lastSeen,
      bucket: "recent",
      attributedPercent: null,
      pressure: { value: 0, basis: "share" },
      prompt: seen.prompt,
      liveSessions: 0,
    });
  }

  const span = WINDOW_MS[key] ?? FIVE_HOUR_MS;
  return {
    adapter,
    key,
    now,
    quota,
    live,
    bounds,
    windowId: bounds.anchored ? bounds.to : Math.floor(now / span) * span,
    projects,
    claimants: projects.flatMap((project) => project.sessions),
    unusedPool,
    totalWeighted: total,
    lockouts: lockouts.sort((a, b) => a - b),
  };
}

export function viewFor(plan, id) {
  return plan.claimants.find((view) => view.claimant.id === id) ?? null;
}

const MIN_TARGET = 0.001;
const MAX_PRESSURE = 9.99;

export function pressureFor(consumedShare, target, quotaUsedPercent) {
  if (!(target > MIN_TARGET)) return { value: consumedShare > 0 ? MAX_PRESSURE : 0, basis: "share" };
  if (typeof quotaUsedPercent === "number" && quotaUsedPercent >= 0) {
    return { value: Math.min(MAX_PRESSURE, (quotaUsedPercent / 100) * (consumedShare / target)), basis: "budget" };
  }
  return { value: Math.min(MAX_PRESSURE, consumedShare / target), basis: "share" };
}

export const POLICIES = {
  finish: {
    label: "finish and defer",
    summary: "narrow the scope as the window fills, and push what is dropped to the next session",
    stages: [
      { at: 50, actions: ["focus"] },
      { at: 80, actions: ["narrow", "defer"] },
      { at: 90, actions: ["verify", "defer", "handoff"] },
    ],
  },
  strict: {
    label: "protect the window",
    summary: "the same moves, much earlier, for when running out is expensive",
    stages: [
      { at: 35, actions: ["focus"] },
      { at: 60, actions: ["narrow", "defer"] },
      { at: 80, actions: ["verify", "defer", "handoff"] },
    ],
  },
  relaxed: {
    label: "warn late",
    summary: "stay quiet until the target share is nearly gone",
    stages: [
      { at: 80, actions: ["focus"] },
      { at: 95, actions: ["verify", "handoff"] },
    ],
  },
  off: { label: "no advice", summary: "measure and allocate, but never inject anything", stages: [] },
};

export const DEFAULT_POLICY = "finish";
export const STAGES = POLICIES.finish.stages.map((stage) => stage.at).reverse();

export function policyNames() {
  return Object.keys(POLICIES);
}

export function policyFor(config, project) {
  const name = config?.policyFor?.[project] ?? config?.policy ?? DEFAULT_POLICY;
  return POLICIES[name] ? { name, ...POLICIES[name] } : { name: DEFAULT_POLICY, ...POLICIES[DEFAULT_POLICY] };
}

export function stageFor(pressure, policy = POLICIES[DEFAULT_POLICY]) {
  const stages = policy?.stages ?? [];
  let hit = 0;
  for (const stage of stages) if (pressure >= stage.at / 100) hit = Math.max(hit, stage.at);
  return hit;
}

export function actionsFor(stage, policy = POLICIES[DEFAULT_POLICY]) {
  const found = (policy?.stages ?? []).find((entry) => entry.at === stage);
  return found ? found.actions : [];
}

export function preserveText(preserve) {
  const list = Array.isArray(preserve) ? preserve.filter(Boolean) : [];
  if (list.length === 0) return "testing and finalisation";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const ACTION_TEXT = {
  focus: () =>
    "Stay on completion of what was asked: no side quests, no wide reading, and batch your tool calls instead of one round trip per step.",
  narrow: (view) =>
    `Narrow the scope to the smallest version that is genuinely done. Cut optional work, stop comparing alternatives, start nothing new, and keep enough capacity for ${preserveText(view.preserve)}.`,
  defer: () =>
    "Whatever you drop, write on its own line as `SMT: DEFER <one line>`. It comes back at the start of the next session in this project, so dropping it now costs nothing.",
  verify: () => "Verification and finalisation only: finish what is already open, run the tests, and leave the tree clean.",
  handoff: () =>
    "End with one line on where you stopped, then report SMT: DONE, SMT: NEEDS_MORE or SMT: BLOCKED on its own line.",
};

export function openingAdvice(view) {
  const target = Math.round(view.target * 100);
  const policy = view.policy ?? POLICIES[DEFAULT_POLICY];
  const first = policy.stages?.[0];
  const plan = first
    ? ` Past ${first.at}% of it, tighten up rather than pushing on: ${policy.summary}.`
    : "";
  return `[savemytokens] This session's target share of the current Claude window is ${target}%. Work inside it: prioritise completion, and preserve enough capacity for ${preserveText(view.preserve)}.${plan} When you stop, report one of SMT: DONE, SMT: NEEDS_MORE or SMT: BLOCKED on its own line.`;
}

export function stageText(stage, view) {
  const policy = view.policy ?? POLICIES[DEFAULT_POLICY];
  return actionsFor(stage, policy)
    .map((action) => (ACTION_TEXT[action] ?? (() => ""))(view))
    .filter(Boolean)
    .join(" ");
}

export function adviceFor(stage, view) {
  const policy = view.policy ?? POLICIES[DEFAULT_POLICY];
  const target = Math.round(view.target * 100);
  const spent = Math.round(view.pressure * 100);
  const basis =
    view.basis === "budget"
      ? `${spent}% of your ${target}% target share of this Claude window is spent`
      : `you are at ${Math.round(view.observed * 100)}% of measured usage against a ${target}% target`;
  const body = actionsFor(stage, policy).map((action) => (ACTION_TEXT[action] ?? (() => ""))(view));
  const custom = typeof view.custom === "string" && view.custom.trim() ? ` ${view.custom.trim()}` : "";
  return `[savemytokens] ${basis}. ${body.join(" ")}${custom}`.trim();
}

export function deferredAdvice(items) {
  const lines = items.slice(-5).map((item) => `  · ${item.text}`);
  return `[savemytokens] Deferred earlier in this project:\n${lines.join("\n")}\nPick these up only if they fit inside your target share. Clear them with: npx savemytokens defer clear`;
}

const BUILTIN_THEMES = {
  default: {
    name: "default",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25cf", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u2588", empty: "\u2591", over: "\u25b6", meter: "\u2588", track: "\u2591" },
    colors: { fg: "#cdd6f4", dim: "#9399b2", accent: "#89b4fa", ok: "#a6e3a1", warn: "#f9e2af", danger: "#f38ba8", track: "#585b70", fill: "#89b4fa" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f" },
  },

  tokyonight: {
    name: "tokyonight",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u2022", done: "\u2713", blocked: "!", idle: "\u00b7", open: "[", close: "]", fill: "|", empty: ".", over: "\u00bb", meter: "\u2588", track: "\u2591" },
    colors: { fg: "#e6e6e6", dim: "#8a8a8a", accent: "#7aa2f7", ok: "#9ece6a", warn: "#e0af68", danger: "#f7768e", track: "#3b3b3b", fill: "#7aa2f7" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518" },
  },
  minimal: {
    name: "minimal",
    tui: { cursor: ">", pin: "*", active: "o", done: "x", blocked: "!", idle: ".", open: "[", close: "]", fill: "#", empty: ".", over: ">", meter: "#", track: "." },
    colors: { fg: "#ffffff", dim: "#8c8c8c", accent: "#ffffff", ok: "#ffffff", warn: "#ffffff", danger: "#ffffff", track: "#4f4f4f", fill: "#ffffff" },
    glyphs: { full: "#", empty: ".", sep: "|", arrow: ">", tag: "smt" },
    border: { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" },
  },
  nord: {
    name: "nord",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25cf", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u25b0", empty: "\u25b1", over: "\u25b6", meter: "\u25b0", track: "\u25b1" },
    colors: { fg: "#eceff4", dim: "#7b88a1", accent: "#88c0d0", ok: "#a3be8c", warn: "#ebcb8b", danger: "#e0707c", track: "#434c5e", fill: "#88c0d0" },
    glyphs: { full: "\u25b0", empty: "\u25b1", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f" },
  },
  violet: {
    name: "violet",
    tui: { cursor: "\u25b8", pin: "\u2605", active: "\u25c6", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u2588", empty: "\u2591", over: "\u25b6", meter: "\u2588", track: "\u2591" },
    colors: { fg: "#f8f8f2", dim: "#6272a4", accent: "#bd93f9", ok: "#50fa7b", warn: "#f1fa8c", danger: "#ff5555", track: "#44475a", fill: "#bd93f9" },
    glyphs: { full: "\u2588", empty: "\u2592", sep: "\u2022", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f" },
  },
  matrix: {
    name: "matrix",
    tui: { cursor: "\u00bb", pin: "*", active: "\u2593", done: "\u2713", blocked: "!", idle: "\u00b7", open: "<", close: ">", fill: "\u2593", empty: "\u00b7", over: "\u00bb", meter: "\u2593", track: "\u00b7" },
    colors: { fg: "#8fff8f", dim: "#3f9f3f", accent: "#00ff41", ok: "#00ff41", warn: "#b6ff00", danger: "#ff6b5e", track: "#1e421e", fill: "#00ff41" },
    glyphs: { full: "\u2593", empty: "\u00b7", sep: "::", arrow: ">>", tag: "SMT" },
    border: { h: "\u2550", v: "\u2551", tl: "\u2554", tr: "\u2557", bl: "\u255a", br: "\u255d" },
  },
  solarized: {
    name: "solarized",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25cf", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u2501", empty: "\u2500", over: "\u25b6", meter: "\u2501", track: "\u2500" },
    colors: { fg: "#b4c2c2", dim: "#7d9092", accent: "#4fa3e0", ok: "#9db81b", warn: "#d2a106", danger: "#f0645f", track: "#0b4a5a", fill: "#4fa3e0" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518" },
  },
  gruvbox: {
    name: "gruvbox",
    tui: { cursor: "\u27a4", pin: "\u2605", active: "\u25a0", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u25a0", empty: "\u25a1", over: "\u25b6", meter: "\u25a0", track: "\u25a1" },
    colors: { fg: "#ebdbb2", dim: "#a89984", accent: "#8ec07c", ok: "#b8bb26", warn: "#fabd2f", danger: "#fb6a58", track: "#504945", fill: "#8ec07c" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518" },
  },
  rose: {
    name: "rose",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25c6", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u25c6", empty: "\u25c7", over: "\u25b6", meter: "\u25ac", track: "\u25ad" },
    colors: { fg: "#e0def4", dim: "#8d88a8", accent: "#c4a7e7", ok: "#9ccfd8", warn: "#f6c177", danger: "#eb6f92", track: "#3a3552", fill: "#c4a7e7" },
    glyphs: { full: "\u25ac", empty: "\u25ad", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f" },
  },
  paper: {
    name: "paper",
    tui: { cursor: "\u203a", pin: "\u2605", active: "\u25aa", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u25ae", empty: "\u25af", over: "\u25b8", meter: "\u25ae", track: "\u25af" },
    colors: { fg: "#24292f", dim: "#6e7781", accent: "#0969da", ok: "#1a7f37", warn: "#9a6700", danger: "#cf222e", track: "#d0d7de", fill: "#0969da" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518" },
  },
  neon: {
    name: "neon",
    tui: { cursor: "\u25b8", pin: "\u2605", active: "\u25c9", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u2589", empty: "\u2595", over: "\u25b6", meter: "\u2589", track: "\u2595" },
    colors: { fg: "#f0f0ff", dim: "#8f7fc0", accent: "#ff5cc8", ok: "#00f5d4", warn: "#fee440", danger: "#ff5c8a", track: "#3a3a52", fill: "#ff5cc8" },
    glyphs: { full: "\u2589", empty: "\u2595", sep: "\u2502", arrow: "\u25b8", tag: "SMT" },
    border: { h: "\u2501", v: "\u2503", tl: "\u250f", tr: "\u2513", bl: "\u2517", br: "\u251b" },
  },
  onedark: {
    name: "onedark",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25cf", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u2588", empty: "\u2591", over: "\u25b6", meter: "\u2588", track: "\u2591" },
    colors: { fg: "#abb2bf", dim: "#8b93a1", accent: "#61afef", ok: "#98c379", warn: "#e5c07b", danger: "#e88b93", track: "#4b515d", fill: "#61afef" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518" },
  },
  monokai: {
    name: "monokai",
    tui: { cursor: "\u25b8", pin: "\u2605", active: "\u25cf", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u2588", empty: "\u2591", over: "\u25b6", meter: "\u2588", track: "\u2591" },
    colors: { fg: "#f8f8f2", dim: "#a6a48f", accent: "#66d9ef", ok: "#a6e22e", warn: "#e6db74", danger: "#ff6188", track: "#5a594e", fill: "#66d9ef" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518" },
  },
  everforest: {
    name: "everforest",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25c6", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u25ac", empty: "\u25ad", over: "\u25b6", meter: "\u25ac", track: "\u25ad" },
    colors: { fg: "#d3c6aa", dim: "#9da9a0", accent: "#a7c080", ok: "#83c092", warn: "#dbbc7f", danger: "#e67e80", track: "#4f585e", fill: "#a7c080" },
    glyphs: { full: "\u25ac", empty: "\u25ad", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f" },
  },
  kanagawa: {
    name: "kanagawa",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25cf", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u2588", empty: "\u2591", over: "\u25b6", meter: "\u2588", track: "\u2591" },
    colors: { fg: "#dcd7ba", dim: "#a09a84", accent: "#7e9cd8", ok: "#98bb6c", warn: "#e6c384", danger: "#e46876", track: "#54546d", fill: "#7e9cd8" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f" },
  },
  terracotta: {
    name: "terracotta",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25c6", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u25ac", empty: "\u25ad", over: "\u25b6", meter: "\u25ac", track: "\u25ad" },
    colors: { fg: "#f0e2d8", dim: "#a68a7b", accent: "#e2836b", ok: "#b6c99b", warn: "#f0c05a", danger: "#f2807a", track: "#4a3630", fill: "#e2836b" },
    glyphs: { full: "\u25ac", empty: "\u25ad", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f" },
  },
  orange: {
    name: "orange",
    tui: { cursor: "\u25b8", pin: "\u2605", active: "\u25cf", done: "\u2713", blocked: "!", idle: "\u00b7", open: "", close: "", fill: "\u2588", empty: "\u2591", over: "\u25b6", meter: "\u2588", track: "\u2591" },
    colors: { fg: "#f7ede2", dim: "#a08b78", accent: "#ff9f45", ok: "#9ccf7f", warn: "#ffd166", danger: "#ff7a6b", track: "#43342a", fill: "#ff9f45" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518" },
  },
  ember: {
    name: "ember",
    tui: { cursor: "\u276f", pin: "\u2605", active: "\u25cf", done: "\u2713", blocked: "!", idle: "\u00b7", open: "(", close: ")", fill: "\u25cf", empty: "\u25cb", over: "\u00bb", meter: "\u2588", track: "\u2591" },
    colors: { fg: "#f5e0dc", dim: "#9a7b76", accent: "#fab387", ok: "#a6e3a1", warn: "#f9e2af", danger: "#f38ba8", track: "#45475a", fill: "#fab387" },
    glyphs: { full: "\u2588", empty: "\u2591", sep: "\u00b7", arrow: "\u2192", tag: "SMT" },
    border: { h: "\u2500", v: "\u2502", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f" },
  },
};

const THEME_RENAMES = {
  catppuccin: "default",
  dracula: "violet",
  "tokyo-night": "tokyonight",
  "catppuccin-mocha": "default",
  "catppuccin-macchiato": "default",
  "rose-pine": "rose",
  "one-dark": "onedark",
};

export function builtinThemes() {
  return Object.keys(BUILTIN_THEMES);
}

export function userThemes() {
  return listJson(THEME_DIR).map((name) => name.slice(0, -5));
}

export function loadTheme(name) {
  const wanted = THEME_RENAMES[name] ?? name ?? "default";
  const user = readJson(path.join(THEME_DIR, `${wanted}.json`), null);
  const base = BUILTIN_THEMES[wanted] || BUILTIN_THEMES.default;
  const fallback = BUILTIN_THEMES.default;
  if (!user || typeof user !== "object") return { ...base, tui: { ...fallback.tui, ...base.tui } };
  return {
    ...base,
    ...user,
    name: wanted,
    colors: { ...base.colors, ...(user.colors || {}) },
    glyphs: { ...base.glyphs, ...(user.glyphs || {}) },
    border: { ...base.border, ...(user.border || {}) },
    tui: { ...fallback.tui, ...base.tui, ...(user.tui || {}) },
  };
}

function rgb(hex) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) return null;
  const number = Number.parseInt(value, 16);
  if (!Number.isFinite(number)) return null;
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

export function truecolor() {
  const declared = String(process.env.COLORTERM || "").toLowerCase();
  if (declared.includes("truecolor") || declared.includes("24bit")) return true;
  const term = String(process.env.TERM || "").toLowerCase();
  return term.includes("direct") || term.includes("truecolor") || term.includes("kitty");
}

function xterm256(parts) {
  const [red, green, blue] = parts;
  if (Math.abs(red - green) < 10 && Math.abs(green - blue) < 10) {
    const level = Math.round(((red + green + blue) / 3 - 8) / 10);
    if (level <= 0) return 16;
    if (level >= 24) return 231;
    return 232 + level;
  }
  const step = (value) => Math.round(Math.max(0, value - 55) / 40);
  return 16 + 36 * step(red) + 6 * step(green) + step(blue);
}

function sgr(parts, bold) {
  const weight = bold ? "1;" : "";
  return truecolor()
    ? `\u001b[${weight}38;2;${parts[0]};${parts[1]};${parts[2]}m`
    : `\u001b[${weight}38;5;${xterm256(parts)}m`;
}

export function paint(theme, role, text, enabled = true) {
  if (!enabled || process.env.NO_COLOR !== undefined) return text;
  const parts = rgb(theme.colors?.[role]);
  if (!parts) return text;
  return `${sgr(parts, false)}${text}\u001b[0m`;
}

export function paintHead(theme, text, enabled = true) {
  if (!enabled || process.env.NO_COLOR !== undefined) return text;
  const parts = rgb(theme.colors?.head ?? theme.colors?.fg);
  if (!parts) return text;
  return `${sgr(parts, true)}${text}\u001b[0m`;
}

export function meterBar(theme, ratio, width, role = "fill", enabled = true) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  const full = (theme.glyphs?.full ?? "█").repeat(filled);
  const empty = (theme.glyphs?.empty ?? "░").repeat(Math.max(0, width - filled));
  return paint(theme, role, full, enabled) + paint(theme, "track", empty, enabled);
}

export function pressureRole(pressure) {
  if (pressure >= 0.9) return "danger";
  if (pressure >= 0.8) return "warn";
  return "ok";
}

export function formatCountdown(resetsAt, now = Date.now()) {
  if (typeof resetsAt !== "number") return "";
  const diff = resetsAt * 1000 - now;
  if (diff <= 0) return "due";
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24 > 0 ? `${hours % 24}h` : ""}`;
}

export function formatReset(resetsAt, now = Date.now()) {
  if (typeof resetsAt !== "number") return "";
  const at = new Date(resetsAt * 1000);
  const diff = resetsAt * 1000 - now;
  if (diff <= 0) return "due";
  if (diff < 12 * 60 * 60 * 1000) {
    return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  }
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][at.getDay()] ?? "";
}

function percentText(value) {
  return `${Math.round(value)}%`;
}

export const HUD_SEGMENTS = [
  "tag",
  "project",
  "target",
  "used",
  "share",
  "pair",
  "bar",
  "priority",
  "5h",
  "7d",
  "spend",
  "reset",
  "meter5h",
  "spark",
  "pace",
  "empty",
];

export const HUD_PRESETS = {
  default: ["bar", "pair", "5h", "reset"],
  minimal: ["bar", "pair"],
  window: ["5h", "reset", "7d"],
  pacing: ["bar", "pace", "5h", "reset"],
  everything: ["project", "target", "used", "priority", "meter5h", "5h", "7d", "reset"],
};

export const HUD_PRESET_ABOUT = {
  default: "a bar for your share, then the numbers",
  minimal: "the bar and your share, nothing else",
  window: "only Anthropic's numbers, no per-project detail",
  pacing: "whether you are ahead of or behind the clock",
  everything: "every number there is",
};

const HUD_PRESET_ALIASES = {
  balanced: "default",
  allocation: "default",
  compact: "minimal",
  global: "window",
  bar: "default",
  blocks: "default",
  dots: "default",
  pace: "pacing",
  runway: "pacing",
  spark: "default",
};

export const HUD_LAYOUTS = Object.keys(HUD_PRESETS);
export const DEFAULT_HUD_SEGMENTS = HUD_PRESETS.default;

export function presetSegments(name) {
  return HUD_PRESETS[name] ?? HUD_PRESETS[HUD_PRESET_ALIASES[name]] ?? null;
}

export function presetMatching(segments) {
  const key = (list) => list.join(">");
  for (const [name, list] of Object.entries(HUD_PRESETS)) {
    if (key(list) === key(segments)) return name;
  }
  return null;
}

export const COLUMNS = ["allocation", "used", "share", "tokens", "priority", "last prompt"];
export const DEFAULT_COLUMNS = ["allocation", "used", "priority", "last prompt"];

function hudMeter(theme, ratio, width, role, enabled, filled = "\u2588", empty = "\u2591") {
  const cells = Math.max(4, width);
  const on = Math.max(0, Math.min(cells, Math.round(Math.max(0, Math.min(1, ratio)) * cells)));
  return paint(theme, role, filled.repeat(on), enabled) + paint(theme, "track", empty.repeat(cells - on), enabled);
}

function windowOf(view, key) {
  const window = view.quota?.[key];
  return window && typeof window.usedPercent === "number" ? window : null;
}

const SEGMENTS = {
  tag: (view, theme, on) => paint(theme, "accent", theme.glyphs?.tag ?? "SMT", on),
  project: (view) => view.label || "session",
  target: (view, theme, on) => `${paint(theme, "dim", "target", on)} ${percentText((view.target ?? 0) * 100)}`,
  used: (view, theme, on) => {
    const value = typeof view.used === "number" ? view.used : (view.observed ?? 0) * 100;
    return `${paint(theme, "dim", typeof view.used === "number" ? "used" : "share", on)} ${paint(theme, pressureRole(view.pressure ?? 0), percentText(value), on)}`;
  },
  share: (view, theme, on) => `${paint(theme, "dim", "share", on)} ${percentText((view.observed ?? 0) * 100)}`,
  pair: (view, theme, on) => {
    const value = typeof view.used === "number" ? view.used : (view.observed ?? 0) * 100;
    return `${paint(theme, pressureRole(view.pressure ?? 0), percentText(value), on)}${paint(theme, "dim", `/${percentText((view.target ?? 0) * 100)}`, on)}`;
  },
  bar: (view, theme, on) =>
    hudMeter(theme, view.pressure ?? 0, 8, pressureRole(view.pressure ?? 0), on, theme.glyphs?.hudFull ?? "\u28ff", theme.glyphs?.hudEmpty ?? "\u28c0"),
  priority: (view, theme, on) => paint(theme, "dim", String(view.priority ?? "normal").toUpperCase(), on),
  "5h": (view, theme, on) => {
    const window = windowOf(view, "five_hour");
    return window ? `5h ${paint(theme, pressureRole(window.usedPercent / 100), percentText(window.usedPercent), on)}` : "";
  },
  "7d": (view, theme, on) => {
    const window = windowOf(view, "seven_day");
    return window ? `7d ${paint(theme, pressureRole(window.usedPercent / 100), percentText(window.usedPercent), on)}` : "";
  },
  spend: (view, theme, on) => {
    const window = windowOf(view, "spend_limit");
    return window ? `spend ${paint(theme, pressureRole(window.usedPercent / 100), percentText(window.usedPercent), on)}` : "";
  },
  reset: (view, theme, on) => {
    const window = windowOf(view, "five_hour");
    if (!window || typeof window.resetsAt !== "number") return "";
    const left = formatCountdown(window.resetsAt, view.now);
    return left ? paint(theme, "dim", `in ${left}`, on) : "";
  },
  meter5h: (view, theme, on) => {
    const window = windowOf(view, "five_hour");
    return window ? hudMeter(theme, window.usedPercent / 100, 8, pressureRole(window.usedPercent / 100), on) : "";
  },
  spark: (view, theme, on) => {
    const points = Array.isArray(view.history) ? view.history.slice(-12) : [];
    if (points.length === 0) return "";
    const glyphs = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588".split("");
    return points
      .map((value) => paint(theme, pressureRole(value / 100), glyphs[Math.max(0, Math.min(7, Math.round((value / 100) * 7)))] ?? "\u2581", on))
      .join("");
  },
  pace: (view, theme, on) => {
    const window = windowOf(view, "five_hour");
    if (!window || typeof view.from !== "number" || typeof view.to !== "number") return "";
    const elapsed = Math.max(0, Math.min(1, (view.now - view.from) / Math.max(1, view.to - view.from))) * 100;
    const ahead = window.usedPercent - elapsed;
    return paint(theme, ahead > 5 ? "warn" : "ok", `${ahead >= 0 ? "+" : ""}${Math.round(ahead)} vs pace`, on);
  },
  empty: (view, theme, on) => {
    const window = windowOf(view, "five_hour");
    if (!window || !(typeof view.rate === "number" && view.rate > 0)) return "";
    const at = view.now + ((100 - window.usedPercent) / view.rate) * 3600000;
    const resetsAt = typeof window.resetsAt === "number" ? window.resetsAt * 1000 : null;
    if (resetsAt !== null && at >= resetsAt) return paint(theme, "ok", "lasts the window", on);
    return paint(theme, "danger", `empty ${formatReset(Math.floor(at / 1000), view.now)}`, on);
  },
};

const BARE_SEGMENTS = new Set(["bar", "meter5h", "spark"]);

export function renderSegments(segments, view, theme, enabled = true) {
  const sep = ` ${theme.glyphs?.sep ?? "\u00b7"} `;
  let line = "";
  let bare = false;
  for (const name of segments) {
    const render = SEGMENTS[name];
    if (!render) continue;
    const text = render(view, theme, enabled);
    if (!text) continue;
    if (!line) line = text;
    else line += (bare ? " " : sep) + text;
    bare = BARE_SEGMENTS.has(name);
  }
  return line + (view.stale ? paint(theme, "dim", " stale", enabled) : "");
}

export function renderHud(layout, view, theme, enabled = true) {
  const segments = Array.isArray(layout) ? layout : presetSegments(layout) ?? DEFAULT_HUD_SEGMENTS;
  return renderSegments(segments, view, theme, enabled);
}
