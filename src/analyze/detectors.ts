import { HIGH_CONTEXT_TOKENS } from "../adapters/claude-code/parse.js";
import type { Finding } from "../core/types.js";
import { bytes, compactNumber, percent, plural, shortPath } from "../util/fmt.js";
import type { Aggregate } from "./aggregate.js";

const MIN_RATIO = 0.004;
const RECOVERABLE_CONTEXT = 0.4;
const RECOVERABLE_ROUTING = 0.4;
const MIN_TRIVIAL_TURNS = 20;

export type Detector = (agg: Aggregate) => Finding | null;

function finding(input: Omit<Finding, "wasteRatio"> & { total: number }): Finding | null {
  const { total, ...rest } = input;
  if (total <= 0) return null;
  const wasteRatio = rest.wastedWeighted / total;
  if (wasteRatio < MIN_RATIO) return null;
  return { ...rest, wasteRatio };
}

const repeatedReads: Detector = (agg) => {
  if (agg.reads.length === 0) return null;
  const wasted = agg.reads.reduce((sum, r) => sum + r.weighted, 0);
  const redundantReads = agg.reads.reduce((sum, r) => sum + r.extra.redundantReads, 0);
  const redundantChars = agg.reads.reduce((sum, r) => sum + r.extra.redundantChars, 0);
  const top = agg.reads[0];
  if (!top || redundantReads === 0) return null;
  const second = agg.reads[1];
  return finding({
    total: agg.totals.weighted,
    id: "repeated-reads",
    title: "Repeated context reads",
    confidence: "estimated",
    wastedWeighted: wasted,
    measured: [
      `${redundantReads} identical ${plural(redundantReads, "re-read")} of ${agg.reads.length} ${plural(agg.reads.length, "file")} (${bytes(redundantChars)} re-sent unchanged)`,
      `worst: ${shortPath(top.key)} — ${top.extra.redundantReads}× after the first read`,
    ],
    fix:
      `Read ${shortPath(top.key)} once, then work from it${second ? ` (same for ${shortPath(second.key)})` : ""}. ` +
      `When you only need part of a file, ask for a line range instead of the whole file, and put facts you keep re-reading (exports, schema, conventions) in CLAUDE.md so they ride along once per session.`,
    detail: agg.reads.slice(0, 5).map((r) => `${shortPath(r.key)} · ${r.extra.redundantReads}× · ${bytes(r.extra.redundantChars)}`),
  });
};

const largeOutput: Detector = (agg) => {
  if (agg.outputs.length === 0) return null;
  const wasted = agg.outputs.reduce((sum, o) => sum + o.weighted, 0);
  const calls = agg.outputs.reduce((sum, o) => sum + o.extra.calls, 0);
  const chars = agg.outputs.reduce((sum, o) => sum + o.chars, 0);
  const top = agg.outputs[0];
  if (!top) return null;
  const fixFor = (tool: string, label: string): string => {
    if (tool === "Read") return `Read it with an offset and limit, or grep for the symbol you need instead of loading the whole file.`;
    if (tool === "Grep" || tool === "Glob")
      return `Narrow it: match on file names only, add a head limit, or scope it to one directory.`;
    if (tool === "Bash")
      return `Pipe it down: \`${label} 2>&1 | tail -40\`, or write the full log to a file and grep the failing lines out of it.`;
    if (tool === "TaskOutput" || tool === "Agent" || tool === "Workflow")
      return `Ask the subagent for a short answer instead of its raw transcript — the point of delegating is that the big output stays out of your context.`;
    if (tool === "WebFetch" || tool === "WebSearch")
      return `Ask for the specific fact you need in the fetch prompt so the page comes back summarised, not whole.`;
    return `Ask for a narrower result — the full payload is being carried in context for the rest of the session.`;
  };
  return finding({
    total: agg.totals.weighted,
    id: "large-output",
    title: "Oversized command output",
    confidence: "estimated",
    wastedWeighted: wasted,
    measured: [
      `${calls} tool ${plural(calls, "result")} over 10 KB returned ${bytes(chars)} in total`,
      `worst: ${shortPath(top.key)} — ${top.extra.calls}×, largest ${bytes(top.extra.maxChars)}`,
    ],
    fix: `${shortPath(top.key)} dumped ${bytes(top.chars)} into context across ${top.extra.calls} ${plural(top.extra.calls, "run")}. ${fixFor(top.extra.tool, shortPath(top.key))}`,
    detail: agg.outputs.slice(0, 5).map((o) => `${shortPath(o.key)} · ${o.extra.calls}× · ${bytes(o.chars)}`),
  });
};

const hookNoise: Detector = (agg) => {
  if (agg.hooks.length === 0) return null;
  const wasted = agg.hooks.reduce((sum, h) => sum + h.weighted, 0);
  const top = agg.hooks[0];
  if (!top) return null;
  const events = agg.hooks.reduce((sum, h) => sum + h.extra.events, 0);
  return finding({
    total: agg.totals.weighted,
    id: "hook-noise",
    title: "Hook output injected into context",
    confidence: "estimated",
    wastedWeighted: wasted,
    measured: [
      `${events} hook ${plural(events, "event")} printed ${bytes(agg.hooks.reduce((s, h) => s + h.chars, 0))} into context`,
      `worst: ${shortPath(top.key)} — the same output repeated ${top.extra.events}×`,
    ],
    fix: `The ${shortPath(top.key)} hook re-prints identical output on nearly every tool call. Send its stdout to /dev/null in ~/.claude/settings.json (hook stdout is added to the transcript, so it is re-read on every later turn).`,
    detail: agg.hooks.slice(0, 5).map((h) => `${shortPath(h.key)} · ${h.extra.events}× · ${bytes(h.chars)}`),
  });
};

const failedTools: Detector = (agg) => {
  if (agg.failures.length === 0) return null;
  const wasted = agg.failures.reduce((sum, f) => sum + f.weighted, 0);
  const total = agg.failures.reduce((sum, f) => sum + f.extra.failures, 0);
  const top = agg.failures[0];
  if (!top || total === 0) return null;
  return finding({
    total: agg.totals.weighted,
    id: "failed-tools",
    title: "Failed and interrupted commands",
    confidence: "estimated",
    wastedWeighted: wasted,
    measured: [
      `${total} failed tool ${plural(total, "call")} returned ${bytes(agg.failures.reduce((s, f) => s + f.chars, 0))} of error output`,
      `worst: ${shortPath(top.key)} — failed ${top.extra.failures}×`,
    ],
    fix: `${shortPath(top.key)} failed ${top.extra.failures}× and every failure paid for its own error dump plus a retry. Get it green in a terminal first, or wrap the flaky step so the agent sees one line instead of a stack trace.`,
    detail: agg.failures.slice(0, 5).map((f) => `${shortPath(f.key)} · ${f.extra.failures} ${plural(f.extra.failures, "failure")} · ${bytes(f.chars)}`),
  });
};

const contextBloat: Detector = (agg) => {
  if (agg.bloat.turns === 0) return null;
  return finding({
    total: agg.totals.weighted,
    id: "context-bloat",
    title: "Sessions running at high context",
    confidence: "estimated",
    wastedWeighted: agg.bloat.weighted * RECOVERABLE_CONTEXT,
    measured: [
      `${agg.bloat.turns} ${plural(agg.bloat.turns, "turn")} across ${agg.bloat.sessions} ${plural(agg.bloat.sessions, "session")} ran above ${compactNumber(HIGH_CONTEXT_TOKENS)} context`,
      `${compactNumber(agg.bloat.tokens)} tokens were re-read past that line (peak context ${compactNumber(agg.bloat.peak)})`,
    ],
    fix: `Every turn re-reads the whole context. Start a fresh session when you switch tasks instead of continuing a long one — the ${agg.bloat.turns} turns above ${compactNumber(HIGH_CONTEXT_TOKENS)} paid ${compactNumber(agg.bloat.tokens)} tokens for context that was mostly finished work.`,
  });
};

const writeChurn: Detector = (agg) => {
  if (agg.writes.length === 0) return null;
  const wasted = agg.writes.reduce((sum, w) => sum + w.weighted, 0);
  const top = agg.writes[0];
  if (!top) return null;
  return finding({
    total: agg.totals.weighted,
    id: "write-churn",
    title: "Files rewritten whole",
    confidence: "estimated",
    wastedWeighted: wasted,
    measured: [
      `${agg.writes.length} ${plural(agg.writes.length, "file")} were written in full more than once (${bytes(agg.writes.reduce((s, w) => s + w.extra.rewrittenChars, 0))} re-sent)`,
      `worst: ${shortPath(top.key)} — ${top.extra.writes} full writes${top.extra.edits > 0 ? ` and ${top.extra.edits} edits` : ""}`,
    ],
    fix: `${shortPath(top.key)} was rewritten end to end ${top.extra.writes}×; each rewrite sends the entire file as output tokens, the most expensive kind. Ask for targeted edits once a file exists.`,
    detail: agg.writes.slice(0, 5).map((w) => `${shortPath(w.key)} · ${w.extra.writes} writes · ${bytes(w.extra.rewrittenChars)}`),
  });
};

const coldCache: Detector = (agg) => {
  if (agg.coldSessions < 3) return null;
  return finding({
    total: agg.totals.weighted,
    id: "cold-cache",
    title: "Sessions abandoned before the cache pays off",
    confidence: "measured",
    wastedWeighted: agg.coldWeighted,
    measured: [
      `${agg.coldSessions} ${plural(agg.coldSessions, "session")} ended within 3 turns`,
      `each one paid a full prompt-cache write that was never read back`,
    ],
    fix: `A new session re-uploads your CLAUDE.md, tools and skills at 1.25× before anything useful happens. Keep related questions in one session so the cache is read at 0.1× instead of rewritten.`,
  });
};

const modelRouting: Detector = (agg) => {
  const premium = agg.models.filter((m) => m.trivialTurns > 0);
  if (premium.length === 0) return null;
  const trivialWeighted = premium.reduce((sum, m) => sum + m.trivialWeighted, 0);
  const trivialTurns = premium.reduce((sum, m) => sum + m.trivialTurns, 0);
  const top = premium[0];
  if (!top || trivialTurns < MIN_TRIVIAL_TURNS) return null;
  return finding({
    total: agg.totals.weighted,
    id: "model-routing",
    title: "Premium model doing mechanical work",
    confidence: "estimated",
    wastedWeighted: trivialWeighted * RECOVERABLE_ROUTING,
    measured: [
      `${trivialTurns} ${top.model} ${plural(trivialTurns, "turn")} were a single mechanical tool call (Bash, Read, Grep) with almost no reasoning`,
      `those turns carried ${percent(trivialWeighted / Math.max(1, agg.totals.weighted))} of total token cost`,
    ],
    fix: `Hand log reading, searching and file discovery to a subagent — the results come back summarised, so the big outputs never enter your main context and the mechanical turns run on a cheaper model.`,
  });
};

export const detectors: Detector[] = [
  repeatedReads,
  largeOutput,
  hookNoise,
  contextBloat,
  failedTools,
  writeChurn,
  coldCache,
  modelRouting,
];

export function runDetectors(agg: Aggregate): Finding[] {
  const findings: Finding[] = [];
  for (const detector of detectors) {
    const result = detector(agg);
    if (result) findings.push(result);
  }
  return findings.sort((a, b) => b.wasteRatio - a.wasteRatio);
}
