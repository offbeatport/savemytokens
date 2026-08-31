export const EVIDENCE_SCHEMA = 4;

export type AdapterId = "claude-code" | "codex" | "gemini" | "grok";

export type Confidence = "measured" | "estimated";

export interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export type TaskOutcome = "completed" | "interrupted" | "failed";

export interface TaskSummary {
  id: string;
  sessionId: string;
  project: string;
  prompt: string;
  startedAt: number;
  endedAt: number;
  promptChars: number;
  turns: number;
  toolCalls: number;
  models: string[];
  usage: Usage;
  weighted: number;
  usd: number;
  peakContext: number;
  carriedContext: number;
  carriedUsd: number;
  carriedIsDead: boolean;
  touchedPriorFiles: boolean;
  selfContained: boolean;
  outcome: TaskOutcome;
  toolErrors: number;
}

export interface ReadBucket {
  path: string;
  signature: string;
  reads: number;
  chars: number;
  redundantReads: number;
  redundantChars: number;
  redundantWeighted: number;
}

export interface OutputBucket {
  label: string;
  tool: string;
  calls: number;
  chars: number;
  maxChars: number;
  excessChars: number;
  excessWeighted: number;
}

export interface HookBucket {
  name: string;
  events: number;
  chars: number;
  weighted: number;
  sample: string;
  command: string;
}

export interface AttachmentBucket {
  type: string;
  events: number;
  chars: number;
}

export interface WriteBucket {
  path: string;
  writes: number;
  edits: number;
  rewrittenChars: number;
  rewrittenWeighted: number;
}

export interface FailureBucket {
  label: string;
  tool: string;
  failures: number;
  chars: number;
  weighted: number;
}

export interface ModelUse {
  model: string;
  turns: number;
  usage: Usage;
  weighted: number;
  trivialTurns: number;
  trivialWeighted: number;
}

export interface SessionEvidence {
  schema: number;
  adapter: AdapterId;
  sessionId: string;
  project: string;
  sourceFile: string;
  sourceSize: number;
  sourceMtimeMs: number;
  agentVersion: string;
  startedAt: number;
  endedAt: number;
  turns: number;
  humanPrompts: number;
  usage: Usage;
  weighted: number;
  peakContext: number;
  contextP50: number;
  compactions: number;
  coldStart: boolean;
  bloatTurns: number;
  bloatTokens: number;
  bloatWeighted: number;
  apiErrors: number;
  rateLimitHits: number;
  interruptions: number;
  toolCalls: number;
  toolErrors: number;
  sidechainTurns: number;
  sidechainWeighted: number;
  searchChars: number;
  models: ModelUse[];
  tasks: TaskSummary[];
  reads: ReadBucket[];
  outputs: OutputBucket[];
  hooks: HookBucket[];
  attachments: AttachmentBucket[];
  writes: WriteBucket[];
  failures: FailureBucket[];
}

export interface EvidenceScope {
  adapters: AdapterId[];
  days: number;
  project: string | null;
  sessions: number;
  from: number;
  to: number;
}

export interface Corpus {
  scope: EvidenceScope;
  sessions: SessionEvidence[];
}

export interface FindingEvidenceLine {
  confidence: Confidence;
  text: string;
}

export type FixEffort = "one-time" | "habit";

export interface Finding {
  id: string;
  title: string;
  measured: string[];
  wastedWeighted: number;
  wastedUsd: number;
  wasteRatio: number;
  confidence: Confidence;
  effort: FixEffort;
  fix: string;
  receipts?: string[];
  detail?: string[];
}

export interface Totals {
  usage: Usage;
  weighted: number;
  usd: number;
  tokens: number;
  freshTokens: number;
  cacheReadTokens: number;
  sessions: number;
  tasks: number;
  turns: number;
  toolCalls: number;
}

export interface Audit {
  version: number;
  ranAt: number;
  scope: EvidenceScope;
  totals: Totals;
  findings: Finding[];
  score: number;
  scoreBreakdown: ScoreComponent[];
  wasteRatio: number;
  upliftRatio: number;
  models: ModelUse[];
  outcomes: { completed: number; interrupted: number; failed: number };
  rateLimitHits: number;
  topTasks: TaskSummary[];
  projects: Array<{ name: string; usd: number; tasks: number }>;
}

export interface ScoreComponent {
  id: string;
  label: string;
  points: number;
}

export interface RunRecord {
  ranAt: number;
  score: number;
  wasteRatio: number;
  upliftRatio: number;
  scope: EvidenceScope;
  totals: Totals;
  findings: Array<Pick<Finding, "id" | "title" | "wasteRatio" | "confidence">>;
}
