#!/usr/bin/env node
/**
 * Pull your Anthropic usage from the Usage & Cost Admin API and emit a CSV that
 * SaveMyTokens can ingest (drag the output into the /scan upload box).
 *
 *   ANTHROPIC_ADMIN_KEY=sk-ant-admin... node scripts/anthropic-usage.mjs > anthropic-usage.csv
 *
 * Optional env:  DAYS=30
 *
 * Requires an Anthropic ADMIN key (sk-ant-admin…), created by an org admin in
 * the Claude Console. Token counts come from /v1/organizations/usage_report/messages
 * grouped by model + workspace. Cost is left blank → SaveMyTokens estimates it
 * from list price (or upload the Console Cost export alongside for actual $).
 *
 * NOTE: not verified against a live key in this build - if a field name differs
 * in your account, tweak the mapping below; the parser also accepts the raw JSON.
 */

const KEY = process.env.ANTHROPIC_ADMIN_KEY
if (!KEY) {
  console.error('Error: set ANTHROPIC_ADMIN_KEY (an admin key, sk-ant-admin…).')
  process.exit(1)
}

const DAYS = Number(process.env.DAYS || 30)
const startingAt = new Date(Date.now() - DAYS * 86_400_000).toISOString()
const BASE = 'https://api.anthropic.com/v1/organizations/usage_report/messages'

const header = ['provider', 'model', 'date', 'project', 'input_tokens', 'output_tokens', 'requests', 'total_cost', 'errors']
const lines = [header.join(',')]

let page
let pages = 0
do {
  const url = new URL(BASE)
  url.searchParams.set('starting_at', startingAt)
  url.searchParams.set('bucket_width', '1d')
  url.searchParams.append('group_by[]', 'model')
  url.searchParams.append('group_by[]', 'workspace_id')
  url.searchParams.set('limit', '31')
  if (page) url.searchParams.set('page', page)

  const res = await fetch(url, {
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
  })
  if (!res.ok) {
    console.error(`Anthropic API error ${res.status}: ${await res.text()}`)
    process.exit(1)
  }
  const json = await res.json()
  for (const bucket of json.data ?? []) {
    const date = String(bucket.starting_at ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    for (const r of bucket.results ?? []) {
      if (!r.model) continue
      const input =
        (r.uncached_input_tokens ?? r.input_tokens ?? 0) +
        (r.cache_read_input_tokens ?? 0) +
        (r.cache_creation_input_tokens ?? 0)
      lines.push(
        ['anthropic', r.model, date, r.workspace_id ?? 'default', input, r.output_tokens ?? 0, r.num_messages ?? r.requests ?? 0, '', 0].join(','),
      )
    }
  }
  page = json.next_page ?? json.has_more ? json.next_page : null
  pages++
} while (page)

process.stdout.write(lines.join('\n') + '\n')
console.error(`Done: ${lines.length - 1} rows across ${pages} page(s), last ${DAYS} days.`)
