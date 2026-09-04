import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = process.env.SAVEMYTOKENS_HOME || path.join(os.homedir(), ".savemytokens");
export const CLAIMANT_DIR = path.join(HOME, "claimants");
export const METER_DIR = path.join(HOME, "meter");
export const QUOTA_DIR = path.join(HOME, "quota");
export const THEME_DIR = path.join(HOME, "themes");
export const HOOKS_DIR = path.join(HOME, "hooks");
export const CONFIG_FILE = path.join(HOME, "config.json");

export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;
export const WINDOW_MS = { five_hour: FIVE_HOUR_MS, seven_day: SEVEN_DAY_MS, spend_limit: SEVEN_DAY_MS };
export const WINDOW_LABEL = { five_hour: "5h", seven_day: "7d", spend_limit: "spend" };

const BUCKET_MS = 5 * 60 * 1000;
const RETENTION_MS = 9 * 24 * 60 * 60 * 1000;
const SEEN_LIMIT = 400;
const LOCKOUT_GAP_MS = 5 * 60 * 1000;
const STALE_MS = 45 * 60 * 1000;
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
  theme: { tui: "default", hud: "default" },
  layout: { hud: "allocation" },
  preserveFor: {},
  wrappedStatusLine: null,
  contribute: false,
};

export function loadConfig() {
  const stored = readJson(CONFIG_FILE, null);
  if (!stored || typeof stored !== "object") return { ...DEFAULT_CONFIG, createdAt: Date.now() };
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    theme: { ...DEFAULT_CONFIG.theme, ...(stored.theme || {}) },
    layout: { ...DEFAULT_CONFIG.layout, ...(stored.layout || {}) },
    preserveFor: { ...(stored.preserveFor || {}) },
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

export function loadClaimants(adapter) {
  const dir = path.join(CLAIMANT_DIR, adapter);
  const cutoff = Date.now() - RETENTION_MS;
  const out = [];
  for (const name of listJson(dir)) {
    const record = readJson(path.join(dir, name), null);
    if (!record || typeof record !== "object") continue;
    if ((record.lastSeen ?? 0) < cutoff) {
      try {
        fs.rmSync(path.join(dir, name));
      } catch {}
      continue;
    }
    out.push({ ...blankClaimant(adapter, record.id ?? name.slice(0, -5), record.startedAt ?? 0), ...record });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export function effectiveState(claimant, now = Date.now()) {
  if (claimant.state === "done" || claimant.state === "blocked") return claimant.state;
  if (claimant.endedAt) return "done";
  if (now - (claimant.lastSeen ?? 0) > STALE_MS) return "done";
  return claimant.state;
}

export function isStale(claimant, now = Date.now()) {
  return now - (claimant.lastSeen ?? 0) > STALE_MS;
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
    signal: null,
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

export function sampleFiles(adapter, id, files, now = Date.now()) {
  const record = loadMeter(adapter, id);
  const seen = new Set(record.seen);
  const buckets = new Map(record.buckets.map((row) => [row[0], [...row]]));
  let lastLockout = record.lockouts.length > 0 ? record.lockouts[record.lockouts.length - 1] : 0;
  const fresh = [];

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

    const offset = scanLines(file, from, size, (line) => {
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
      } else if (entry.type === "user" && typeof entry.message?.content === "string") {
        if (entry.promptSource === "typed" || entry.origin?.kind === "human") {
          record.prompt = entry.message.content.replace(/\s+/g, " ").trim().slice(0, 120);
        }
      }
      if (!record.project && typeof entry.cwd === "string") record.project = entry.cwd;
    }, truncated);

    record.files[file] = offset;
  }

  const cutoff = now - RETENTION_MS;
  record.buckets = [...buckets.values()].filter((row) => row[0] >= cutoff).sort((a, b) => a[0] - b[0]);
  record.lockouts = record.lockouts.filter((at) => at >= cutoff).slice(-50);
  record.seen = [...record.seen, ...fresh].slice(-SEEN_LIMIT);
  record.meteredAt = now;
  writeJson(meterFile(adapter, id), record);
  return record;
}

export function consumeSignal(adapter, id) {
  const record = loadMeter(adapter, id);
  const signal = record.signal;
  if (signal) writeJson(meterFile(adapter, id), { ...record, signal: null });
  return signal;
}

export function signalIn(content) {
  const blocks = Array.isArray(content) ? content : [];
  for (const block of blocks) {
    const text = typeof block?.text === "string" ? block.text : "";
    const match = /SMT:\s*(DONE|NEEDS_MORE|BLOCKED)/.exec(text);
    if (match) return match[1];
  }
  return null;
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

  for (const entry of entries) {
    const state = entry.state;
    if (state === "active" || state === "needs-more") {
      eligible.push(entry);
      continue;
    }
    const keep = Math.max(0, Math.min(1, entry.consumed || 0));
    reserved += keep;
    targets.set(entry.id, { claimantId: entry.id, target: keep, pinned: false, pool: 0, released: true });
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
  const even = free.length > 0 ? spare / free.length : 0;
  for (const entry of free) {
    targets.set(entry.id, { claimantId: entry.id, target: even, pinned: false, pool: 0, released: false });
  }

  let pool = free.length > 0 ? 0 : spare;
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

  return { targets, unusedPool: Math.max(0, pool) };
}

export function schedule(adapter, now = Date.now(), key = "five_hour", quotaOverride = null) {
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
  const entries = claimants.map((claimant) => {
    const observed = total > 0 ? usage.get(claimant.id).weighted / total : 0;
    return {
      id: claimant.id,
      share: claimant.share,
      priority: claimant.priority,
      state: effectiveState(claimant, now),
      consumed: live ? (live.usedPercent / 100) * observed : 0,
      cap: claimant.cap,
    };
  });

  const eligible = entries.filter((entry) => entry.state === "active" || entry.state === "needs-more").length;
  const { targets, unusedPool } = allocate(entries);

  const views = claimants.map((claimant) => {
    const allocation = targets.get(claimant.id) ?? {
      claimantId: claimant.id,
      target: 0,
      pinned: false,
      pool: 0,
      released: true,
    };
    const window = usage.get(claimant.id);
    const observed = total > 0 ? window.weighted / total : 0;
    return {
      claimant,
      allocation,
      usage: window,
      observed,
      state: effectiveState(claimant, now),
      stale: isStale(claimant, now),
      pressure:
        live || eligible > 1
          ? pressureFor(observed, allocation.target, live ? live.usedPercent : null)
          : { value: 0, basis: "share" },
      attributedPercent: live ? live.usedPercent * observed : null,
    };
  });

  const span = WINDOW_MS[key] ?? FIVE_HOUR_MS;
  return {
    adapter,
    key,
    now,
    quota,
    live,
    bounds,
    windowId: bounds.anchored ? bounds.to : Math.floor(now / span) * span,
    claimants: views,
    unusedPool,
    totalWeighted: total,
    lockouts: lockouts.sort((a, b) => a - b),
  };
}

export function viewFor(plan, id) {
  return plan.claimants.find((view) => view.claimant.id === id) ?? null;
}

export function pressureFor(consumedShare, target, quotaUsedPercent) {
  if (!(target > 0)) return { value: consumedShare > 0 ? 1 : 0, basis: "share" };
  if (typeof quotaUsedPercent === "number" && quotaUsedPercent >= 0) {
    return { value: (quotaUsedPercent / 100) * (consumedShare / target), basis: "budget" };
  }
  return { value: consumedShare / target, basis: "share" };
}

export const STAGES = [90, 80, 50];

export function stageFor(pressure) {
  for (const stage of STAGES) if (pressure >= stage / 100) return stage;
  return 0;
}

export function preserveText(preserve) {
  const list = Array.isArray(preserve) ? preserve.filter(Boolean) : [];
  if (list.length === 0) return "testing and finalisation";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function openingAdvice(view) {
  const target = Math.round(view.target * 100);
  return `[savemytokens] This session's target share of the current Claude window is ${target}%. Aim to complete the work within it: prioritise completion, and preserve enough capacity for ${preserveText(view.preserve)}. When you stop, report one of SMT: DONE, SMT: NEEDS_MORE or SMT: BLOCKED on its own line.`;
}

export function adviceFor(stage, view) {
  const target = Math.round(view.target * 100);
  const spent = Math.round(view.pressure * 100);
  const basis =
    view.basis === "budget"
      ? `${spent}% of your ${target}% target share of this window is spent`
      : `you are at ${Math.round(view.observed * 100)}% of observed usage against a ${target}% target`;
  if (stage === 90) {
    return `[savemytokens] ${basis}. Verification and finalisation only from here: no new exploration, finish what is open, run the tests, and report SMT: DONE, SMT: NEEDS_MORE or SMT: BLOCKED.`;
  }
  if (stage === 80) {
    return `[savemytokens] ${basis}. Stop optional exploration. Finish the current change and test it, and keep enough capacity for ${preserveText(view.preserve)}.`;
  }
  return `[savemytokens] ${basis}. Stay on completion of what was asked; skip side quests and wide reading.`;
}

const BUILTIN_THEMES = {
  default: {
    name: "default",
    colors: { fg: "#e6e6e6", dim: "#8a8a8a", accent: "#7aa2f7", ok: "#9ece6a", warn: "#e0af68", danger: "#f7768e", track: "#3b3b3b", fill: "#7aa2f7" },
    glyphs: { full: "█", empty: "░", sep: "·", arrow: "→", tag: "SMT" },
    border: { h: "─", v: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" },
  },
  minimal: {
    name: "minimal",
    colors: { fg: "#ffffff", dim: "#777777", accent: "#ffffff", ok: "#ffffff", warn: "#ffffff", danger: "#ffffff", track: "#444444", fill: "#ffffff" },
    glyphs: { full: "#", empty: ".", sep: "|", arrow: ">", tag: "smt" },
    border: { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" },
  },
  nord: {
    name: "nord",
    colors: { fg: "#eceff4", dim: "#4c566a", accent: "#88c0d0", ok: "#a3be8c", warn: "#ebcb8b", danger: "#bf616a", track: "#3b4252", fill: "#88c0d0" },
    glyphs: { full: "▰", empty: "▱", sep: "·", arrow: "→", tag: "SMT" },
    border: { h: "─", v: "│", tl: "╭", tr: "╮", bl: "╰", br: "╯" },
  },
  dracula: {
    name: "dracula",
    colors: { fg: "#f8f8f2", dim: "#6272a4", accent: "#bd93f9", ok: "#50fa7b", warn: "#f1fa8c", danger: "#ff5555", track: "#44475a", fill: "#bd93f9" },
    glyphs: { full: "█", empty: "▒", sep: "•", arrow: "→", tag: "SMT" },
    border: { h: "─", v: "│", tl: "╭", tr: "╮", bl: "╰", br: "╯" },
  },
  matrix: {
    name: "matrix",
    colors: { fg: "#8fff8f", dim: "#1f7a1f", accent: "#00ff41", ok: "#00ff41", warn: "#b6ff00", danger: "#ff3131", track: "#0b2b0b", fill: "#00ff41" },
    glyphs: { full: "▓", empty: "·", sep: "::", arrow: ">>", tag: "SMT" },
    border: { h: "═", v: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝" },
  },
};

export function builtinThemes() {
  return Object.keys(BUILTIN_THEMES);
}

export function userThemes() {
  return listJson(THEME_DIR).map((name) => name.slice(0, -5));
}

export function loadTheme(name) {
  const wanted = name || "default";
  const user = readJson(path.join(THEME_DIR, `${wanted}.json`), null);
  const base = BUILTIN_THEMES[wanted] || BUILTIN_THEMES.default;
  if (!user || typeof user !== "object") return base;
  return {
    ...base,
    ...user,
    name: wanted,
    colors: { ...base.colors, ...(user.colors || {}) },
    glyphs: { ...base.glyphs, ...(user.glyphs || {}) },
    border: { ...base.border, ...(user.border || {}) },
  };
}

function rgb(hex) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) return null;
  const number = Number.parseInt(value, 16);
  if (!Number.isFinite(number)) return null;
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

export function paint(theme, role, text, enabled = true) {
  if (!enabled || process.env.NO_COLOR !== undefined) return text;
  const parts = rgb(theme.colors?.[role]);
  if (!parts) return text;
  return `\u001b[38;2;${parts[0]};${parts[1]};${parts[2]}m${text}\u001b[0m`;
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

export function renderHud(layout, view, theme, enabled = true) {
  const tag = theme.glyphs?.tag ?? "SMT";
  const sep = ` ${theme.glyphs?.sep ?? "·"} `;
  const parts = [];
  const label = view.label || "session";
  const target = percentText((view.target ?? 0) * 100);
  const usedLabel = typeof view.used === "number" ? "used" : "share";
  const observed = percentText(typeof view.used === "number" ? view.used : (view.observed ?? 0) * 100);
  const priority = String(view.priority ?? "normal").toUpperCase();
  const quota = view.quota || {};
  const stale = view.stale ? paint(theme, "dim", " stale", enabled) : "";

  const windows = [];
  for (const key of ["five_hour", "seven_day", "spend_limit"]) {
    const window = quota[key];
    if (!window) continue;
    const reset = formatReset(window.resetsAt, view.now);
    windows.push(
      `${WINDOW_LABEL[key]} ${paint(theme, pressureRole(window.usedPercent / 100), percentText(window.usedPercent), enabled)}${reset ? paint(theme, "dim", ` ${reset}`, enabled) : ""}`,
    );
  }

  if (layout === "compact") {
    parts.push(paint(theme, "accent", tag, enabled));
    parts.push(`${label} ${paint(theme, pressureRole(view.pressure ?? 0), observed, enabled)}/${target}`);
    if (windows.length > 0) parts.push(windows[0]);
    return parts.join(sep) + stale;
  }

  if (layout === "global") {
    parts.push(paint(theme, "accent", tag, enabled));
    for (const window of windows) parts.push(window);
    parts.push(`${label} ${paint(theme, pressureRole(view.pressure ?? 0), observed, enabled)}/${target} ${paint(theme, "dim", priority, enabled)}`);
    return parts.join(sep) + stale;
  }

  parts.push(paint(theme, "accent", tag, enabled));
  parts.push(`${label} target ${target}`);
  parts.push(`${usedLabel} ${paint(theme, pressureRole(view.pressure ?? 0), observed, enabled)}`);
  parts.push(paint(theme, "dim", priority, enabled));
  if (windows.length > 0) parts.push(windows[0]);
  return parts.join(sep) + stale;
}
