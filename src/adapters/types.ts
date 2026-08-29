import type { AdapterId, SessionEvidence } from "../core/types.js";

export interface SessionRef {
  adapter: AdapterId;
  file: string;
  size: number;
  mtimeMs: number;
  projectKey: string;
  extraFiles?: string[];
}

export interface DiscoverOptions {
  since: number;
  project: string | null;
}

export interface Adapter {
  id: AdapterId;
  label: string;
  supported: boolean;
  dataDir: string;
  detect(): boolean;
  discover(options: DiscoverOptions): SessionRef[];
  parse(ref: SessionRef): Promise<SessionEvidence | null>;
}
