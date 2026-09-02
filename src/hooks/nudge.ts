export const HOOK_FILENAME = "nudge.cjs";
export const NUDGE_CONTEXT_TOKENS = 150_000;
export const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;
export const NUDGE_HORIZON_TURNS = 10;

export const HOOK_SCRIPT = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOME = process.env.SAVEMYTOKENS_HOME || path.join(os.homedir(), ".savemytokens");
const STATE = path.join(HOME, "nudges.json");
const THRESHOLD = 150000;
const COOLDOWN_MS = 30 * 60 * 1000;
const TAIL_BYTES = 262144;
const RATE_PER_TOKEN = 5 / 1000000;
const CACHE_READ = 0.1;
const HORIZON_TURNS = 10;
const ANAPHORIC =
  /^\s*(ok|okay|now|also|and|then|next|again|yes|no|nope|yep|same|do the same|the other|these|those|them|it|that|this|continue|carry on|keep going|go on|more|another|fix (it|that|this)|try again|redo|revert|undo|hmm|wait|great|nice|thanks|perfect|good)\b/i;

function selfContained(prompt) {
  const text = String(prompt || "").trim();
  return text.length >= 40 && !ANAPHORIC.test(text);
}

function tailLines(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8").split("\n");
  } finally {
    fs.closeSync(fd);
  }
}

function currentContext(file) {
  const lines = tailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.indexOf('"usage"') === -1) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = record && record.message && record.message.usage;
    if (!usage) continue;
    const total =
      (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    if (total > 0) return total;
  }
  return 0;
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE, "utf8"));
    if (parsed && Array.isArray(parsed.events)) return parsed;
  } catch {}
  return { installedAt: Date.now(), events: [] };
}

function writeState(state) {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    state.events = state.events.slice(-500);
    fs.writeFileSync(STATE, JSON.stringify(state));
  } catch {}
}

function run() {
  const raw = fs.readFileSync(0, "utf8");
  if (!raw) return;
  const input = JSON.parse(raw);
  if (!input || !input.transcript_path || !selfContained(input.prompt)) return;
  if (!fs.existsSync(input.transcript_path)) return;

  const context = currentContext(input.transcript_path);
  if (context < THRESHOLD) return;

  const state = readState();
  const now = Date.now();
  const recent = state.events.filter((event) => event.session === input.session_id).pop();
  if (recent && now - recent.at < COOLDOWN_MS) return;

  const horizon = context * CACHE_READ * RATE_PER_TOKEN * HORIZON_TURNS;
  const thousands = Math.round(context / 1000);

  state.events.push({ at: now, session: input.session_id, context: context, usd: horizon });
  writeState(state);

  process.stdout.write(
    "[savemytokens] This reads as a new task and " +
      thousands +
      "k tokens of earlier work are still in context, about $" +
      horizon.toFixed(2) +
      " per " +
      HORIZON_TURNS +
      " turns from here. Open your reply with one short line saying so, and that /clear or a fresh session drops it. Then do what was asked.\n",
  );
}

try {
  run();
} catch {}
process.exit(0);
`;
