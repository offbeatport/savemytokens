import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_SCHEMA, type AdapterId, type SessionEvidence } from "../core/types.js";
import { CACHE_DIR, readJson, writeJson } from "./paths.js";

interface CacheFile {
  schema: number;
  entries: Record<string, SessionEvidence>;
}

const RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

export class EvidenceCache {
  private readonly file: string;
  private data: CacheFile;
  private dirty = false;

  constructor(adapter: AdapterId) {
    this.file = path.join(CACHE_DIR, `${adapter}.json`);
    const loaded = readJson<CacheFile>(this.file, { schema: EVIDENCE_SCHEMA, entries: {} });
    this.data = loaded.schema === EVIDENCE_SCHEMA && loaded.entries ? loaded : { schema: EVIDENCE_SCHEMA, entries: {} };
  }

  get(file: string, size: number, mtimeMs: number): SessionEvidence | null {
    const hit = this.data.entries[file];
    if (!hit) return null;
    if (hit.sourceSize !== size || Math.abs(hit.sourceMtimeMs - mtimeMs) > 1) return null;
    return hit;
  }

  set(evidence: SessionEvidence): void {
    this.data.entries[evidence.sourceFile] = evidence;
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    const cutoff = Date.now() - RETENTION_MS;
    for (const [file, evidence] of Object.entries(this.data.entries)) {
      if (evidence.sourceMtimeMs < cutoff || !fs.existsSync(file)) delete this.data.entries[file];
    }
    writeJson(this.file, this.data);
    this.dirty = false;
  }
}
