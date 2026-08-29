import { DEAD_CARRY_TOKENS } from "../adapters/claude-code/parse.js";
import type { Finding, TaskSummary } from "../core/types.js";
import { bytes, compactNumber, money, plural, shortPath } from "../util/fmt.js";
import type { Aggregate } from "./aggregate.js";

const MIN_RATIO = 0.004;
const MIN_USD = 1;
const RECOVERABLE_ROUNDTRIPS = 0.4;
const MIN_TRIVIAL_TURNS = 20;

export type Detector = (agg: Aggregate) => Finding | null;

function usdPerWeighted(agg: Aggregate): number {
  return agg.totals.weighted > 0 ? agg.totals.usd / agg.totals.weighted : 0;
}

function finding(agg: Aggregate, input: Omit<Finding, "wasteRatio" | "wastedUsd">): Finding | null {
  const total = agg.totals.weighted;
  if (total <= 0) return null;
  const wasteRatio = input.wastedWeighted / total;
  const wastedUsd = input.wastedWeighted * usdPerWeighted(agg);
  if (wasteRatio < MIN_RATIO || wastedUsd < MIN_USD) return null;
  return { ...input, wasteRatio, wastedUsd };
}

function receipt(task: TaskSummary, amount: number, note: string): string {
  const project = (task.project || "").split("/").pop() || "unknown";
  const prompt = task.prompt.length > 58 ? `${task.prompt.slice(0, 58)}…` : task.prompt;
  return `${money(amount).padStart(6)}  ${project} · "${prompt}" — ${note}`;
}

const deadCarry: Detector = (agg) => {
  const dead = agg.deadCarry;
  if (dead.tasks.length === 0) return null;
  const count = agg.allTasks.filter((t) => t.carriedIsDead).length;
  const worst = dead.tasks[0];
  if (!worst) return null;
  return finding(agg, {
    id: "dead-carry",
    title: "Finished work still riding along in context",
    confidence: "measured",
    effort: "habit",
    wastedWeighted: dead.weighted,
    measured: [
      `${count} ${plural(count, "task")} started with more than ${compactNumber(DEAD_CARRY_TOKENS)} tokens of earlier work already in context`,
      `none of them re-opened a single file from that earlier work, and their prompts named their own subject`,
      `that context was re-read on every turn: ${compactNumber(dead.tokens)} tokens`,
    ],
    receipts: dead.tasks.slice(0, 3).map((t) =>
      receipt(t, t.carriedUsd, `carried ${compactNumber(t.carriedContext)} tokens through ${t.turns} turns`),
    ),
    fix:
      `Press Ctrl+C and start a new session (or /clear) when the next thing you type is not about the last thing you did. ` +
      `Those tasks paid to re-read finished work on every single turn and never once looked at it again.`,
  });
};

const hookNoise: Detector = (agg) => {
  if (agg.hooks.length === 0) return null;
  const wasted = agg.hooks.reduce((sum, h) => sum + h.weighted, 0);
  const top = agg.hooks[0];
  if (!top) return null;
  const events = agg.hooks.reduce((sum, h) => sum + h.extra.events, 0);
  return finding(agg, {
    id: "hook-noise",
    title: "Hook output injected into context",
    confidence: "estimated",
    effort: "one-time",
    wastedWeighted: wasted,
    measured: [
      `${events} hook ${plural(events, "event")} printed ${bytes(agg.hooks.reduce((s, h) => s + h.chars, 0))} into context`,
      `worst: ${top.key} — the same bytes repeated ${top.extra.events}×`,
    ],
    fix: `Edit ~/.claude/settings.json once: send the ${top.key} hook's stdout to /dev/null. Hook stdout is written into the transcript, so every later turn in that session pays to re-read it.`,
    detail: agg.hooks.slice(0, 5).map((h) => `${h.key} · ${h.extra.events}× · ${bytes(h.chars)}`),
  });
};

const repeatedReads: Detector = (agg) => {
  if (agg.reads.length === 0) return null;
  const wasted = agg.reads.reduce((sum, r) => sum + r.weighted, 0);
  const redundantReads = agg.reads.reduce((sum, r) => sum + r.extra.redundantReads, 0);
  const redundantChars = agg.reads.reduce((sum, r) => sum + r.extra.redundantChars, 0);
  const top = agg.reads[0];
  if (!top || redundantReads === 0) return null;
  return finding(agg, {
    id: "repeated-reads",
    title: "The same file sent again, unchanged",
    confidence: "estimated",
    effort: "one-time",
    wastedWeighted: wasted,
    measured: [
      `${redundantReads} identical ${plural(redundantReads, "re-read")} across ${agg.reads.length} ${plural(agg.reads.length, "file")} (${bytes(redundantChars)})`,
      `worst: ${shortPath(top.key)} — ${top.extra.redundantReads}× after the first read`,
    ],
    fix:
      `${shortPath(top.key)} was byte-identical every time it was re-sent. If subagents each read it, put it in CLAUDE.md instead — ` +
      `that costs one cache write per session rather than one full copy per agent.`,
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
    if (tool === "Read") return `Ask for the line range you need instead of the whole file.`;
    if (tool === "Grep" || tool === "Glob") return `Match on file names only, or scope it to one directory.`;
    if (tool === "Bash") return `Pipe it down: \`${label} 2>&1 | tail -40\`, or write the log to a file and grep it.`;
    if (tool === "TaskOutput" || tool === "Agent" || tool === "Workflow")
      return `Ask the subagent for its conclusion, not its transcript — delegating only pays off if the bulk stays out of your context.`;
    if (tool === "WebFetch" || tool === "WebSearch") return `Name the fact you need in the fetch prompt so the page comes back summarised.`;
    return `Ask for a narrower result — the whole payload rides along for the rest of the session.`;
  };
  return finding(agg, {
    id: "large-output",
    title: "Oversized command output",
    confidence: "estimated",
    effort: "habit",
    wastedWeighted: wasted,
    measured: [
      `${calls} tool ${plural(calls, "result")} over 10 KB returned ${bytes(chars)}`,
      `worst: ${shortPath(top.key)} — ${top.extra.calls}×, largest ${bytes(top.extra.maxChars)}`,
    ],
    fix: `${shortPath(top.key)} put ${bytes(top.chars)} into context across ${top.extra.calls} ${plural(top.extra.calls, "run")}. ${fixFor(top.extra.tool, shortPath(top.key))}`,
    detail: agg.outputs.slice(0, 5).map((o) => `${shortPath(o.key)} · ${o.extra.calls}× · ${bytes(o.chars)}`),
  });
};

const failedTools: Detector = (agg) => {
  if (agg.failures.length === 0) return null;
  const wasted = agg.failures.reduce((sum, f) => sum + f.weighted, 0);
  const total = agg.failures.reduce((sum, f) => sum + f.extra.failures, 0);
  const top = agg.failures[0];
  if (!top || total === 0) return null;
  return finding(agg, {
    id: "failed-tools",
    title: "Failed and interrupted commands",
    confidence: "estimated",
    effort: "habit",
    wastedWeighted: wasted,
    measured: [
      `${total} failed tool ${plural(total, "call")} returned ${bytes(agg.failures.reduce((s, f) => s + f.chars, 0))} of error output`,
      `worst: ${shortPath(top.key)} — failed ${top.extra.failures}×`,
    ],
    fix: `${shortPath(top.key)} failed ${top.extra.failures}×. Each failure paid for its error dump and then for the retry that read it. Get it green in a terminal once, or wrap it so the agent sees one line instead of a stack trace.`,
    detail: agg.failures.slice(0, 5).map((f) => `${shortPath(f.key)} · ${f.extra.failures} ${plural(f.extra.failures, "failure")} · ${bytes(f.chars)}`),
  });
};

const writeChurn: Detector = (agg) => {
  if (agg.writes.length === 0) return null;
  const wasted = agg.writes.reduce((sum, w) => sum + w.weighted, 0);
  const top = agg.writes[0];
  if (!top) return null;
  return finding(agg, {
    id: "write-churn",
    title: "Files rewritten whole instead of edited",
    confidence: "estimated",
    effort: "habit",
    wastedWeighted: wasted,
    measured: [
      `${agg.writes.length} ${plural(agg.writes.length, "file")} written end-to-end more than once (${bytes(agg.writes.reduce((s, w) => s + w.extra.rewrittenChars, 0))})`,
      `worst: ${shortPath(top.key)} — ${top.extra.writes} full writes${top.extra.edits > 0 ? ` and ${top.extra.edits} edits` : ""}`,
    ],
    fix: `${shortPath(top.key)} was rewritten in full ${top.extra.writes}×. A full rewrite is billed as output tokens — the most expensive kind, 5× input. Ask for targeted edits once a file exists.`,
    detail: agg.writes.slice(0, 5).map((w) => `${shortPath(w.key)} · ${w.extra.writes} writes · ${bytes(w.extra.rewrittenChars)}`),
  });
};

const coldCache: Detector = (agg) => {
  if (agg.coldSessions < 3) return null;
  return finding(agg, {
    id: "cold-cache",
    title: "Sessions dropped before the cache paid off",
    confidence: "measured",
    effort: "habit",
    wastedWeighted: agg.coldWeighted,
    measured: [
      `${agg.coldSessions} ${plural(agg.coldSessions, "session")} ended within three turns`,
      `each paid a full cache write at 1.25× that was never read back at 0.1×`,
    ],
    fix: `Starting a session re-uploads your CLAUDE.md, tools and skills before anything useful happens. Keep quick questions in a session you already have open.`,
  });
};

const highContextRoundTrips: Detector = (agg) => {
  const premium = agg.models.filter((m) => m.trivialTurns > 0);
  const trivialWeighted = premium.reduce((sum, m) => sum + m.trivialWeighted, 0);
  const trivialTurns = premium.reduce((sum, m) => sum + m.trivialTurns, 0);
  if (trivialTurns < MIN_TRIVIAL_TURNS) return null;
  const avgContext = trivialTurns > 0 ? Math.round(trivialWeighted / trivialTurns / 0.1) : 0;
  return finding(agg, {
    id: "roundtrips",
    title: "Cheap actions taken at expensive context",
    confidence: "estimated",
    effort: "habit",
    wastedWeighted: trivialWeighted * RECOVERABLE_ROUNDTRIPS,
    measured: [
      `${trivialTurns} ${plural(trivialTurns, "turn")} did nothing but run one command or read one file`,
      `each still re-read the whole conversation — roughly ${compactNumber(avgContext)} tokens per turn`,
    ],
    fix:
      `This is not about the model being too good for the job — a cheap turn costs the same as a hard one because both re-read everything. ` +
      `Cut the number of round trips: chain shell commands into one call, and hand multi-step digging to a subagent, which starts near-empty and returns only its answer.`,
  });
};

export const detectors: Detector[] = [
  deadCarry,
  hookNoise,
  repeatedReads,
  largeOutput,
  highContextRoundTrips,
  failedTools,
  writeChurn,
  coldCache,
];

export function runDetectors(agg: Aggregate): Finding[] {
  const findings: Finding[] = [];
  for (const detector of detectors) {
    const result = detector(agg);
    if (result) findings.push(result);
  }
  const certainty = (f: Finding) => (f.confidence === "measured" ? 1 : 0.7);
  return findings.sort((a, b) => b.wastedUsd * certainty(b) - a.wastedUsd * certainty(a));
}
