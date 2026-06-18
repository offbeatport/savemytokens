#!/usr/bin/env node
/**
 * Generate realistic per-provider sample usage exports for SaveMyTokens.
 *
 *   node scripts/gen-samples.mjs            # writes everything to samples/
 *   OUT=samples SEED=42 node scripts/gen-samples.mjs
 *
 * Produces, for each provider (OpenAI / Anthropic / Gemini), three sizes:
 *   <provider>-small.csv   ~1 week, 3 projects   (quick smoke test)
 *   <provider>-medium.csv  ~30 days, 6 projects  (typical scan)
 *   <provider>-large.csv   ~30 days, all projects (full breadth)
 * plus a <provider>-revenue.csv map for the AI Margin Leak report.
 *
 * Each file uses that provider's authentic column names (auto-mapped by
 * src/lib/analysis/parse.ts) and models from src/lib/analysis/pricing.ts.
 * `cost` is computed from token counts at current list prices (with realistic
 * cache discounts), so the engine reads it as ACTUAL (costBasis: 'actual').
 * No `provider` column is emitted - it's inferred from the model name, exactly
 * like a real export.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// USD per 1M tokens - mirror of src/lib/analysis/pricing.ts. Keep roughly in sync.
const PRICE = {
  // OpenAI
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4-turbo': { in: 10, out: 30 },
  o3: { in: 2, out: 8, reasoning: true },
  o1: { in: 15, out: 60, reasoning: true },
  // Anthropic
  'claude-opus-4': { in: 15, out: 75 },
  'claude-3-opus': { in: 15, out: 75 },
  'claude-sonnet-4': { in: 3, out: 15 },
  'claude-3-5-sonnet': { in: 3, out: 15 },
  'claude-3-5-haiku': { in: 0.8, out: 4 },
  // Google
  'gemini-2.5-pro': { in: 1.25, out: 10, reasoning: true },
  'gemini-1.5-pro': { in: 1.25, out: 5 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5, reasoning: true },
  'gemini-1.5-flash': { in: 0.075, out: 0.3 },
}

// [project, model, monthlyRequests, avgInputTok/req, avgOutputTok/req, monthlyErrors]
// Ordered so the first 3 (the "small" set) already trigger a spread of findings.
const PROFILES = {
  openai: [
    ['prod-chat-api', 'gpt-4o', 220_000, 3200, 600, 0], // premium + dominant -> downgrade + leak
    ['doc-extraction', 'gpt-4o', 90_000, 9000, 1500, 0], // huge input + verbose -> caching/bloat/output-caps
    ['batch-tagging', 'gpt-4o-mini', 1_450_000, 1700, 300, 120_000], // errors -> retry-waste
    ['support-assistant', 'gpt-4o-mini', 1_300_000, 2600, 480, 0], // big repeated prefix -> caching
    ['prod-chat-api', 'gpt-4-turbo', 16_000, 2200, 320, 0], // legacy model still in use
    ['reasoning-pipeline', 'o3', 55_000, 2400, 1700, 0], // reasoning model -> invisible reasoning spend
    ['default', 'gpt-4o', 100_000, 1900, 340, 0], // untagged -> unattributed-spend score
    ['internal-eval', 'o1', 9_000, 3000, 2200, 0], // premium reasoning (o1 -> o3)
    ['embeddings-rerank', 'gpt-4o-mini', 600_000, 1200, 120, 0],
  ],
  anthropic: [
    ['assistant-api', 'claude-opus-4', 90_000, 3000, 700, 0], // premium + dominant -> downgrade + leak
    ['summarizer', 'claude-3-5-sonnet', 40_000, 9500, 1400, 0], // big input + verbose -> caching/bloat/output-caps
    ['classify-bot', 'claude-3-5-haiku', 1_600_000, 2600, 320, 110_000], // retries + caching candidate
    ['knowledge-base', 'claude-sonnet-4', 120_000, 5200, 600, 0], // large stable prefix -> caching/bloat
    ['assistant-api', 'claude-3-opus', 12_000, 2200, 400, 0], // legacy model still in use
    ['agent-runner', 'claude-3-5-haiku', 2_300_000, 260, 90, 180_000], // fan-out + retries -> runaway/agent waste
    ['default', 'claude-3-5-sonnet', 80_000, 2000, 380, 0], // untagged -> unattributed-spend score
  ],
  gemini: [
    ['vision-api', 'gemini-2.5-pro', 140_000, 3400, 700, 0], // premium + dominant -> downgrade + leak
    ['summaries', 'gemini-2.5-flash', 220_000, 8800, 1500, 0], // big input + verbose -> bloat/output-caps
    ['classifier', 'gemini-1.5-flash', 3_400_000, 1500, 180, 340_000], // ~10% errors -> retry-waste (survives dilution)
    ['rag-pipeline', 'gemini-2.5-pro', 95_000, 6000, 650, 0], // large retrieved context -> caching/bloat
    ['vision-api', 'gemini-1.5-pro', 60_000, 2800, 500, 0], // older pro tier (1.5-pro -> 1.5-flash)
    ['autocomplete', 'gemini-1.5-flash', 5_200_000, 900, 110, 0], // huge cheap volume (healthy)
    ['default', 'gemini-2.5-pro', 70_000, 2100, 360, 0], // untagged -> unattributed-spend score
  ],
}

// project -> monthly revenue (USD). 0 / low values create below-cost + thin-margin findings.
const REVENUE = {
  openai: {
    'prod-chat-api': 18_000,
    'doc-extraction': 4_000,
    'batch-tagging': 9_000,
    'support-assistant': 14_000,
    'reasoning-pipeline': 2_000,
    default: 0,
    'internal-eval': 0,
    'embeddings-rerank': 3_000,
  },
  anthropic: {
    'assistant-api': 16_000,
    summarizer: 3_000,
    'classify-bot': 11_000,
    'knowledge-base': 9_000,
    'agent-runner': 2_500,
    default: 0,
  },
  gemini: {
    'vision-api': 15_000,
    summaries: 2_400,
    classifier: 10_000,
    'rag-pipeline': 6_000,
    autocomplete: 20_000,
    default: 0,
  },
}

const PLAN = ['Enterprise', 'Scale', 'Growth', 'Pro', 'Team', 'Free']

// Provider-authentic column layouts. Every name is auto-mapped by parse.ts.
const COLUMNS = {
  openai: 'date,model,project,api_key_name,n_requests,input_tokens,cached_tokens,output_tokens,reasoning_tokens,total_cost,errors',
  anthropic:
    'date,model,workspace,requests,uncached_input_tokens,cache_read_input_tokens,cache_creation_input_tokens,output_tokens,cost,errors',
  gemini: 'usage_date,service,model,project_id,requests,input_tokens,output_tokens,thinking_tokens,cost,errors',
}

const SIZES = {
  small: { days: 7, take: 3 },
  medium: { days: 30, take: 6 },
  large: { days: 30, take: Infinity },
}

// ── seeded RNG so SEED reproduces the same shape ───────────────
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = Number(process.env.SEED || 42)
const outDir = resolve(process.cwd(), process.env.OUT || 'samples')
mkdirSync(outDir, { recursive: true })

function dailyWeights(days, rnd) {
  // gentle waves, weekend dips, one spike at ~70% through the window
  const w = Array.from({ length: days }, (_, i) => {
    const weekend = i % 7 === 5 || i % 7 === 6 ? 0.62 : 1
    const wave = 0.9 + 0.25 * Math.sin(i / 3)
    const jitter = 0.85 + rnd() * 0.3
    const spike = i === Math.floor(days * 0.7) ? 2.6 : 1
    return weekend * wave * jitter * spike
  })
  const sum = w.reduce((a, b) => a + b, 0)
  return { w, sum }
}

function dateList(days) {
  const out = []
  const today = new Date('2026-06-15T00:00:00Z') // fixed for reproducibility
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function genUsage(provider, sizeName) {
  const { days, take } = SIZES[sizeName]
  const rnd = mulberry32(SEED + provider.length + sizeName.length)
  const entries = PROFILES[provider].slice(0, take)
  const { w, sum } = dailyWeights(days, rnd)
  const day = dateList(days)
  const lines = [COLUMNS[provider]]
  let total = 0

  for (const [project, model, monthlyReq, inPer, outPer, errs] of entries) {
    const p = PRICE[model] ?? { in: 2, out: 8 }
    const cached = inPer >= 2500 // large repeated prefix -> provider-side caching applies
    for (let i = 0; i < days; i++) {
      // scale a monthly figure into this window so 7-day files ~= a week of spend
      const reqs = Math.round(monthlyReq * (w[i] / sum) * (days / 30))
      if (reqs <= 0) continue
      const inTok = Math.round(reqs * inPer * (0.92 + rnd() * 0.16))
      const outTok = Math.round(reqs * outPer * (0.92 + rnd() * 0.16))
      const e = errs ? Math.round(errs * (w[i] / sum) * (days / 30)) : 0
      const reasoning = p.reasoning ? Math.round(outTok * 0.6) : 0

      let cost
      let row
      if (provider === 'anthropic') {
        const read = cached ? Math.round(inTok * 0.55) : 0
        const write = cached ? Math.round(inTok * 0.03) : 0
        const uncached = inTok - read - write
        cost =
          (uncached / 1e6) * p.in +
          (read / 1e6) * p.in * 0.1 + // cache read billed ~0.1x
          (write / 1e6) * p.in * 1.25 + // cache write billed ~1.25x
          (outTok / 1e6) * p.out
        row = [day[i], model, project, reqs, uncached, read, write, outTok, cost.toFixed(2), e]
      } else if (provider === 'openai') {
        const hit = cached ? Math.round(inTok * 0.45) : 0
        cost =
          ((inTok - hit) / 1e6) * p.in +
          (hit / 1e6) * p.in * 0.5 + // cached input billed ~0.5x
          (outTok / 1e6) * p.out
        row = [day[i], model, project, project, reqs, inTok, hit, outTok, reasoning, cost.toFixed(2), e]
      } else {
        cost = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out
        row = [day[i], 'Generative Language API', model, project, reqs, inTok, outTok, reasoning, cost.toFixed(2), e]
      }
      total += cost
      lines.push(row.join(','))
    }
  }

  const path = resolve(outDir, `${provider}-${sizeName}.csv`)
  writeFileSync(path, lines.join('\n') + '\n')
  return { path, rows: lines.length - 1, total }
}

function genRevenue(provider) {
  const rev = REVENUE[provider]
  const lines = ['project,monthly_revenue,plan']
  Object.keys(rev).forEach((proj, i) => {
    lines.push(`${proj},${rev[proj]},${PLAN[i % PLAN.length]}`)
  })
  const path = resolve(outDir, `${provider}-revenue.csv`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

for (const provider of Object.keys(PROFILES)) {
  for (const size of Object.keys(SIZES)) {
    const { path, rows, total } = genUsage(provider, size)
    console.log(`${path.split('/').slice(-1)[0].padEnd(22)} ${String(rows).padStart(4)} rows  ~$${total.toFixed(0)}`)
  }
  console.log(`${genRevenue(provider).split('/').slice(-1)[0]}`)
}
console.log(`\nWrote to ${outDir}`)
