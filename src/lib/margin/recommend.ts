/**
 * Recommendation engine. Every recommendation is BORN from a margin leak and
 * inherits its entity — never generic advice. Ranked by business impact ×
 * confidence × ease-of-implementation.
 */
import { usd, pct } from '@/lib/format'
import type { ConfidenceTier, FindingCategory, Confidence } from '@/lib/analysis/types'
import type { Evidence, MarginLeak, RecAction, Recommendation } from './types'

const round = (n: number) => Math.round(n)
const mid = (e: Evidence) => (e.estMonthlyLow + e.estMonthlyHigh) / 2

const ACTION_FOR: Partial<Record<FindingCategory, { action: RecAction; ease: number; verb: string }>> = {
  'model-downgrade': { action: 'model-downgrade', ease: 0.7, verb: 'Right-size the model mix' },
  'legacy-model': { action: 'model-downgrade', ease: 0.75, verb: 'Migrate off the legacy model' },
  'output-caps': { action: 'cap-output', ease: 0.9, verb: 'Cap output length' },
  'prompt-caching': { action: 'enable-caching', ease: 0.85, verb: 'Enable prompt caching' },
  'prompt-bloat': { action: 'trim-prompt', ease: 0.7, verb: 'Trim oversized prompts' },
  'retry-waste': { action: 'fix-retries', ease: 0.7, verb: 'Stop paying for retries/errors' },
  'project-leak': { action: 'investigate', ease: 0.5, verb: 'Investigate concentration' },
}

const tierNum = (t: ConfidenceTier) => (t === 'confirmed' ? 0.9 : 0.55)
const confNum = (c: Confidence) => (c === 'high' ? 0.9 : c === 'medium' ? 0.65 : 0.4)
const difficultyFor = (ease: number) => (ease >= 0.8 ? 'low' : ease >= 0.5 ? 'medium' : 'high')

export function recommendForLeak(leak: MarginLeak): Recommendation {
  const top = leak.evidence[0]
  const belowCost = leak.status === 'below-cost'

  let action: RecAction
  let ease: number
  let title: string
  let monthlyImpact: number
  let rationale: string

  if (belowCost) {
    // The margin gap is the headline lever; the top cost fix is the supporting move.
    action = 'reprice'
    ease = 0.4
    monthlyImpact = leak.monthlyImpact
    title = `Reprice or cap AI usage on "${leak.entity.label}"`
    rationale = top
      ? `${leak.entity.label} loses ${usd(leak.cost - leak.revenue)}/mo. Biggest cost lever: ${top.title.toLowerCase()} (~${usd(round(mid(top)))}/mo). Reprice the plan or apply this fix to reach break-even.`
      : `${leak.entity.label} costs more in AI than it pays. Reprice the plan, add a usage cap, or move it to cheaper models.`
  } else if (top) {
    const a = ACTION_FOR[top.category] ?? { action: 'investigate' as RecAction, ease: 0.5, verb: 'Investigate' }
    action = a.action
    ease = a.ease
    monthlyImpact = round(mid(top))
    title = `${a.verb} on "${leak.entity.label}"`
    rationale =
      leak.status === 'thin'
        ? `${leak.entity.label} runs at ${pct(leak.marginPct ?? 0)} margin. ${top.title} recovers ~${usd(monthlyImpact)}/mo, restoring headroom.`
        : `${leak.entity.label} (${usd(leak.cost)}/mo). ${top.title} recovers ~${usd(monthlyImpact)}/mo.`
  } else {
    action = 'investigate'
    ease = 0.5
    monthlyImpact = leak.monthlyImpact
    title = `Investigate "${leak.entity.label}"`
    rationale = leak.summary
  }

  const confidence = top ? (tierNum(leak.confidenceTier) + confNum(top.confidence)) / 2 : tierNum(leak.confidenceTier)
  const score = monthlyImpact * confidence * ease

  return {
    id: `rec-${leak.id}`,
    entity: leak.entity,
    leakId: leak.id,
    title,
    action,
    monthlyImpact: Math.max(round(monthlyImpact), 0),
    confidence: Math.round(confidence * 100) / 100,
    ease,
    score: round(score),
    difficulty: difficultyFor(ease),
    rationale,
    evidence: leak.evidence,
  }
}

export function rank(leaks: MarginLeak[]): Recommendation[] {
  return leaks
    .map(recommendForLeak)
    .filter((r) => r.monthlyImpact > 0)
    .sort((a, b) => b.score - a.score)
}
