import type { Confidence, Finding, ReportSlug, ReportKind } from './types'
import type { ScanContext, Detector } from './engine'
// NOTE: engine.ts and registry.ts form an import cycle. It is safe ONLY because
// the detectors below are hoisted `function` declarations (initialized during ESM
// linking, before this module's body runs). Do NOT convert any detector to a
// `const foo = (ctx) => …` arrow - it would land in the TDZ when REGISTRY is built
// and throw "Cannot access detectX before initialization" at import time.
import {
  detectModelDowngrade,
  detectOutputCaps,
  detectPromptCaching,
  detectRetryWaste,
  detectProjectLeak,
  detectPromptBloat,
  detectRunawayVolume,
  detectMarginLeak,
} from './engine'

export interface ReportDef {
  slug: ReportSlug
  kind: ReportKind
  scope: 'meta' | 'focused'
  detectors: Detector[]
  /**
   * Free-preview picker. Receives ONLY non-#1 findings and must return one of
   * them (or null to force the median fallback / single-finding teaser). The
   * engine hard-guards that #1 is never revealed regardless of what this returns.
   */
  pickFreeInsight?: (nonTop: Finding[], ctx: ScanContext) => Finding | null
  confidenceCeiling?: Confidence
  metadataLimited?: boolean
  limitationNote?: string
  usesRevenueMap?: boolean
  /** Title shown on the snapshot when the report finds nothing material. */
  healthyTitle?: string
}

const preferOutputCaps = (nonTop: Finding[]): Finding | null =>
  nonTop.find((f) => f.category === 'output-caps') ?? nonTop[Math.floor(nonTop.length / 2)] ?? null

export const REGISTRY: Record<ReportSlug, ReportDef> = {
  'ai-cost-health': {
    slug: 'ai-cost-health',
    kind: 'findings',
    scope: 'meta',
    detectors: [
      detectModelDowngrade,
      detectOutputCaps,
      detectPromptCaching,
      detectRetryWaste,
      detectProjectLeak,
    ],
    pickFreeInsight: preferOutputCaps,
  },
  'model-output-waste': {
    slug: 'model-output-waste',
    kind: 'findings',
    scope: 'focused',
    detectors: [detectModelDowngrade, detectOutputCaps],
    pickFreeInsight: preferOutputCaps,
    healthyTitle: 'No model or output waste found',
  },
  'prompt-cache-readiness': {
    slug: 'prompt-cache-readiness',
    kind: 'findings',
    scope: 'focused',
    detectors: [detectPromptCaching, detectPromptBloat],
    healthyTitle: 'Your prompts look cache-ready',
  },
  'agent-waste-detector': {
    slug: 'agent-waste-detector',
    kind: 'findings',
    scope: 'focused',
    detectors: [detectRetryWaste, detectRunawayVolume],
    metadataLimited: true,
    confidenceCeiling: 'medium',
    limitationNote:
      'Metadata-only: agent loops and duplicate calls are inferred from request and error density, not request traces. Connect traces for certainty.',
    healthyTitle: 'No agent-waste signals detected',
  },
  'ai-margin-leak': {
    slug: 'ai-margin-leak',
    kind: 'margin',
    scope: 'focused',
    detectors: [detectMarginLeak, detectProjectLeak],
    usesRevenueMap: true,
    limitationNote:
      'No revenue map attached - this shows cost concentration only. Upload a project→revenue map to compute true margins.',
    healthyTitle: 'No obvious margin leaks found',
  },
}

export const ALL_REPORT_DEFS: ReportDef[] = Object.values(REGISTRY)

export function getReportDef(slug: string): ReportDef | undefined {
  return (REGISTRY as Record<string, ReportDef>)[slug]
}
