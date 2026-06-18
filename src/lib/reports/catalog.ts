/**
 * The report suite: 1 free entry scan + 5 paid reports @ $99 each (or the
 * whole bundle). All 5 are live - one scan computes every report.
 */

export const REPORT_PRICE = 99
export const BUNDLE_PRICE = 299

export interface ReportProduct {
  slug: string
  name: string
  tagline: string
  description: string
  status: 'live' | 'coming-soon'
  /** lucide-react icon name */
  icon: string
  bullets: string[]
  /** What the full paid report includes (shown on the paywall). */
  includes: string[]
  /** Optional metadata-only disclaimer shown on the card/report. */
  metadataLimitNote?: string
}

export const REPORTS: ReportProduct[] = [
  {
    slug: 'ai-cost-health',
    name: 'AI Cost Health Report',
    tagline: 'Your full AI spend diagnosis',
    description:
      'The complete diagnosis. Ranked savings opportunities, exact affected projects and models, spend spikes, top cost leaks, recommended fixes, and a founder-ready memo.',
    status: 'live',
    icon: 'HeartPulse',
    bullets: [
      'Full ranked list of savings opportunities',
      'Highest-impact items with exact fixes',
      'Spend by model, project & token type',
      'Founder-ready memo + PDF',
    ],
    includes: [
      'Executive summary',
      'Full ranked savings opportunities',
      'Highest-impact items, fully revealed',
      'Spend by model',
      'Spend by project & API key',
      'Input vs. output token cost split',
      'Spend spikes & anomalies',
      'Top cost leaks',
      'Estimated monthly impact',
      'Recommended fix for each finding',
      'Confidence levels',
      'Founder-ready memo + PDF export',
    ],
  },
  {
    slug: 'model-output-waste',
    name: 'Model & Output Waste Report',
    tagline: 'Where you are overpaying per token',
    description:
      'Find expensive model usage, long outputs, and places where cheaper models may work.',
    status: 'live',
    icon: 'Scissors',
    bullets: [
      'Premium-model calls that could downgrade',
      'Verbose outputs inflating cost',
      'Per-endpoint right-sizing targets',
    ],
    includes: [
      'Premium-model spend, ranked',
      'Per-model downgrade targets + savings',
      'Verbose-output endpoints to cap',
      'Input vs. output cost split',
      'Recommended fix for each item',
      'Founder-ready memo + PDF',
    ],
  },
  {
    slug: 'prompt-cache-readiness',
    name: 'Prompt Cache Readiness Audit',
    tagline: 'Unlock provider-side caching savings',
    description: 'Find prompt patterns that may be preventing provider-side caching.',
    status: 'live',
    icon: 'DatabaseZap',
    bullets: [
      'Cacheable prompt prefixes you are re-sending',
      'Oversized prompts to trim',
      'Estimated cache-hit savings',
    ],
    includes: [
      'Cacheable prompt prefixes by project',
      'Oversized / bloated prompts to trim',
      'Per-project input-token breakdown',
      'Caching setup steps per provider',
      'Estimated cache-hit savings',
      'Founder-ready memo + PDF',
    ],
  },
  {
    slug: 'ai-margin-leak',
    name: 'AI Margin Leak Report',
    tagline: 'Which customers are eating your margins',
    description: 'See which users, plans, or customers may be hurting your AI margins.',
    status: 'live',
    icon: 'TrendingDown',
    bullets: [
      'Per-customer AI cost attribution',
      'Plans priced below their AI cost',
      'Power users quietly burning margin',
    ],
    includes: [
      'Cost attribution by project / customer',
      'Below-cost accounts flagged',
      'Thin-margin accounts (AI > 50% of revenue)',
      'Full margin table (with a revenue map)',
      'Re-pricing & rate-limit recommendations',
      'Founder-ready memo + PDF',
    ],
    metadataLimitNote:
      'Best with a project→revenue map. Without one, this report shows cost concentration only.',
  },
  {
    slug: 'agent-waste-detector',
    name: 'Agent Waste Detector',
    tagline: 'Catch runaway agents and retry storms',
    description: 'Find retry storms, duplicate calls, agent loops, and runaway workflows.',
    status: 'live',
    icon: 'Workflow',
    bullets: [
      'Retry storms and duplicate calls',
      'Agent loops burning tokens',
      'Runaway workflow detection',
    ],
    includes: [
      'Retry & error-rate analysis',
      'High-volume / low-token request patterns',
      'Spend-spike correlation',
      'Suspected fan-out / loop projects',
      'Mitigation steps',
      'Founder-ready memo + PDF',
    ],
    metadataLimitNote:
      'Metadata-only: agent loops are inferred from request and error density, not request traces.',
  },
]

export const LIVE_REPORT = REPORTS.find((r) => r.status === 'live')!
export const COMING_SOON_REPORTS = REPORTS.filter((r) => r.status === 'coming-soon')
export const PAID_REPORT_COUNT = REPORTS.length // 5

export function reportBySlug(slug: string): ReportProduct | undefined {
  return REPORTS.find((r) => r.slug === slug)
}
