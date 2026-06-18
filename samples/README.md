# Sample usage exports

Realistic per-provider LLM usage exports for testing/demoing SaveMyTokens. Every
file is verified to parse through the real `parse.ts` + `analyzeAll()` engine with
**zero warnings**, `costBasis: 'actual'`, and findings across all reports.

Regenerate with: `node scripts/gen-samples.mjs` (deterministic; `SEED=` to vary).

## Files

| Provider | Sizes | Revenue map |
|---|---|---|
| OpenAI | `openai-small.csv` (7d, 3 projects) · `openai-medium.csv` (30d, 6) · `openai-large.csv` (30d, all) | `openai-revenue.csv` |
| Anthropic | `anthropic-small.csv` · `anthropic-medium.csv` · `anthropic-large.csv` | `anthropic-revenue.csv` |
| Gemini | `gemini-small.csv` · `gemini-medium.csv` · `gemini-large.csv` | `gemini-revenue.csv` |

- **small** ≈ 1 week, 3 projects, ~20 rows — quick smoke test.
- **medium** ≈ 30 days, 6 projects, ~180 rows — typical scan.
- **large** ≈ 30 days, every project, ~210–270 rows — full breadth.

## How to use

1. Upload any `*-<size>.csv` on **/scan**.
2. On the **AI Margin Leak** report, attach the matching `<provider>-revenue.csv`
   to turn cost concentration into true per-customer margins.

No `provider` column is included — it's inferred from the model name, exactly like
a real export. `cost` is computed from token counts at current list prices (with
realistic cache discounts), so it reads as provider-reported (`actual`).

## Provider column formats (authentic per provider, auto-mapped by `parse.ts`)

**OpenAI** — Usage/Costs export + completions-usage fields:
```
date,model,project,api_key_name,n_requests,input_tokens,cached_tokens,output_tokens,reasoning_tokens,total_cost,errors
2026-05-17,gpt-4o,prod-chat-api,prod-chat-api,6660,20856272,9385322,3919335,0,79.60,0
```
`cached_tokens` is OpenAI-style (already inside `input_tokens`) — recorded as a
cache-health diagnostic, **not** re-added to input. `reasoning_tokens` is set on
the o-series (o3/o1).

**Anthropic** — Console Usage/Cost export + messages-usage fields:
```
date,model,workspace,requests,uncached_input_tokens,cache_read_input_tokens,cache_creation_input_tokens,output_tokens,cost,errors
2026-05-17,claude-opus-4,assistant-api,3196,4082769,5346483,291626,2345172,250.62,0
```
`cache_read_input_tokens` + `cache_creation_input_tokens` are **folded into** total
input (matching Anthropic's billing breakdown); `cost` reflects the cache discount
(read ~0.1×, write ~1.25×).

**Gemini** — Cloud Billing / Generative Language API export:
```
usage_date,service,model,project_id,requests,input_tokens,output_tokens,thinking_tokens,cost,errors
2026-05-17,Generative Language API,gemini-2.5-pro,vision-api,4238,14101079,2909685,1745811,46.72,0
```
`thinking_tokens` (Gemini's reasoning) maps to the reasoning diagnostic; `service`
is an extra column the parser ignores.

> The `errors` column is gateway/proxy-enriched (LiteLLM, Helicone, Cloudflare AI
> Gateway, etc.) — native provider exports don't always include it. It powers the
> Agent Waste Detector's retry analysis.

## Revenue map format (for AI Margin Leak)

```
project,monthly_revenue,plan
prod-chat-api,18000,Enterprise
default,0,Free
```
The `project` key must match the usage `project`/`workspace`/`project_id` label to
join. `0`-revenue and low-revenue projects (e.g. `default`, `internal-eval`) create
the below-cost / thin-margin findings.

## What each file triggers

Models and shapes are chosen so the suite lights up:

- **Model & output waste** — premium dominant model with a cheaper sibling
  (`gpt-4o`, `claude-opus-4`, `gemini-2.5-pro`) + a legacy model (`gpt-4-turbo`,
  `claude-3-opus`) + verbose output projects.
- **Prompt cache readiness** — large repeated-prefix projects (>2,500 input
  tok/req) and oversized prompts (>4,000 tok/req).
- **Agent waste** — a high-error project (retry storms) and, on Anthropic, a
  high-volume/low-token fan-out project (`agent-runner`).
- **AI margin leak** — `default`/`internal-eval` (zero revenue) and thin-margin
  accounts vs the revenue map.
- **Diagnostics** — reasoning-token spend (o-series / gemini-2.5), cache health
  (Anthropic cache columns), and an untagged `default` bucket (unattributed spend).

Smoke-test note: `gemini-small` reads "healthy" on margin because a 7-day cost
window understates monthly revenue — use a `medium`/`large` file to demo margins.
