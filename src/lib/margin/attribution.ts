/**
 * Attribution — the part a spreadsheet cannot do.
 *
 * Usage exports from gateways/providers rarely carry a customer id; they carry an
 * API-key / project / workspace label. Revenue (Stripe/CSV) is keyed by customer.
 * This resolves the join automatically — exact + fuzzy matching of usage keys to
 * revenue customers — so a founder doesn't hand-map keys in Excel. It reports
 * coverage, what stayed unmatched, and fuzzy suggestions to confirm.
 */
import type { RevenueRow, UsageRow } from '@/lib/analysis/types'
import type { AttributionMatch, AttributionReport, AttributionSuggestion } from './types'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const round = (n: number) => Math.round(n)

const STOPWORDS = new Set([
  'prod', 'production', 'staging', 'stage', 'dev', 'development', 'test', 'sandbox',
  'api', 'app', 'apps', 'service', 'svc', 'backend', 'be', 'key', 'live',
  'inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'gmbh', 'the', 'team', 'org',
])

/** Lowercase token set with noise/suffix words stripped. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t))
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const union = new Set([...sa, ...sb]).size
  return union ? inter / union : 0
}

/** 0..1 similarity between a usage key and a revenue customer's id/label. */
function similarity(key: string, candidate: string): number {
  const ka = tokens(key)
  const cb = tokens(candidate)
  const kj = ka.join('')
  const cj = cb.join('')
  if (!kj || !cj) return 0
  if (kj === cj) return 1
  if (kj.startsWith(cj) || cj.startsWith(kj)) return Math.max(0.88, jaccard(ka, cb))
  if (kj.includes(cj) || cj.includes(kj)) return Math.max(0.8, jaccard(ka, cb))
  return jaccard(ka, cb)
}

const AUTO_THRESHOLD = 0.85 // auto-apply at/above this
const SUGGEST_THRESHOLD = 0.5 // surface as a suggestion above this

/** Which field a usage row is attributed by when customerId is absent. */
function attributionKey(r: UsageRow): string {
  return r.customerId || r.workspace || r.project || 'default'
}

export interface ResolveOptions {
  /** explicit usage-key → customerId overrides (from a mapping CSV / UI). */
  manual?: Record<string, string>
}

export function resolveAttribution(
  usage: UsageRow[],
  revenue: RevenueRow[],
  opts: ResolveOptions = {},
): { usage: UsageRow[]; report: AttributionReport } {
  const totalCost = sum(usage.map((r) => r.cost))

  // No revenue → nothing to attribute against.
  if (!revenue.length) {
    return { usage, report: { method: 'none', attributedPct: 0, matched: [], unmatched: [], suggestions: [] } }
  }

  // Already pre-tagged? If most cost already carries a customerId that matches a
  // revenue customer, trust it.
  const revIds = new Set(revenue.map((r) => r.customerId))
  const preTaggedCost = sum(usage.filter((r) => r.customerId && revIds.has(r.customerId)).map((r) => r.cost))
  if (totalCost > 0 && preTaggedCost / totalCost >= 0.9) {
    return {
      usage,
      report: { method: 'pre-tagged', attributedPct: round((preTaggedCost / totalCost) * 100), matched: [], unmatched: [], suggestions: [] },
    }
  }

  // Cost per attribution key.
  const costByKey = new Map<string, number>()
  for (const r of usage) costByKey.set(attributionKey(r), (costByKey.get(attributionKey(r)) ?? 0) + r.cost)

  const customers = revenue.map((r) => ({ id: r.customerId, label: r.label || r.customerId }))
  const resolved = new Map<string, { customerId: string; customerLabel: string; method: AttributionMatch['method']; score: number }>()
  const suggestions: AttributionSuggestion[] = []

  for (const [key, cost] of costByKey) {
    // 1) manual override
    if (opts.manual && opts.manual[key]) {
      const c = customers.find((x) => x.id === opts.manual![key])
      resolved.set(key, { customerId: opts.manual[key], customerLabel: c?.label ?? opts.manual[key], method: 'manual', score: 1 })
      continue
    }
    // 2) the key already IS a revenue customer id
    const direct = customers.find((c) => c.id === key)
    if (direct) {
      resolved.set(key, { customerId: direct.id, customerLabel: direct.label, method: 'exact', score: 1 })
      continue
    }
    // 3) best fuzzy match against id + label
    let best: { id: string; label: string; score: number } | null = null
    for (const c of customers) {
      const score = Math.max(similarity(key, c.id), similarity(key, c.label))
      if (!best || score > best.score) best = { id: c.id, label: c.label, score }
    }
    if (best && best.score >= AUTO_THRESHOLD) {
      resolved.set(key, { customerId: best.id, customerLabel: best.label, method: best.score >= 1 ? 'exact' : 'fuzzy', score: best.score })
    } else if (best && best.score >= SUGGEST_THRESHOLD) {
      suggestions.push({ key, customerId: best.id, customerLabel: best.label, score: Math.round(best.score * 100) / 100, cost: round(cost) })
    }
  }

  // Enrich usage with resolved customerIds.
  const enriched = usage.map((r) => {
    if (r.customerId && revIds.has(r.customerId)) return r
    const m = resolved.get(attributionKey(r))
    return m ? { ...r, customerId: m.customerId } : r
  })

  const matched: AttributionMatch[] = [...resolved.entries()].map(([key, m]) => ({
    key,
    customerId: m.customerId,
    customerLabel: m.customerLabel,
    method: m.method,
    score: Math.round(m.score * 100) / 100,
    cost: round(costByKey.get(key) ?? 0),
  }))
  const matchedCost = sum(matched.map((m) => m.cost))
  const unmatched = [...costByKey.entries()]
    .filter(([key]) => !resolved.has(key))
    .map(([key, cost]) => ({ key, cost: round(cost) }))
    .sort((a, b) => b.cost - a.cost)

  return {
    usage: enriched,
    report: {
      method: 'matched',
      attributedPct: totalCost ? round((matchedCost / totalCost) * 100) : 0,
      matched: matched.sort((a, b) => b.cost - a.cost),
      unmatched,
      suggestions: suggestions.sort((a, b) => b.cost - a.cost),
    },
  }
}
