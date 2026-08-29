import { activeAdapters } from "./adapters/index.js";
import type { SessionRef } from "./adapters/types.js";
import type { Corpus, SessionEvidence } from "./core/types.js";
import { EvidenceCache } from "./storage/cache.js";

export interface CollectOptions {
  days: number;
  project: string | null;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

async function pool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      await worker(item, index);
    }
  });
  await Promise.all(runners);
}

export async function collect(options: CollectOptions): Promise<Corpus> {
  const now = Date.now();
  const since = now - options.days * 24 * 60 * 60 * 1000;
  const sessions: SessionEvidence[] = [];
  const adapters = activeAdapters();
  const refs: Array<{ ref: SessionRef; cache: EvidenceCache }> = [];

  for (const adapter of adapters) {
    const cache = new EvidenceCache(adapter.id);
    for (const ref of adapter.discover({ since, project: options.project })) {
      refs.push({ ref, cache });
    }
  }

  let done = 0;
  await pool(refs, options.concurrency ?? 8, async ({ ref, cache }) => {
    const cached = cache.get(ref.file, ref.size, ref.mtimeMs);
    if (cached) {
      sessions.push(cached);
    } else {
      const adapter = adapters.find((a) => a.id === ref.adapter);
      const evidence = adapter ? await adapter.parse(ref) : null;
      if (evidence) {
        cache.set(evidence);
        sessions.push(evidence);
      }
    }
    done++;
    options.onProgress?.(done, refs.length);
  });

  const caches = new Set(refs.map((r) => r.cache));
  for (const cache of caches) cache.flush();

  sessions.sort((a, b) => a.startedAt - b.startedAt);

  return {
    scope: {
      adapters: adapters.map((a) => a.id),
      days: options.days,
      project: options.project,
      sessions: sessions.length,
      from: since,
      to: now,
    },
    sessions,
  };
}
