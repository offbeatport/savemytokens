import { WEIGHTS, addUsage, estimateTokens } from "../../core/tokens.js";
import type { SessionEvidence } from "../../core/types.js";

const MAX_BUCKETS = 24;

function mergeBuckets<T>(
  base: T[],
  extra: T[],
  keyOf: (item: T) => string,
  combine: (a: T, b: T) => T,
  weightOf: (item: T) => number,
): T[] {
  const map = new Map<string, T>();
  for (const item of [...base, ...extra]) {
    const key = keyOf(item);
    const existing = map.get(key);
    map.set(key, existing ? combine(existing, item) : item);
  }
  return [...map.values()].sort((a, b) => weightOf(b) - weightOf(a)).slice(0, MAX_BUCKETS);
}

export function mergeSidechain(base: SessionEvidence, extra: SessionEvidence): SessionEvidence {
  addUsage(base.usage, extra.usage);
  base.weighted += extra.weighted;
  base.turns += extra.turns;
  base.toolCalls += extra.toolCalls;
  base.toolErrors += extra.toolErrors;
  base.apiErrors += extra.apiErrors;
  base.interruptions += extra.interruptions;
  base.searchChars += extra.searchChars;
  base.bloatTurns += extra.bloatTurns;
  base.bloatTokens += extra.bloatTokens;
  base.bloatWeighted += extra.bloatWeighted;
  base.compactions += extra.compactions;
  base.sidechainTurns += extra.turns;
  base.sidechainWeighted += extra.weighted;
  base.sourceSize += extra.sourceSize;
  if (extra.sourceMtimeMs > base.sourceMtimeMs) base.sourceMtimeMs = extra.sourceMtimeMs;
  if (extra.peakContext > base.peakContext) base.peakContext = extra.peakContext;
  if (extra.startedAt && (!base.startedAt || extra.startedAt < base.startedAt)) base.startedAt = extra.startedAt;
  if (extra.endedAt > base.endedAt) base.endedAt = extra.endedAt;

  for (const model of extra.models) {
    const existing = base.models.find((m) => m.model === model.model);
    if (!existing) {
      base.models.push(model);
      continue;
    }
    existing.turns += model.turns;
    addUsage(existing.usage, model.usage);
    existing.weighted += model.weighted;
    existing.trivialTurns += model.trivialTurns;
    existing.trivialWeighted += model.trivialWeighted;
  }

  base.reads = mergeBuckets(
    base.reads,
    extra.reads,
    (r) => r.path,
    (a, b) => {
      const sameContent = a.signature !== "" && a.signature === b.signature;
      const firstCopyChars = b.chars - b.redundantChars;
      return {
        path: a.path,
        signature: a.signature,
        reads: a.reads + b.reads,
        chars: a.chars + b.chars,
        redundantReads: a.redundantReads + b.redundantReads + (sameContent ? b.reads - b.redundantReads : 0),
        redundantChars: a.redundantChars + b.redundantChars + (sameContent ? firstCopyChars : 0),
        redundantWeighted:
          a.redundantWeighted +
          b.redundantWeighted +
          (sameContent ? estimateTokens(firstCopyChars) * WEIGHTS.cacheWrite : 0),
      };
    },
    (r) => r.redundantWeighted,
  );

  base.outputs = mergeBuckets(
    base.outputs,
    extra.outputs,
    (o) => o.label,
    (a, b) => ({
      label: a.label,
      tool: a.tool,
      calls: a.calls + b.calls,
      chars: a.chars + b.chars,
      maxChars: Math.max(a.maxChars, b.maxChars),
      excessChars: a.excessChars + b.excessChars,
      excessWeighted: a.excessWeighted + b.excessWeighted,
    }),
    (o) => o.excessWeighted,
  );

  base.hooks = mergeBuckets(
    base.hooks,
    extra.hooks,
    (h) => h.name,
    (a, b) => ({ name: a.name, events: a.events + b.events, chars: a.chars + b.chars, weighted: a.weighted + b.weighted }),
    (h) => h.weighted,
  );

  base.writes = mergeBuckets(
    base.writes,
    extra.writes,
    (w) => w.path,
    (a, b) => ({
      path: a.path,
      writes: a.writes + b.writes,
      edits: a.edits + b.edits,
      rewrittenChars: a.rewrittenChars + b.rewrittenChars,
      rewrittenWeighted: a.rewrittenWeighted + b.rewrittenWeighted,
    }),
    (w) => w.rewrittenWeighted,
  );

  base.failures = mergeBuckets(
    base.failures,
    extra.failures,
    (f) => f.label,
    (a, b) => ({ label: a.label, tool: a.tool, failures: a.failures + b.failures, chars: a.chars + b.chars, weighted: a.weighted + b.weighted }),
    (f) => f.weighted,
  );

  base.attachments = mergeBuckets(
    base.attachments,
    extra.attachments,
    (a) => a.type,
    (a, b) => ({ type: a.type, events: a.events + b.events, chars: a.chars + b.chars }),
    (a) => a.chars,
  );

  return base;
}
