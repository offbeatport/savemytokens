import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { LifetimeCost } from "../../core/cost.js";
import { hash32 } from "../../core/hash.js";
import { usd } from "../../core/pricing.js";
import { addUsage, emptyUsage, estimateTokens, weigh } from "../../core/tokens.js";
import {
  EVIDENCE_SCHEMA,
  type ModelUse,
  type SessionEvidence,
  type TaskOutcome,
  type TaskSummary,
  type Usage,
} from "../../core/types.js";

export const LARGE_OUTPUT_CHARS = 10_000;
export const USEFUL_OUTPUT_CHARS = 2_000;
export const HIGH_CONTEXT_TOKENS = 120_000;
export const DEAD_CARRY_TOKENS = 80_000;
export const DEAD_CARRY_MIN_TURNS = 5;
const ANAPHORIC_OPENER =
  /^\s*(ok|okay|now|also|and|then|next|again|yes|no|nope|yep|same|do the same|the other|these|those|them|it|that|this|continue|carry on|keep going|go on|more|another|fix (it|that|this)|try again|redo|revert|undo|hmm|wait|great|nice|thanks|perfect|good)\b/i;

export function isSelfContained(prompt: string): boolean {
  const text = prompt.trim();
  if (text.length < 40) return false;
  if (ANAPHORIC_OPENER.test(text)) return false;
  return true;
}
export const PREMIUM_MODELS = /opus/i;
const MECHANICAL_TOOLS = new Set(["Bash", "Grep", "Glob", "Read", "WebFetch", "WebSearch"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob", "WebSearch"]);
const MAX_BUCKETS = 24;
const MAX_PENDING_TOOLS = 4_000;

interface Bucket {
  key: string;
  tool: string;
  count: number;
  chars: number;
  maxChars: number;
  edits: number;
  signature: string;
  wastedChars: number;
  wastedCount: number;
  cost: LifetimeCost;
}

interface PendingTool {
  name: string;
  turn: number;
  segment: number;
  filePath?: string;
  command?: string;
  pattern?: string;
  offset?: number;
  limit?: number;
  contentChars?: number;
}

interface TaskState extends TaskSummary {
  modelSet: Set<string>;
  fileSet: Set<string>;
}

function bucket(map: Map<string, Bucket>, key: string, tool: string): Bucket {
  let b = map.get(key);
  if (!b) {
    b = { key, tool, count: 0, chars: 0, maxChars: 0, edits: 0, signature: "", wastedChars: 0, wastedCount: 0, cost: new LifetimeCost() };
    map.set(key, b);
  }
  return b;
}

function blockChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let total = 0;
    for (const item of content) {
      if (typeof item === "string") total += item.length;
      else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") total += rec.text.length;
        else if (typeof rec.content === "string") total += rec.content.length;
        else if (rec.type === "image") total += 4_000;
      }
    }
    return total;
  }
  if (content && typeof content === "object") return JSON.stringify(content).length;
  return 0;
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") parts.push(item);
      else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") parts.push(rec.text);
        else if (typeof rec.content === "string") parts.push(rec.content);
      }
    }
    return parts.join("\n");
  }
  return "";
}

const NOISE_COMMANDS = new Set(["cd", "export", "set", "source", ".", "echo", "true", "sudo", "time", "env"]);

export function commandLabel(command: string): string {
  const segments = command.split("\n")[0]?.split(/&&|\|\||;|\|/) ?? [];
  for (const segment of segments) {
    const words: string[] = [];
    for (const raw of segment.trim().split(/\s+/)) {
      const word = raw.replace(/^["'`(]+|["'`)]+$/g, "");
      if (!word) continue;
      if (word.startsWith("-")) continue;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
      if (words.length === 0 && NOISE_COMMANDS.has(word)) break;
      const clean = /[/~]/.test(word) && words.length > 0 ? path.basename(word) : word;
      words.push(clean.slice(0, 28));
      if (words.length === 2) break;
    }
    if (words.length > 0) return words.join(" ");
  }
  return "shell command";
}

function displayPath(filePath: string, cwd: string): string {
  if (cwd && filePath.startsWith(cwd + path.sep)) return filePath.slice(cwd.length + 1);
  const home = process.env.HOME ?? "";
  if (home && filePath.startsWith(home + path.sep)) return "~/" + filePath.slice(home.length + 1);
  return filePath;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

function topBuckets(map: Map<string, Bucket>, segmentEnds: number[]) {
  return [...map.values()]
    .map((b) => ({ ...b, weighted: b.cost.resolve(segmentEnds) }))
    .sort((a, b) => b.weighted - a.weighted || b.chars - a.chars)
    .slice(0, MAX_BUCKETS);
}

export async function parseClaudeSession(file: string, stat: fs.Stats): Promise<SessionEvidence | null> {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const usage = emptyUsage();
  const models = new Map<string, ModelUse>();
  const seenMessages = new Set<string>();
  const pending = new Map<string, PendingTool>();
  const readHashes = new Map<string, number>();
  const hookHashes = new Map<string, number>();
  const reads = new Map<string, Bucket>();
  const outputs = new Map<string, Bucket>();
  const hooks = new Map<string, Bucket>();
  const writes = new Map<string, Bucket>();
  const failures = new Map<string, Bucket>();
  const attachments = new Map<string, { events: number; chars: number }>();
  const tasks: TaskState[] = [];
  const contexts: number[] = [];
  const segmentEnds: number[] = [];

  let sessionId = path.basename(file, ".jsonl");
  let cwd = "";
  let agentVersion = "";
  let startedAt = 0;
  let endedAt = 0;
  let turn = 0;
  let segment = 0;
  let humanPrompts = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let apiErrors = 0;
  let rateLimitHits = 0;
  let lastRateLimitAt = 0;
  let interruptions = 0;
  let sidechainTurns = 0;
  let sidechainWeighted = 0;
  let peakContext = 0;
  let bloatTurns = 0;
  let bloatTokens = 0;
  let bloatWeighted = 0;
  let searchChars = 0;
  let current: TaskState | null = null;

  const openTask = (id: string, ts: number, prompt: string): TaskState => {
    const task: TaskState = {
      id,
      sessionId,
      project: cwd,
      prompt: prompt.replace(/\s+/g, " ").trim().slice(0, 120),
      startedAt: ts,
      endedAt: ts,
      promptChars: prompt.length,
      turns: 0,
      toolCalls: 0,
      models: [],
      modelSet: new Set<string>(),
      fileSet: new Set<string>(),
      usage: emptyUsage(),
      weighted: 0,
      usd: 0,
      peakContext: 0,
      carriedContext: 0,
      carriedUsd: 0,
      carriedIsDead: false,
      touchedPriorFiles: false,
      selfContained: isSelfContained(prompt),
      outcome: "completed",
      toolErrors: 0,
    };
    tasks.push(task);
    return task;
  };

  for await (const line of rl) {
    if (!line || line.charCodeAt(0) !== 123) continue;
    let record: Record<string, any>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (ts > endedAt) endedAt = ts;
      if (current) current.endedAt = ts;
    }
    if (!cwd && typeof record.cwd === "string") cwd = record.cwd;
    if (!agentVersion && typeof record.version === "string") agentVersion = record.version;
    if (typeof record.sessionId === "string") sessionId = record.sessionId;

    switch (record.type) {
      case "assistant": {
        const message = record.message;
        if (!message) break;
        const messageId: string = message.id ?? record.uuid ?? String(turn);
        const model: string = message.model ?? "unknown";
        const fresh = !seenMessages.has(messageId);
        if (fresh) {
          seenMessages.add(messageId);
          const u = message.usage ?? {};
          const turnUsage: Usage = {
            input: u.input_tokens ?? 0,
            output: u.output_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
          };
          const turnWeighted = weigh(turnUsage);
          const context = turnUsage.input + turnUsage.cacheRead + turnUsage.cacheWrite;
          if (context > 0) {
            turn++;
            contexts.push(context);
            if (context > peakContext) peakContext = context;
            if (context > HIGH_CONTEXT_TOKENS) {
              bloatTurns++;
              const excess = context - HIGH_CONTEXT_TOKENS;
              bloatTokens += excess;
              bloatWeighted += excess * 0.1;
            }
          }
          addUsage(usage, turnUsage);
          if (record.isSidechain) {
            sidechainTurns++;
            sidechainWeighted += turnWeighted;
          }
          let entry = models.get(model);
          if (!entry) {
            entry = { model, turns: 0, usage: emptyUsage(), weighted: 0, trivialTurns: 0, trivialWeighted: 0 };
            models.set(model, entry);
          }
          entry.turns++;
          addUsage(entry.usage, turnUsage);
          entry.weighted += turnWeighted;

          const blocks: any[] = Array.isArray(message.content) ? message.content : [];
          const onlyMechanical =
            blocks.length > 0 &&
            blocks.every((b) => b.type !== "text") &&
            blocks.some((b) => b.type === "tool_use" && MECHANICAL_TOOLS.has(b.name));
          if (PREMIUM_MODELS.test(model) && onlyMechanical && turnUsage.output < 600) {
            entry.trivialTurns++;
            entry.trivialWeighted += turnWeighted;
          }

          if (current) {
            if (current.turns === 0) current.carriedContext = turnUsage.cacheRead + turnUsage.input;
            current.turns++;
            addUsage(current.usage, turnUsage);
            current.weighted += turnWeighted;
            current.usd += usd(model, turnUsage);
            current.modelSet.add(model);
            if (context > current.peakContext) current.peakContext = context;
          }
        }
        if (record.isApiErrorMessage) {
          apiErrors++;
          const text = Array.isArray(message.content)
            ? message.content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join(" ")
            : "";
          if (/\blimit\b/i.test(text) || record.quotaLimits?.status === "rejected") {
            const at = Number.isFinite(ts) ? ts : lastRateLimitAt;
            if (at - lastRateLimitAt > 5 * 60 * 1000 || lastRateLimitAt === 0) rateLimitHits++;
            lastRateLimitAt = at;
          }
          if (current) current.outcome = "failed";
        }
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (block?.type !== "tool_use") continue;
          toolCalls++;
          if (pending.size > MAX_PENDING_TOOLS) pending.clear();
          const input = block.input ?? {};
          if (current) {
            current.toolCalls++;
            if (typeof input.file_path === "string") current.fileSet.add(input.file_path);
          }
          pending.set(block.id, {
            name: block.name ?? "unknown",
            turn,
            segment,
            filePath: typeof input.file_path === "string" ? input.file_path : undefined,
            command: typeof input.command === "string" ? input.command : undefined,
            pattern: typeof input.pattern === "string" ? input.pattern : undefined,
            offset: typeof input.offset === "number" ? input.offset : undefined,
            limit: typeof input.limit === "number" ? input.limit : undefined,
            contentChars:
              typeof input.content === "string"
                ? input.content.length
                : typeof input.new_string === "string"
                  ? input.new_string.length
                  : undefined,
          });
          if (block.name === "Write" && typeof input.file_path === "string") {
            const key = displayPath(input.file_path, cwd);
            const b = bucket(writes, key, "Write");
            b.count++;
            const chars = typeof input.content === "string" ? input.content.length : 0;
            b.chars += chars;
            if (b.count > 1) {
              b.wastedCount++;
              b.wastedChars += chars;
              b.cost.add(segment, turn, estimateTokens(chars));
            }
          } else if (block.name === "Edit" && typeof input.file_path === "string") {
            bucket(writes, displayPath(input.file_path, cwd), "Write").edits++;
          }
        }
        break;
      }

      case "user": {
        if (record.interruptedMessageId) {
          interruptions++;
          if (current && current.outcome === "completed") current.outcome = "interrupted";
        }
        const content = record.message?.content;
        if (typeof content === "string") {
          const isHuman = record.origin?.kind === "human" || record.promptSource === "typed";
          if (isHuman && content.length > 0) {
            humanPrompts++;
            current = openTask(record.promptId ?? record.uuid ?? `task-${tasks.length}`, Number.isFinite(ts) ? ts : 0, content);
          }
          break;
        }
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block?.type !== "tool_result") continue;
          const meta = pending.get(block.tool_use_id);
          pending.delete(block.tool_use_id);
          const tool = meta?.name ?? "unknown";
          const atTurn = meta?.turn ?? turn;
          const atSegment = meta?.segment ?? segment;
          const chars = blockChars(block.content);
          const result = record.toolUseResult;
          const isError = block.is_error === true || result?.interrupted === true;

          if (SEARCH_TOOLS.has(tool)) searchChars += chars;

          if (isError) {
            toolErrors++;
            if (current) current.toolErrors++;
            const label = meta?.command ? commandLabel(meta.command) : tool;
            const b = bucket(failures, label, tool);
            b.count++;
            b.chars += chars;
            b.wastedChars += chars;
            b.wastedCount++;
            b.cost.add(atSegment, atTurn, estimateTokens(chars));
          }

          const fileResult = result?.file;
          const readPath: string | undefined =
            typeof fileResult?.filePath === "string" ? fileResult.filePath : tool === "Read" ? meta?.filePath : undefined;
          if (readPath) {
            const range = fileResult
              ? `${fileResult.startLine ?? 1}-${fileResult.numLines ?? fileResult.totalLines ?? 0}`
              : `${meta?.offset ?? 1}-${meta?.limit ?? 0}`;
            const key = displayPath(readPath, cwd);
            const payload = fileResult?.content != null ? String(fileResult.content) : blockText(block.content);
            const fingerprint = `${key}#${range}#${hash32(payload)}`;
            const seen = readHashes.get(fingerprint) ?? 0;
            readHashes.set(fingerprint, seen + 1);
            const b = bucket(reads, key, "Read");
            if (!b.signature) b.signature = fingerprint;
            b.count++;
            b.chars += chars;
            if (seen > 0) {
              b.wastedCount++;
              b.wastedChars += chars;
              b.cost.add(atSegment, atTurn, estimateTokens(chars));
            }
          }

          if (chars > LARGE_OUTPUT_CHARS) {
            const label = meta?.command
              ? commandLabel(meta.command)
              : meta?.filePath
                ? `${tool} ${path.basename(meta.filePath)}`
                : meta?.pattern
                  ? `${tool} ${meta.pattern.slice(0, 24)}`
                  : tool;
            const b = bucket(outputs, label, tool);
            b.count++;
            b.chars += chars;
            if (chars > b.maxChars) b.maxChars = chars;
            const excess = chars - USEFUL_OUTPUT_CHARS;
            b.wastedChars += excess;
            b.wastedCount++;
            b.cost.add(atSegment, atTurn, estimateTokens(excess));
          }
        }
        break;
      }

      case "attachment": {
        const attachment = record.attachment;
        if (!attachment?.type) break;
        const type: string = attachment.type;
        let chars = 0;
        if (type === "hook_success") {
          const payload = String(attachment.content || "") + String(attachment.stdout || "");
          chars = payload.length;
          if (chars > 0) {
            const name = String(attachment.hookName ?? "hook");
            const fingerprint = `${name}#${hash32(payload)}`;
            const seen = hookHashes.get(fingerprint) ?? 0;
            hookHashes.set(fingerprint, seen + 1);
            const b = bucket(hooks, name, "hook");
            b.count++;
            b.chars += chars;
            if (seen > 0) {
              b.wastedCount++;
              b.wastedChars += chars;
              b.cost.add(segment, turn, estimateTokens(chars));
            }
          }
        } else if (type === "file" || type === "already_read_file") {
          const inner = attachment.content;
          chars = blockChars(inner?.file?.content ?? inner);
          const filePath = attachment.filename ?? inner?.file?.filePath;
          if (typeof filePath === "string" && chars > 0) {
            const key = displayPath(filePath, cwd);
            const fingerprint = `${key}#attach#${hash32(String(inner?.file?.content ?? ""))}`;
            const seen = readHashes.get(fingerprint) ?? 0;
            readHashes.set(fingerprint, seen + 1);
            const b = bucket(reads, key, "attachment");
            if (!b.signature) b.signature = fingerprint;
            b.count++;
            b.chars += chars;
            if (seen > 0) {
              b.wastedCount++;
              b.wastedChars += chars;
              b.cost.add(segment, turn, estimateTokens(chars));
            }
          }
        } else if (type === "edited_text_file") {
          chars = String(attachment.snippet ?? "").length;
          const filePath = attachment.filename;
          if (typeof filePath === "string" && chars > 0) {
            const key = displayPath(filePath, cwd);
            const fingerprint = `${key}#edit#${hash32(String(attachment.snippet ?? ""))}`;
            const seen = readHashes.get(fingerprint) ?? 0;
            readHashes.set(fingerprint, seen + 1);
            const b = bucket(reads, key, "editor");
            if (!b.signature) b.signature = fingerprint;
            b.count++;
            b.chars += chars;
            if (seen > 0) {
              b.wastedCount++;
              b.wastedChars += chars;
              b.cost.add(segment, turn, estimateTokens(chars));
            }
          }
        } else {
          chars = blockChars(attachment.content ?? attachment.text ?? "");
        }
        const acc = attachments.get(type) ?? { events: 0, chars: 0 };
        acc.events++;
        acc.chars += chars;
        attachments.set(type, acc);
        break;
      }

      case "system": {
        if (record.subtype === "compact_boundary") {
          segmentEnds[segment] = turn;
          segment++;
        }
        break;
      }

      default:
        break;
    }
  }

  if (turn === 0) return null;
  segmentEnds[segment] = turn;

  const resolved = {
    reads: topBuckets(reads, segmentEnds),
    outputs: topBuckets(outputs, segmentEnds),
    hooks: topBuckets(hooks, segmentEnds),
    writes: topBuckets(writes, segmentEnds),
    failures: topBuckets(failures, segmentEnds),
  };

  const seenFiles = new Set<string>();
  const finishedTasks: TaskSummary[] = tasks.map((t) => {
    const { modelSet, fileSet, ...rest } = t;
    const models = [...modelSet];
    const touchedPriorFiles = [...fileSet].some((f) => seenFiles.has(f));
    for (const f of fileSet) seenFiles.add(f);
    const carriedUsd = usd(models[0] ?? "claude-opus-5", {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: rest.carriedContext * rest.turns,
    });
    const carriedIsDead =
      rest.carriedContext >= DEAD_CARRY_TOKENS &&
      rest.turns >= DEAD_CARRY_MIN_TURNS &&
      rest.selfContained &&
      !touchedPriorFiles;
    return { ...rest, models, touchedPriorFiles, carriedUsd, carriedIsDead, project: cwd };
  });

  return {
    schema: EVIDENCE_SCHEMA,
    adapter: "claude-code",
    sessionId,
    project: cwd || "unknown",
    sourceFile: file,
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    agentVersion,
    startedAt,
    endedAt,
    turns: turn,
    humanPrompts,
    usage,
    weighted: weigh(usage),
    peakContext,
    contextP50: median(contexts),
    compactions: segment,
    coldStart: turn <= 3 && usage.cacheWrite > usage.cacheRead,
    bloatTurns,
    bloatTokens,
    bloatWeighted,
    apiErrors,
    rateLimitHits,
    interruptions,
    toolCalls,
    toolErrors,
    sidechainTurns,
    sidechainWeighted,
    searchChars,
    models: [...models.values()],
    tasks: finishedTasks,
    reads: resolved.reads.map((b) => ({
      path: b.key,
      signature: b.signature,
      reads: b.count,
      chars: b.chars,
      redundantReads: b.wastedCount,
      redundantChars: b.wastedChars,
      redundantWeighted: b.weighted,
    })),
    outputs: resolved.outputs.map((b) => ({
      label: b.key,
      tool: b.tool,
      calls: b.count,
      chars: b.chars,
      maxChars: b.maxChars,
      excessChars: b.wastedChars,
      excessWeighted: b.weighted,
    })),
    hooks: resolved.hooks.map((b) => ({
      name: b.key,
      events: b.count,
      chars: b.chars,
      weighted: b.weighted,
    })),
    attachments: [...attachments.entries()].map(([type, v]) => ({ type, events: v.events, chars: v.chars })),
    writes: resolved.writes.map((b) => ({
      path: b.key,
      writes: b.count,
      edits: b.edits,
      rewrittenChars: b.wastedChars,
      rewrittenWeighted: b.weighted,
    })),
    failures: resolved.failures.map((b) => ({
      label: b.key,
      tool: b.tool,
      failures: b.count,
      chars: b.chars,
      weighted: b.weighted,
    })),
  };
}
