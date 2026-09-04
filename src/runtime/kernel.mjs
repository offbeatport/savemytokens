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
  theme: { tui: "default", hud: "default" },
  layout: { hud: "allocation" },
  policy: "finish",
  policyFor: {},
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
    policyFor: { ...(stored.policyFor || {}) },
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

export function sampleFiles(adapter, id, files, now = Date.now()) {
  const record = loadMeter(adapter, id);
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
          record.prompt = entry.message.content.replace(/\s+/g, " ").trim().slice(0, 120);
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

export function signalIn(content) {
  const match = /SMT:\s*(DONE|NEEDS_MORE|BLOCKED)\b/.exec(blockText(content));
  return match ? match[1] : null;
}

export function defersIn(content) {
  const out = [];
  const pattern = /SMT:\s*DEFER\s+(.+)/g;
  let match;
  while ((match = pattern.exec(blockText(content))) !== null) {
    const text = String(match[1]).replace(/\s+/g, " ").trim().slice(0, 140);
    if (text) out.push(text);
  }
  return out;
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

  let pool = free.length > 0 ? 0 : Math.min(spare, released);
  const idle = free.length > 0 ? 0 : spare - pool;
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

  return { targets, unusedPool: Math.max(0, pool + idle) };
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

export function adviceFor(stage, view) {
  const policy = view.policy ?? POLICIES[DEFAULT_POLICY];
  const target = Math.round(view.target * 100);
  const spent = Math.round(view.pressure * 100);
  const basis =
    view.basis === "budget"
      ? `${spent}% of your ${target}% target share of this Claude window is spent`
      : `you are at ${Math.round(view.observed * 100)}% of measured usage against a ${target}% target`;
  const body = actionsFor(stage, policy).map((action) => (ACTION_TEXT[action] ?? (() => ""))(view));
  return `[savemytokens] ${basis}. ${body.join(" ")}`.trim();
}

export function deferredAdvice(items) {
  const lines = items.slice(-5).map((item) => `  · ${item.text}`);
  return `[savemytokens] Deferred earlier in this project:\n${lines.join("\n")}\nPick these up only if they fit inside your target share. Clear them with: npx savemytokens defer clear`;
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
