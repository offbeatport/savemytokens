# The Reports

SaveMyTokens runs **one scan** over your LLM usage metadata and computes **5 paid
reports** from it (`registry.ts` / `catalog.ts`), each gated by its own free
**Spend Snapshot**. Six deliverables in total: the snapshot + five reports.

Everything below is derived from the same `UsageRow[]` in a single
`buildContext()` pass — **no prompts or responses are ever ingested**.

---

## What the scan ingests

One row = one aggregate of usage (per model × project × day, however your export
buckets it). Columns are auto-mapped from common OpenAI / Anthropic / Gemini
export names (see `docs/exporting.md`).

| Field | Required? | Aliases auto-mapped | Used by |
|---|---|---|---|
| `model` | **yes** | `model`, `model_name`, `engine`, `deployment` | all reports |
| `date` | **yes** | `date`, `day`, `timestamp`, `usage_date`, `start_time`, `bucket` | trend, spikes |
| `project` | **yes** (defaults to one bucket) | `project`, `project_id`, `api_key`, `workspace`, `app` | margin, leaks, attribution |
| `inputTokens` | **yes** | `input_tokens`, `prompt_tokens`, `uncached_input_tokens` | caching, bloat, token split |
| `outputTokens` | **yes** | `output_tokens`, `completion_tokens` | output caps, token split |
| `requests` | **yes** | `requests`, `num_model_requests`, `calls`, `count` | per-req math, runaway volume |
| `cost` | strongly recommended | `total_cost`, `cost`, `amount`, `spend`, `usd` | every dollar figure; **if absent, estimated from tokens × list price** |
| `errors` | optional | `errors`, `error_count`, `failures` | agent-waste (retry storms) |
| `reasoningTokens` | optional | `reasoning_tokens`, `thinking_tokens` | diagnostics: invisible reasoning spend |
| `cacheReadTokens` | optional | `cache_read_input_tokens`, `cached_tokens` | diagnostics: real cache-hit rate |
| `cacheWriteTokens` | optional | `cache_creation_input_tokens` | diagnostics: cache health |
| `latencyMs` | optional | `latency_ms`, `p50_ms` | reserved |

**Cost provenance** (`costSource`) is captured at parse time: a present cost
column → `actual`; backfilled from list price → `estimated`. This drives the
`actual` / `estimated` / `mixed` badge and the confidence cap (see Cross-cutting).

---

## 0. Free Spend Snapshot (the gate on every report)

- **Gets:** spend analyzed, period, health score + band, top model %, output-cost
  %, cost-basis badge, one *middle-ground* insight, locked-category counts.
- **Value add:** instant free diagnosis — proves money is on the table without
  handing over the fix.
- **Data needed:** the core fields above. Works with estimated cost.
- **Limitation (by design):** `buildSnapshot()` is the sole paywall chokepoint and
  **never** reveals the report's #1 finding. Reports with ≤1 finding reveal nothing
  finding-level (generic teaser only). All fixes sit behind the $99 unlock.

---

## 1. AI Cost Health Report — `ai-cost-health` · `scope: meta`

The flagship: the complete diagnosis across every waste category in one ranked list.

- **Detectors (5, deduped by id):** `detectModelDowngrade`, `detectOutputCaps`,
  `detectPromptCaching`, `detectRetryWaste`, `detectProjectLeak`.
- **Gets:** full ranked savings list; exact affected projects/models; per-finding
  "receipts" (`buildMetrics`: $/request now vs cheaper sibling, % of spend,
  annualized, assumptions); spend-by-model / spend-by-project; input vs output
  token split; spend-spike anomalies; founder-ready memo.
- **Value add:** one prioritized, founder-ready picture instead of five
  disconnected audits.
- **Data needed:** core fields (`model`, `date`, `project`, tokens, `requests`,
  `cost`). `errors` enriches the retry finding; everything else degrades gracefully.
- **Limitations:** "healthy" when findings total < 5% of spend (meta scope);
  $25/mo floor per finding; savings are estimated **ranges**, not guarantees.

## 2. Model & Output Waste Report — `model-output-waste` · `scope: focused`

- **Detectors (2):** `detectModelDowngrade` (model >6% of spend, cheaper sibling
  ≥10% cheaper/token) + `detectOutputCaps` (fires only when output ≥38% of cost).
- **Gets:** premium-model calls that could downgrade with per-token savings math;
  LMArena Elo quality comparison vs the cheaper sibling; verbose-output endpoints
  ranked by output $/req.
- **Value add:** the highest-leverage, lowest-risk lever (right-sizing + capping
  `max_tokens`), backed by third-party quality proof so downgrades aren't blind.
- **Data needed:** `model`, `cost`, `requests`, and **`inputTokens` + `outputTokens`**
  (the output-cost split is what triggers the caps finding).
- **Limitations:** caps finding only surfaces above a 38% output share; downgrade
  savings assume 15–40% of volume is migratable; intentionally double-counts with
  `ai-cost-health`.

## 3. Prompt Cache Readiness Audit — `prompt-cache-readiness` · `scope: focused`

- **Detectors (2):** `detectPromptCaching` (>2,500 input tok/req AND >200 req) +
  `detectPromptBloat` (>4,000 tok/req AND >500 req).
- **Gets:** cacheable prompt prefixes by project; oversized prompts to trim;
  per-project input-token breakdown; per-provider caching setup steps.
- **Value add:** separates two distinct fixes — caching (repeated tokens at 10–25%
  of rate) vs trimming (removing tokens entirely); they compound.
- **Data needed:** strong **`inputTokens`** + **`requests`** per `project`. Add
  `cacheReadTokens` to measure your *real* hit rate (otherwise it's a projection).
- **Limitations:** narrow → often ≤1 finding, so the snapshot shows nothing
  (single-finding guard); savings assume 40–80% cache-hit; can't confirm actual
  hit rate without a `cache_read_input_tokens` column.

## 4. Agent Waste Detector — `agent-waste-detector` · `scope: focused` · **metadata-limited**

- **Detectors (2):** `detectRetryWaste` (error rate ≥3%) + `detectRunawayVolume`
  (>50k req with <400 tok/req fan-out signature, correlated with daily spikes).
- **Gets:** error-rate analysis; high-volume/low-token request patterns;
  spend-spike correlation; suspected fan-out/loop projects; mitigation steps
  (backoff, idempotency keys, iteration caps).
- **Value add:** catches retry storms and runaway agent loops — the failure mode
  that silently 10×'s a bill overnight.
- **Data needed:** **`errors`** column for retry detection; high-resolution
  **`requests`** + tokens per `project` + `date` for the runaway signature.
- **Limitations (hard-capped):** `confidenceCeiling: 'medium'` + mandatory
  `limitationNote` — metadata can *infer* loops from request/error density but
  **cannot prove** them; only request traces can. Does nothing without `errors`.

## 5. AI Margin Leak Report — `ai-margin-leak` · `kind: margin` · `scope: focused`

- **Detectors (2):** `detectMarginLeak` (joins projects to a revenue map) +
  `detectProjectLeak` (fallback).
- **Gets (with a revenue map):** per-customer cost attribution; **below-cost
  accounts** (AI cost > revenue, negative margin); **thin-margin accounts** (AI
  >50% of revenue); full margin table; re-pricing / rate-limit recommendations.
- **Value add:** the only report tying cost to *revenue* — turns "we spend X" into
  "customer Y loses us money." Defends gross margin directly.
- **Data needed:** the usage scan **plus an optional project→revenue CSV**
  (`parseRevenueMap`):
  - key column: `project` / `project_id` / `key` / `api_key` / `customer` / `plan_id` / `workspace`
  - revenue column: `monthly_revenue` / `revenue` / `mrr` / `amount` / `monthly`
  - optional `plan` / `tier` / `plan_name`
  - the key **must match the usage `project` label** to join.
- **Limitations:** **degrades hard without a revenue map** → `confidenceCeiling:
  'low'`, shows cost concentration only. Accuracy bounded by map coverage
  (`coveragePct`); unmatched projects are excluded from margin math.

---

## Cross-cutting layers (attached to every report)

- **Cost reconciliation:** each report is labeled `actual` / `estimated` /
  `mixed`. If spend is mostly estimated (fully estimated, or mixed and <50%
  provider-reported), every finding's confidence is capped at `medium` and a
  `confidenceNote` is shown. **Biggest trust limitation** — without a provider
  cost export, every dollar is a list-price estimate.
- **Diagnostics (`buildDiagnostics`):** four things no dashboard shows — invisible
  reasoning-token spend (`reasoningTokens`), unattributed-spend governance score
  (`project` tagging), deprecated models in use, cache-hit health
  (`cacheReadTokens`). Each degrades **honestly** (`available: false`) when the
  export lacks the column rather than inventing a number.
- **Market rows (`buildMarketRows`):** joins your models to a price/quality index
  (Elo, list price, lifecycle, cheapest credible open alternative) as of a fixed
  `MARKET_AS_OF` date — so it goes stale and must be refreshed.

## Overall limitations

- **Metadata-only ceiling:** no request traces → agent/loop detection is
  inferential; no `cost` column → all estimates; no cache/reasoning columns →
  those diagnostics stay blank.
- **Estimates are ranges with baked-in assumptions** (migratable %, cache-hit %,
  recoverable %), not measured outcomes.
- **Cross-report double-counting** is intentional (independent $99 purchases) —
  marketing must not sum savings across reports.
- **$25/mo per-finding floor** + the 5%-of-spend "healthy" threshold mean small
  accounts may legitimately see "nothing found."
