import { usd } from "../core/pricing.js";
import { addUsage, emptyUsage, rawTokens, weigh } from "../core/tokens.js";
import type { Corpus, ModelUse, TaskSummary, Totals, Usage } from "../core/types.js";

export interface Merged<T> {
  key: string;
  weighted: number;
  count: number;
  chars: number;
  sessions: number;
  extra: T;
}

export interface ReadAgg {
  reads: number;
  redundantReads: number;
  redundantChars: number;
}

export interface OutputAgg {
  tool: string;
  calls: number;
  maxChars: number;
  excessChars: number;
}

export interface HookAgg {
  events: number;
}

export interface WriteAgg {
  writes: number;
  edits: number;
  rewrittenChars: number;
}

export interface FailureAgg {
  tool: string;
  failures: number;
}

export interface Aggregate {
  totals: Totals;
  models: ModelUse[];
  reads: Array<Merged<ReadAgg>>;
  outputs: Array<Merged<OutputAgg>>;
  hooks: Array<Merged<HookAgg>>;
  writes: Array<Merged<WriteAgg>>;
  failures: Array<Merged<FailureAgg>>;
  bloat: { turns: number; tokens: number; weighted: number; sessions: number; peak: number };
  coldSessions: number;
  coldWeighted: number;
  apiErrors: number;
  interruptions: number;
  toolErrors: number;
  sidechainTurns: number;
  sidechainWeighted: number;
  compactions: number;
  outcomes: { completed: number; interrupted: number; failed: number };
  searchChars: number;
  rateLimitHits: number;
  allTasks: TaskSummary[];
  topTasks: TaskSummary[];
  deadCarry: { tasks: TaskSummary[]; usd: number; weighted: number; tokens: number };
  projects: Array<{ name: string; usd: number; tasks: number }>;
}

function merger<T>() {
  const map = new Map<string, Merged<T>>();
  return {
    add(key: string, weighted: number, count: number, chars: number, extra: T, combine: (a: T, b: T) => T) {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { key, weighted, count, chars, sessions: 1, extra });
        return;
      }
      existing.weighted += weighted;
      existing.count += count;
      existing.chars += chars;
      existing.sessions += 1;
      existing.extra = combine(existing.extra, extra);
    },
    top(limit: number): Array<Merged<T>> {
      return [...map.values()].sort((a, b) => b.weighted - a.weighted).slice(0, limit);
    },
  };
}

export function aggregate(corpus: Corpus): Aggregate {
  const usage: Usage = emptyUsage();
  const models = new Map<string, ModelUse>();
  const reads = merger<ReadAgg>();
  const outputs = merger<OutputAgg>();
  const hooks = merger<HookAgg>();
  const writes = merger<WriteAgg>();
  const failures = merger<FailureAgg>();

  let tasks = 0;
  let turns = 0;
  let toolCalls = 0;
  let bloatTurns = 0;
  let bloatTokens = 0;
  let bloatWeighted = 0;
  let bloatSessions = 0;
  let peakContext = 0;
  let coldSessions = 0;
  let coldWeighted = 0;
  let apiErrors = 0;
  let interruptions = 0;
  let toolErrors = 0;
  let sidechainTurns = 0;
  let sidechainWeighted = 0;
  let compactions = 0;
  let searchChars = 0;
  let rateLimitHits = 0;
  let totalUsd = 0;
  const allTasks: TaskSummary[] = [];
  const projects = new Map<string, { name: string; usd: number; tasks: number }>();
  const outcomes = { completed: 0, interrupted: 0, failed: 0 };

  for (const session of corpus.sessions) {
    addUsage(usage, session.usage);
    turns += session.turns;
    toolCalls += session.toolCalls;
    tasks += session.tasks.length;
    apiErrors += session.apiErrors;
    interruptions += session.interruptions;
    toolErrors += session.toolErrors;
    sidechainTurns += session.sidechainTurns;
    sidechainWeighted += session.sidechainWeighted;
    compactions += session.compactions;
    searchChars += session.searchChars;
    rateLimitHits += session.rateLimitHits ?? 0;
    for (const task of session.tasks) {
      allTasks.push(task);
      totalUsd += task.usd;
      const name = (task.project || session.project).split("/").pop() || "unknown";
      const entry = projects.get(name) ?? { name, usd: 0, tasks: 0 };
      entry.usd += task.usd;
      entry.tasks += 1;
      projects.set(name, entry);
    }
    bloatTurns += session.bloatTurns;
    bloatTokens += session.bloatTokens;
    bloatWeighted += session.bloatWeighted;
    if (session.bloatTurns > 0) bloatSessions++;
    if (session.peakContext > peakContext) peakContext = session.peakContext;
    if (session.coldStart) {
      coldSessions++;
      coldWeighted += session.usage.cacheWrite * 1.25;
    }
    for (const task of session.tasks) outcomes[task.outcome]++;

    for (const model of session.models) {
      let entry = models.get(model.model);
      if (!entry) {
        entry = { model: model.model, turns: 0, usage: emptyUsage(), weighted: 0, trivialTurns: 0, trivialWeighted: 0 };
        models.set(model.model, entry);
      }
      entry.turns += model.turns;
      addUsage(entry.usage, model.usage);
      entry.weighted += model.weighted;
      entry.trivialTurns += model.trivialTurns;
      entry.trivialWeighted += model.trivialWeighted;
    }

    for (const read of session.reads) {
      if (read.redundantReads === 0) continue;
      reads.add(
        read.path,
        read.redundantWeighted,
        read.reads,
        read.chars,
        { reads: read.reads, redundantReads: read.redundantReads, redundantChars: read.redundantChars },
        (a, b) => ({
          reads: a.reads + b.reads,
          redundantReads: a.redundantReads + b.redundantReads,
          redundantChars: a.redundantChars + b.redundantChars,
        }),
      );
    }

    for (const output of session.outputs) {
      outputs.add(
        output.label,
        output.excessWeighted,
        output.calls,
        output.chars,
        { tool: output.tool, calls: output.calls, maxChars: output.maxChars, excessChars: output.excessChars },
        (a, b) => ({
          tool: a.tool,
          calls: a.calls + b.calls,
          maxChars: Math.max(a.maxChars, b.maxChars),
          excessChars: a.excessChars + b.excessChars,
        }),
      );
    }

    for (const hook of session.hooks) {
      if (hook.weighted <= 0) continue;
      hooks.add(hook.name, hook.weighted, hook.events, hook.chars, { events: hook.events }, (a, b) => ({
        events: a.events + b.events,
      }));
    }

    for (const write of session.writes) {
      if (write.writes < 2) continue;
      writes.add(
        write.path,
        write.rewrittenWeighted,
        write.writes,
        write.rewrittenChars,
        { writes: write.writes, edits: write.edits, rewrittenChars: write.rewrittenChars },
        (a, b) => ({
          writes: a.writes + b.writes,
          edits: a.edits + b.edits,
          rewrittenChars: a.rewrittenChars + b.rewrittenChars,
        }),
      );
    }

    for (const failure of session.failures) {
      failures.add(
        failure.label,
        failure.weighted,
        failure.failures,
        failure.chars,
        { tool: failure.tool, failures: failure.failures },
        (a, b) => ({ tool: a.tool, failures: a.failures + b.failures }),
      );
    }
  }

  return {
    totals: {
      usage,
      weighted: weigh(usage),
      usd: totalUsd || usd("claude-opus-5", usage),
      tokens: rawTokens(usage),
      freshTokens: usage.input + usage.output + usage.cacheWrite,
      cacheReadTokens: usage.cacheRead,
      sessions: corpus.sessions.length,
      tasks,
      turns,
      toolCalls,
    },
    models: [...models.values()].sort((a, b) => b.weighted - a.weighted),
    reads: reads.top(12),
    outputs: outputs.top(12),
    hooks: hooks.top(12),
    writes: writes.top(12),
    failures: failures.top(12),
    bloat: { turns: bloatTurns, tokens: bloatTokens, weighted: bloatWeighted, sessions: bloatSessions, peak: peakContext },
    coldSessions,
    coldWeighted,
    apiErrors,
    interruptions,
    toolErrors,
    sidechainTurns,
    sidechainWeighted,
    compactions,
    outcomes,
    searchChars,
    rateLimitHits,
    allTasks,
    topTasks: allTasks.filter((t) => t.turns > 0).sort((a, b) => b.usd - a.usd).slice(0, 5),
    deadCarry: (() => {
      const dead = allTasks.filter((t) => t.carriedIsDead).sort((a, b) => b.carriedUsd - a.carriedUsd);
      const tokens = dead.reduce((sum, t) => sum + t.carriedContext * t.turns, 0);
      return {
        tasks: dead.slice(0, 8),
        usd: dead.reduce((sum, t) => sum + t.carriedUsd, 0),
        weighted: tokens * 0.1,
        tokens,
      };
    })(),
    projects: [...projects.values()].sort((a, b) => b.usd - a.usd),
  };
}
