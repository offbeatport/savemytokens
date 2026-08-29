import type { UsageRow, Provider, RevenueMap, RevenueEntry, RevenueRow } from './types'
import { priceFor } from './pricing'

/**
 * Flexible CSV parser for uploaded usage exports. Maps common column
 * aliases from OpenAI / Anthropic / Gemini exports. Only usage metadata
 * is read - never prompts or responses.
 */

const ALIASES: Record<string, string[]> = {
  provider: ['provider', 'vendor', 'platform'],
  model: ['model', 'model_name', 'engine', 'deployment'],
  date: ['date', 'day', 'timestamp', 'usage_date', 'created_at', 'bucket', 'starting_at', 'start_time'],
  project: ['project', 'project_id', 'api_key', 'api_key_name', 'api_key_id', 'key', 'app'],
  customerId: ['customer_id', 'customer', 'customerid', 'customer_email', 'account', 'account_id'],
  plan: ['plan', 'tier', 'plan_name', 'plan_id'],
  feature: ['feature', 'feature_name', 'endpoint', 'route', 'use_case', 'usecase'],
  workspace: ['workspace', 'workspace_id', 'team', 'org', 'organization'],
  inputTokens: ['input_tokens', 'prompt_tokens', 'uncached_input_tokens', 'inputtokens', 'input', 'prompt'],
  outputTokens: ['output_tokens', 'completion_tokens', 'outputtokens', 'output', 'completion'],
  requests: ['requests', 'request_count', 'num_model_requests', 'calls', 'count', 'n_requests'],
  cost: ['total_cost', 'cost', 'amount', 'spend', 'usd', 'total'],
  errors: ['errors', 'error_count', 'failures', 'failed'],
  latencyMs: ['latency_ms', 'latency', 'avg_latency_ms', 'p50_ms'],
  reasoningTokens: ['reasoning_tokens', 'output_reasoning_tokens', 'thinking_tokens'],
  cacheReadTokens: ['cache_read_input_tokens', 'cached_tokens', 'cached_input_tokens', 'cache_read_tokens', 'prompt_cache_hit_tokens'],
  cacheWriteTokens: ['cache_creation_input_tokens', 'cache_write_tokens', 'cache_creation_tokens'],
}

// Cached-input token fields that should be ADDED to input tokens (provider-side
// caching breakdowns, e.g. Anthropic cache_creation/cache_read).
const CACHE_INPUT_FIELDS = [
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
  'cached_input_tokens',
]

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

function num(v: string | undefined): number {
  if (!v) return 0
  const n = Number(v.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function inferProvider(model: string): Provider {
  const m = model.toLowerCase()
  if (m.includes('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.includes('davinci')) return 'openai'
  if (m.includes('claude')) return 'anthropic'
  if (m.includes('gemini') || m.includes('palm')) return 'gemini'
  return 'other'
}

function normDate(v: string): string {
  if (!v) return '1970-01-01'
  if (/^\d{10}$/.test(v)) return new Date(Number(v) * 1000).toISOString().slice(0, 10) // unix seconds
  if (/^\d{13}$/.test(v)) return new Date(Number(v)).toISOString().slice(0, 10) // unix ms
  const iso = v.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '1970-01-01' : d.toISOString().slice(0, 10)
}

function asStr(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v)
}

export interface ParseResult {
  rows: UsageRow[]
  warnings: string[]
  rowCount: number
}

export function parseUsageCsv(text: string): ParseResult {
  const warnings: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
  if (lines.length < 2) return { rows: [], warnings: ['No data rows found.'], rowCount: 0 }

  const header = splitCsvLine(lines[0]).map(norm)
  const colOf = (field: string): number => {
    for (const a of ALIASES[field]) {
      const i = header.indexOf(norm(a))
      if (i !== -1) return i
    }
    return -1
  }
  const idx = Object.fromEntries(
    Object.keys(ALIASES).map((f) => [f, colOf(f)]),
  ) as Record<keyof typeof ALIASES, number>
  // Anthropic-style separate cache columns are folded into input tokens (same as
  // the JSON path) so cost + cache-hit math agree across CSV and JSON. NOT
  // OpenAI's `cached_tokens`, which is already inside prompt_tokens.
  const cacheFoldIdx = CACHE_INPUT_FIELDS.map((f) => header.indexOf(norm(f))).filter((i) => i >= 0)

  if (idx.model === -1) warnings.push('No "model" column found - rows may be skipped.')
  if (idx.cost === -1) warnings.push('No "cost" column - cost will be estimated from token counts.')

  const rows: UsageRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i])
    const model = idx.model >= 0 ? c[idx.model] : ''
    if (!model) continue
    let inputTokens = num(c[idx.inputTokens])
    for (const ci of cacheFoldIdx) inputTokens += num(c[ci])
    const outputTokens = num(c[idx.outputTokens])
    let cost = num(c[idx.cost])
    const costSource: 'actual' | 'estimated' = cost > 0 ? 'actual' : 'estimated'
    if (cost <= 0) {
      const p = priceFor(model)
      cost = (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out
    }
    const provider = (idx.provider >= 0 && c[idx.provider]
      ? (norm(c[idx.provider]) as Provider)
      : inferProvider(model)) as Provider
    rows.push({
      provider: ['openai', 'anthropic', 'gemini'].includes(provider) ? provider : inferProvider(model),
      model,
      date: normDate(idx.date >= 0 ? c[idx.date] : ''),
      project: (idx.project >= 0 && c[idx.project]) || 'default',
      customerId: idx.customerId >= 0 ? c[idx.customerId] || undefined : undefined,
      plan: idx.plan >= 0 ? c[idx.plan] || undefined : undefined,
      feature: idx.feature >= 0 ? c[idx.feature] || undefined : undefined,
      workspace: idx.workspace >= 0 ? c[idx.workspace] || undefined : undefined,
      inputTokens,
      outputTokens,
      requests: Math.max(1, num(c[idx.requests]) || 1),
      cost: Math.round(cost * 100) / 100,
      costSource,
      errors: idx.errors >= 0 ? num(c[idx.errors]) : 0,
      latencyMs: idx.latencyMs >= 0 ? num(c[idx.latencyMs]) || undefined : undefined,
      reasoningTokens: idx.reasoningTokens >= 0 ? num(c[idx.reasoningTokens]) || undefined : undefined,
      cacheReadTokens: idx.cacheReadTokens >= 0 ? num(c[idx.cacheReadTokens]) || undefined : undefined,
      cacheWriteTokens: idx.cacheWriteTokens >= 0 ? num(c[idx.cacheWriteTokens]) || undefined : undefined,
    })
  }
  if (!rows.length) warnings.push('Could not parse any usable rows from this file.')
  return { rows, warnings, rowCount: rows.length }
}

/** Map a single JSON usage object (CSV-style row, or an OpenAI/Anthropic usage
 * result) into a UsageRow. `bucketDate` supplies the date for bucket results
 * that don't carry their own. */
function rowFromObject(obj: Record<string, unknown>, bucketDate?: string): UsageRow | null {
  const map = new Map<string, unknown>()
  for (const [k, v] of Object.entries(obj)) map.set(norm(k), v)
  const get = (field: keyof typeof ALIASES): unknown => {
    for (const a of ALIASES[field]) {
      const v = map.get(norm(a))
      if (v !== undefined && v !== null) return v
    }
    return undefined
  }

  const model = String(get('model') ?? '').trim()
  if (!model) return null

  // Input tokens, plus any provider-side cache breakdown (Anthropic).
  let inputTokens = num(asStr(get('inputTokens')))
  for (const f of CACHE_INPUT_FIELDS) inputTokens += num(asStr(map.get(norm(f))))
  const outputTokens = num(asStr(get('outputTokens')))

  // Cost may be a nested { value } (OpenAI/Anthropic cost objects); else estimate.
  let cost = num(asStr(get('cost')))
  const amount = map.get('amount')
  if (cost <= 0 && amount && typeof amount === 'object') {
    cost = num(asStr((amount as { value?: unknown }).value))
  }
  const costSource: 'actual' | 'estimated' = cost > 0 ? 'actual' : 'estimated'
  if (cost <= 0) {
    const p = priceFor(model)
    cost = (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out
  }

  const providerRaw = norm(String(get('provider') ?? ''))
  const provider: Provider = (['openai', 'anthropic', 'gemini'] as readonly string[]).includes(
    providerRaw,
  )
    ? (providerRaw as Provider)
    : inferProvider(model)

  const dateVal = get('date')
  const date = dateVal !== undefined ? normDate(String(dateVal)) : (bucketDate ?? '1970-01-01')

  return {
    provider,
    model,
    date,
    project: String(get('project') ?? 'default') || 'default',
    customerId: asStr(get('customerId')),
    plan: asStr(get('plan')),
    feature: asStr(get('feature')),
    workspace: asStr(get('workspace')),
    inputTokens,
    outputTokens,
    requests: Math.max(1, num(asStr(get('requests'))) || 1),
    cost: Math.round(cost * 100) / 100,
    costSource,
    errors: num(asStr(get('errors'))),
    reasoningTokens: num(asStr(get('reasoningTokens'))) || undefined,
    cacheReadTokens: num(asStr(get('cacheReadTokens'))) || undefined,
    cacheWriteTokens: num(asStr(get('cacheWriteTokens'))) || undefined,
  }
}

/** Parse a JSON usage export: a raw array of rows, or an OpenAI/Anthropic usage
 * API response ({ data: [{ start_time, results: [...] }] }). */
export function parseUsageJson(text: string): ParseResult {
  const warnings: string[] = []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { rows: [], warnings: ['File is not valid JSON.'], rowCount: 0 }
  }

  const rows: UsageRow[] = []
  const push = (o: unknown, bucketDate?: string) => {
    if (o && typeof o === 'object') {
      const r = rowFromObject(o as Record<string, unknown>, bucketDate)
      if (r) rows.push(r)
    }
  }

  const top = data as { data?: unknown; results?: unknown }
  const buckets = Array.isArray(top?.data) ? top.data : Array.isArray(data) ? (data as unknown[]) : null

  if (buckets && buckets.some((b) => Array.isArray((b as { results?: unknown })?.results))) {
    // Usage-API bucket shape (OpenAI / Anthropic)
    for (const b of buckets as Array<Record<string, unknown>>) {
      const bd = b.start_time ?? b.starting_at ?? b.bucket_start
      const bucketDate = bd !== undefined ? normDate(String(bd)) : undefined
      const results = Array.isArray(b.results) ? b.results : []
      for (const r of results) push(r, bucketDate)
    }
  } else if (Array.isArray(data)) {
    for (const o of data) push(o)
  } else if (Array.isArray(top?.results)) {
    for (const o of top.results as unknown[]) push(o)
  } else {
    warnings.push('Unrecognized JSON shape - expected an array of rows or a usage API response.')
  }

  if (!rows.length && !warnings.length) warnings.push('No usable usage rows found in the JSON.')
  return { rows, warnings, rowCount: rows.length }
}

/** Dispatch on content: JSON (starts with { or [) or CSV. */
export function parseUsage(text: string): ParseResult {
  const t = text.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) return parseUsageJson(text)
  return parseUsageCsv(text)
}

const REVENUE_ALIASES = {
  key: ['project', 'project_id', 'key', 'api_key', 'customer', 'plan_id', 'workspace'],
  revenue: ['monthly_revenue', 'revenue', 'mrr', 'amount', 'monthly'],
  plan: ['plan', 'tier', 'plan_name'],
}

/** Parse a project→revenue CSV that upgrades ai-margin-leak to true margins. */
export function parseRevenueMap(csv: string): { map: RevenueMap; warnings: string[] } {
  const warnings: string[] = []
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length)
  if (lines.length < 2) return { map: { keyBy: 'project', entries: [] }, warnings: ['No data rows found.'] }
  const header = splitCsvLine(lines[0]).map(norm)
  const colOf = (aliases: string[]) => {
    for (const a of aliases) {
      const i = header.indexOf(norm(a))
      if (i !== -1) return i
    }
    return -1
  }
  const ki = colOf(REVENUE_ALIASES.key)
  const ri = colOf(REVENUE_ALIASES.revenue)
  const pi = colOf(REVENUE_ALIASES.plan)
  if (ki === -1) warnings.push('No project/key column found.')
  if (ri === -1) warnings.push('No revenue/MRR column found.')
  const entries: RevenueEntry[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i])
    const key = ki >= 0 ? c[ki] : ''
    if (!key) continue
    entries.push({
      key,
      monthlyRevenue: num(c[ri]),
      plan: pi >= 0 ? c[pi] || undefined : undefined,
    })
  }
  if (!entries.length) warnings.push('No usable revenue rows parsed.')
  return { map: { keyBy: 'project', entries }, warnings }
}

const REVENUE2_ALIASES = {
  customerId: ['customer_id', 'customer', 'customerid', 'customer_email', 'email', 'account', 'account_id', 'project', 'key', 'workspace'],
  label: ['name', 'customer_name', 'label', 'company'],
  revenue: ['monthly_revenue', 'mrr', 'revenue', 'amount', 'monthly'],
  plan: ['plan', 'tier', 'plan_name'],
}

/** Parse a customer→revenue CSV into RevenueRow[] (Margin Intelligence). The CSV
 * fallback for users who don't connect Stripe. Columns auto-mapped. */
export function parseRevenue(csv: string): { rows: RevenueRow[]; warnings: string[] } {
  const warnings: string[] = []
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length)
  if (lines.length < 2) return { rows: [], warnings: ['No data rows found.'] }
  const header = splitCsvLine(lines[0]).map(norm)
  const colOf = (aliases: string[]) => {
    for (const a of aliases) {
      const i = header.indexOf(norm(a))
      if (i !== -1) return i
    }
    return -1
  }
  const ci = colOf(REVENUE2_ALIASES.customerId)
  const li = colOf(REVENUE2_ALIASES.label)
  const ri = colOf(REVENUE2_ALIASES.revenue)
  const pi = colOf(REVENUE2_ALIASES.plan)
  if (ci === -1) warnings.push('No customer/account column found.')
  if (ri === -1) warnings.push('No revenue/MRR column found.')
  const rows: RevenueRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i])
    const customerId = ci >= 0 ? c[ci] : ''
    if (!customerId) continue
    rows.push({
      customerId,
      label: (li >= 0 && c[li]) || customerId,
      monthlyRevenue: num(c[ri]),
      plan: pi >= 0 ? c[pi] || undefined : undefined,
      source: 'csv',
    })
  }
  if (!rows.length) warnings.push('No usable revenue rows parsed.')
  return { rows, warnings }
}
