#!/usr/bin/env node
/**
 * Generate realistic mock LLM usage that flows through SaveMyTokens' real parser
 * + engine and lights up all 5 reports. Costs are computed from token counts at
 * current list prices, so `total_cost` is internally consistent and the engine
 * reads it as ACTUAL (costBasis: 'actual').
 *
 *   node scripts/gen-mock-usage.mjs                 # default 'saas' profile -> sample-data/
 *   PROFILE=agents DAYS=30 SEED=7 node scripts/gen-mock-usage.mjs
 *   PROFILE=healthy node scripts/gen-mock-usage.mjs
 *
 * Profiles: saas (balanced, triggers everything) | agents (fan-out + retries) | healthy (right-sized)
 * Writes:   sample-data/usage-<profile>.csv  and  sample-data/revenue-<profile>.csv (for the margin report)
 *
 * Upload usage-*.csv on /scan; attach revenue-*.csv on the AI Margin Leak report.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Mirror of src/lib/analysis/pricing.ts (USD per 1M tokens). Keep roughly in sync.
const PRICE = {
  'gpt-4o': { in: 2.5, out: 10, provider: 'openai' },
  'gpt-4o-mini': { in: 0.15, out: 0.6, provider: 'openai' },
  'gpt-4-turbo': { in: 10, out: 30, provider: 'openai' },
  'o3': { in: 10, out: 40, provider: 'openai', reasoning: true },
  'o1': { in: 15, out: 60, provider: 'openai', reasoning: true },
  'claude-3-opus': { in: 15, out: 75, provider: 'anthropic' },
  'claude-3-5-sonnet': { in: 3, out: 15, provider: 'anthropic' },
  'claude-3-5-haiku': { in: 0.8, out: 4, provider: 'anthropic' },
  'gemini-1.5-pro': { in: 1.25, out: 5, provider: 'gemini' },
  'gemini-1.5-flash': { in: 0.075, out: 0.3, provider: 'gemini' },
}

// project, model, monthly requests, avg input tok/req, avg output tok/req, monthly errors
const PROFILES = {
  saas: [
    ['checkout-agent', 'gpt-4o', 230_000, 3500, 650, 0], // premium + dominant -> downgrade + leak + margin
    ['checkout-agent', 'claude-3-opus', 18_000, 2000, 280, 0], // legacy model
    ['support-bot', 'gpt-4o-mini', 1_400_000, 2500, 450, 0],
    ['support-bot', 'gpt-4o', 92_000, 1500, 280, 0],
    ['doc-summarizer', 'claude-3-5-sonnet', 30_000, 9000, 1300, 0], // big input + verbose -> caching/bloat/output-caps
    ['batch-classifier', 'gpt-4o-mini', 1_500_000, 1800, 320, 130_000], // errors -> retry-waste
    ['reasoning-jobs', 'o3', 60_000, 2500, 1800, 0], // reasoning model -> invisible reasoning-token spend
    ['default', 'gpt-4o', 110_000, 2000, 350, 0], // untagged -> unattributed-spend score
    ['internal-tools', 'gemini-1.5-pro', 88_000, 2200, 400, 0],
  ],
  agents: [
    ['research-agent', 'gpt-4o', 180_000, 4200, 700, 0],
    ['research-agent', 'gpt-4o-mini', 2_400_000, 220, 90, 0], // huge volume, tiny tokens -> runaway-volume
    ['tool-router', 'gpt-4o-mini', 3_100_000, 180, 60, 210_000], // fan-out + retries -> agent waste
    ['summarizer', 'claude-3-5-sonnet', 26_000, 8200, 1400, 0],
    ['planner', 'claude-3-opus', 14_000, 3000, 900, 0],
  ],
  healthy: [
    ['search-rerank', 'gpt-4o-mini', 2_400_000, 1500, 180, 0],
    ['tagging', 'gemini-1.5-flash', 4_200_000, 1200, 150, 0],
    ['inbox-assist', 'claude-3-5-haiku', 900_000, 1400, 220, 0],
    ['moderation', 'gpt-4o-mini', 2_300_000, 1300, 160, 0],
  ],
}

const REVENUE = {
  saas: { 'checkout-agent': 3000, 'support-bot': 9000, 'doc-summarizer': 2000, 'batch-classifier': 6000, 'internal-tools': 0 },
  agents: { 'research-agent': 4000, 'tool-router': 3500, summarizer: 6000, planner: 5000 },
  healthy: { 'search-rerank': 9000, tagging: 12000, 'inbox-assist': 7000, moderation: 8000 },
}

const PLAN = ['Pro', 'Scale', 'Team', 'Growth', 'Enterprise']

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

const PROFILE = (process.env.PROFILE || 'saas').toLowerCase()
const DAYS = Number(process.env.DAYS || 30)
const rnd = mulberry32(Number(process.env.SEED || 42))
const rows = PROFILES[PROFILE]
if (!rows) {
  console.error(`Unknown PROFILE "${PROFILE}". Use: ${Object.keys(PROFILES).join(' | ')}`)
  process.exit(1)
}

// daily weights: gentle waves, weekend dips, one spike near day 21
const weights = Array.from({ length: DAYS }, (_, i) => {
  const weekend = i % 7 === 5 || i % 7 === 6 ? 0.6 : 1
  const wave = 0.9 + 0.25 * Math.sin(i / 3)
  const jitter = 0.85 + rnd() * 0.3
  const spike = i === Math.floor(DAYS * 0.7) ? 2.6 : 1
  return weekend * wave * jitter * spike
})
const wsum = weights.reduce((a, b) => a + b, 0)

function dates() {
  const out = []
  const today = new Date()
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

const day = dates()
const header =
  'provider,model,date,project,input_tokens,output_tokens,requests,total_cost,errors,reasoning_tokens,cache_read_input_tokens,cache_creation_input_tokens'
const lines = [header]

for (const [project, model, reqs, inPer, outPer, errs] of rows) {
  const p = PRICE[model] ?? { in: 2, out: 8, provider: 'other' }
  const largePrompt = inPer >= 5000 // big stable prefixes -> caching columns
  for (let i = 0; i < DAYS; i++) {
    const w = weights[i] / wsum
    const requests = Math.round(reqs * w)
    if (requests <= 0) continue
    const inTok = Math.round(requests * inPer * (0.92 + rnd() * 0.16))
    const outTok = Math.round(requests * outPer * (0.92 + rnd() * 0.16))
    const cost = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out
    const e = errs ? Math.round(errs * w) : 0
    // reasoning tokens are a subset of output on reasoning models (billed as output)
    const reasoning = p.reasoning ? Math.round(outTok * 0.65) : 0
    // cache breakdown only where a large stable prefix is repeated
    const cacheRead = largePrompt ? Math.round(inTok * 0.5) : 0
    const cacheWrite = largePrompt ? Math.round(inTok * 0.04) : 0
    lines.push(
      [p.provider, model, day[i], project, inTok, outTok, requests, cost.toFixed(2), e, reasoning, cacheRead, cacheWrite].join(','),
    )
  }
}

const outDir = resolve(process.cwd(), process.env.OUT || 'sample-data')
mkdirSync(outDir, { recursive: true })
const usagePath = resolve(outDir, `usage-${PROFILE}.csv`)
writeFileSync(usagePath, lines.join('\n') + '\n')

// revenue map for the margin report
const rev = REVENUE[PROFILE] ?? {}
const projects = [...new Set(rows.map((r) => r[0]))]
const revLines = ['project,monthly_revenue,plan']
projects.forEach((proj, i) => {
  revLines.push(`${proj},${rev[proj] ?? 0},${PLAN[i % PLAN.length]}`)
})
const revenuePath = resolve(outDir, `revenue-${PROFILE}.csv`)
writeFileSync(revenuePath, revLines.join('\n') + '\n')

const totalCost = lines.slice(1).reduce((a, l) => a + Number(l.split(',')[7]), 0)
console.log(`Wrote ${lines.length - 1} rows (~$${totalCost.toFixed(0)} over ${DAYS} days, ${projects.length} projects)`)
console.log(`  usage:   ${usagePath}`)
console.log(`  revenue: ${revenuePath}`)
console.log(`\nUpload usage-${PROFILE}.csv on /scan; attach revenue-${PROFILE}.csv on the AI Margin Leak report.`)
