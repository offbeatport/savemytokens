#!/usr/bin/env node
/**
 * Pull your OpenAI usage from the Usage API and emit a CSV that SaveMyTokens
 * can ingest directly (drag the output into the /scan upload box).
 *
 *   OPENAI_ADMIN_KEY=sk-admin-... node scripts/openai-usage.mjs > openai-usage.csv
 *
 * Optional env:
 *   DAYS=30                 how many days back to pull (default 30)
 *
 * Requires an OpenAI *Admin* key (platform.openai.com/settings/organization/admin-keys).
 * Token counts come from /v1/organization/usage/completions grouped by model &
 * project. Cost is left blank - SaveMyTokens estimates it from tokens × list price.
 */

const KEY = process.env.OPENAI_ADMIN_KEY
if (!KEY) {
  console.error('Error: set OPENAI_ADMIN_KEY (an admin key, sk-admin-…).')
  process.exit(1)
}

const DAYS = Number(process.env.DAYS || 30)
const startTime = Math.floor(Date.now() / 1000) - DAYS * 86_400
const BASE = 'https://api.openai.com/v1/organization/usage/completions'

const header = [
  'provider',
  'model',
  'date',
  'project',
  'input_tokens',
  'output_tokens',
  'requests',
  'total_cost',
  'errors',
]
const lines = [header.join(',')]

let page
let pages = 0
do {
  const url = new URL(BASE)
  url.searchParams.set('start_time', String(startTime))
  url.searchParams.set('bucket_width', '1d')
  url.searchParams.set('limit', '31')
  url.searchParams.append('group_by', 'model')
  url.searchParams.append('group_by', 'project_id')
  if (page) url.searchParams.set('page', page)

  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } })
  if (!res.ok) {
    console.error(`OpenAI API error ${res.status}: ${await res.text()}`)
    process.exit(1)
  }
  const json = await res.json()
  for (const bucket of json.data ?? []) {
    const date = new Date((bucket.start_time ?? 0) * 1000).toISOString().slice(0, 10)
    for (const r of bucket.results ?? []) {
      if (!r.model) continue
      lines.push(
        [
          'openai',
          r.model,
          date,
          r.project_id ?? 'default',
          r.input_tokens ?? 0,
          r.output_tokens ?? 0,
          r.num_model_requests ?? 0,
          '', // cost - estimated downstream from tokens
          0,
        ].join(','),
      )
    }
  }
  page = json.next_page
  pages++
} while (page)

process.stdout.write(lines.join('\n') + '\n')
console.error(`Done: ${lines.length - 1} rows across ${pages} page(s), last ${DAYS} days.`)
