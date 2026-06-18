import type { UsageRow } from '@/lib/analysis/types'
import { priceFor } from '@/lib/analysis/pricing'

/**
 * Provider usage connectors. The pasted Admin key is used ONCE here to pull
 * usage server-side and is never stored or logged. Transform functions are pure
 * and unit-tested; the fetchers are thin wrappers around the provider APIs.
 *
 * Gemini has no key-based usage API (billing runs through Google Cloud Billing),
 * so it is handled in the route with an upload prompt - not here.
 */

export type ConnectErrorCode = 'unauthorized' | 'forbidden' | 'rate' | 'empty' | 'error'

export class ConnectorError extends Error {
  constructor(
    public code: ConnectErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConnectorError'
  }
}

function dayFromUnix(sec: number): string {
  return new Date((sec || 0) * 1000).toISOString().slice(0, 10)
}

function tokenWeight(model: string, inTok: number, outTok: number): number {
  const p = priceFor(model)
  const w = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out
  return w > 0 ? w : 1
}

/* ── OpenAI ──────────────────────────────────────────────────────
   Usage API → per (day, model, project) token rows. Cost API (grouped by
   project) → allocated across that day/project's models by token weight, so
   per-row cost is ACTUAL and totals match the bill. */

interface OAUsageBucket {
  start_time?: number
  results?: Array<{
    input_tokens?: number
    output_tokens?: number
    num_model_requests?: number
    model?: string | null
    project_id?: string | null
  }>
}
interface OACostBucket {
  start_time?: number
  results?: Array<{ amount?: { value?: number }; project_id?: string | null }>
}

export function openAIUsageToRows(usage: OAUsageBucket[], costs?: OACostBucket[]): UsageRow[] {
  const rows: (UsageRow & { _key: string })[] = []
  for (const b of usage ?? []) {
    const date = dayFromUnix(b.start_time ?? 0)
    for (const r of b.results ?? []) {
      if (!r.model) continue
      const project = r.project_id ?? 'default'
      rows.push({
        provider: 'openai',
        model: r.model,
        date,
        project,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        requests: Math.max(1, r.num_model_requests ?? 0),
        cost: 0,
        costSource: 'estimated',
        errors: 0,
        _key: `${date}|${project}`,
      })
    }
  }

  // Actual-cost allocation by (day, project).
  const costByKey = new Map<string, number>()
  if (costs) {
    for (const b of costs) {
      const date = dayFromUnix(b.start_time ?? 0)
      for (const r of b.results ?? []) {
        const key = `${date}|${r.project_id ?? 'default'}`
        costByKey.set(key, (costByKey.get(key) ?? 0) + (r.amount?.value ?? 0))
      }
    }
  }

  if (costByKey.size > 0) {
    const groups = new Map<string, (UsageRow & { _key: string })[]>()
    for (const row of rows) {
      const g = groups.get(row._key) ?? []
      g.push(row)
      groups.set(row._key, g)
    }
    for (const [key, group] of groups) {
      const actual = costByKey.get(key)
      if (actual === undefined || actual <= 0) continue // leave estimated
      const weights = group.map((r) => tokenWeight(r.model, r.inputTokens, r.outputTokens))
      const total = weights.reduce((a, b) => a + b, 0) || 1
      group.forEach((r, i) => {
        r.cost = Math.round((actual * (weights[i] / total)) * 100) / 100
        r.costSource = 'actual'
      })
    }
  }

  // Estimate any rows still without actual cost.
  for (const r of rows) {
    if (r.costSource === 'actual') continue
    const p = priceFor(r.model)
    r.cost = Math.round(((r.inputTokens / 1e6) * p.in + (r.outputTokens / 1e6) * p.out) * 100) / 100
  }

  return rows.map(({ _key, ...row }) => row)
}

/* ── Anthropic ───────────────────────────────────────────────────
   usage_report/messages → per (day, model, workspace) token rows.
   Cost is estimated from list price (the Cost report is a separate endpoint;
   left for a follow-up - the reconciliation badge will read "estimated"). */

interface ANBucket {
  starting_at?: string
  results?: Array<{
    uncached_input_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    input_tokens?: number
    output_tokens?: number
    num_messages?: number
    requests?: number
    model?: string | null
    workspace_id?: string | null
  }>
}

export function anthropicUsageToRows(data: ANBucket[]): UsageRow[] {
  const rows: UsageRow[] = []
  for (const b of data ?? []) {
    const date = String(b.starting_at ?? '').slice(0, 10) || '1970-01-01'
    for (const r of b.results ?? []) {
      if (!r.model) continue
      const inputTokens =
        (r.uncached_input_tokens ?? r.input_tokens ?? 0) +
        (r.cache_read_input_tokens ?? 0) +
        (r.cache_creation_input_tokens ?? 0)
      const outputTokens = r.output_tokens ?? 0
      const p = priceFor(r.model)
      rows.push({
        provider: 'anthropic',
        model: r.model,
        date,
        project: r.workspace_id ?? 'default',
        inputTokens,
        outputTokens,
        requests: Math.max(1, r.num_messages ?? r.requests ?? 0),
        cost: Math.round(((inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out) * 100) / 100,
        costSource: 'estimated',
        errors: 0,
      })
    }
  }
  return rows
}

/* ── Fetchers (thin; not exercised against a live key in this build) ── */

function mapStatus(status: number, body: string): ConnectorError {
  if (status === 401) return new ConnectorError('unauthorized', 'That key was rejected. Make sure it is a valid Admin key.')
  if (status === 403) return new ConnectorError('forbidden', 'That key lacks the Usage/Admin scope. Use an organization Admin key.')
  if (status === 429) return new ConnectorError('rate', 'Rate limited by the provider - try again in a minute.')
  return new ConnectorError('error', `Provider error ${status}. ${body.slice(0, 140)}`)
}

const SECONDS = 86_400

export async function fetchOpenAIUsage(adminKey: string, days = 30): Promise<UsageRow[]> {
  const startTime = Math.floor(Date.now() / 1000) - days * SECONDS
  const pull = async (path: string, extra: [string, string][]): Promise<unknown[]> => {
    const out: unknown[] = []
    let page: string | undefined
    do {
      const url = new URL(`https://api.openai.com/v1/organization/${path}`)
      url.searchParams.set('start_time', String(startTime))
      url.searchParams.set('bucket_width', '1d')
      url.searchParams.set('limit', '31')
      for (const [k, v] of extra) url.searchParams.append(k, v)
      if (page) url.searchParams.set('page', page)
      const res = await fetch(url, { headers: { Authorization: `Bearer ${adminKey}` } })
      if (!res.ok) throw mapStatus(res.status, await res.text())
      const json = (await res.json()) as { data?: unknown[]; next_page?: string | null }
      out.push(...(json.data ?? []))
      page = json.next_page ?? undefined
    } while (page)
    return out
  }
  const usage = (await pull('usage/completions', [
    ['group_by', 'model'],
    ['group_by', 'project_id'],
  ])) as OAUsageBucket[]
  let costs: OACostBucket[] | undefined
  try {
    costs = (await pull('costs', [['group_by', 'project_id']])) as OACostBucket[]
  } catch {
    costs = undefined // costs are best-effort; fall back to estimated
  }
  const rows = openAIUsageToRows(usage, costs)
  if (!rows.length) throw new ConnectorError('empty', 'No usage found for the last 30 days on this key.')
  return rows
}

export async function fetchAnthropicUsage(adminKey: string, days = 30): Promise<UsageRow[]> {
  const startingAt = new Date(Date.now() - days * SECONDS * 1000).toISOString()
  const data: ANBucket[] = []
  let page: string | undefined
  do {
    const url = new URL('https://api.anthropic.com/v1/organizations/usage_report/messages')
    url.searchParams.set('starting_at', startingAt)
    url.searchParams.set('bucket_width', '1d')
    url.searchParams.append('group_by[]', 'model')
    url.searchParams.append('group_by[]', 'workspace_id')
    url.searchParams.set('limit', '31')
    if (page) url.searchParams.set('page', page)
    const res = await fetch(url, { headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' } })
    if (!res.ok) throw mapStatus(res.status, await res.text())
    const json = (await res.json()) as { data?: ANBucket[]; next_page?: string | null }
    data.push(...(json.data ?? []))
    page = json.next_page ?? undefined
  } while (page)
  const rows = anthropicUsageToRows(data)
  if (!rows.length) throw new ConnectorError('empty', 'No usage found for the last 30 days on this key.')
  return rows
}
