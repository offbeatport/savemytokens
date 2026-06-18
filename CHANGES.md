# Overnight build - multi-report upgrade

**Goal (from the plan):** make the "1 free scan + 5 paid reports @ $99 each" suite *real* - one scan computes all 5 reports, each with its own free preview and independent $99 unlock - plus cost reconciliation and accuracy work.

**Status: done & verified.** typecheck 0 errors · **26 unit tests pass** · `pnpm build` green · client bundle clean (no server code/secrets) · every report's paywall verified leak-free at runtime · screenshots in `/tmp/shot-mr-*.png`.

---

## What changed

### 1. The 5 reports are all live (was: 1 live + 4 "coming soon")
One scan now computes **all five** from the same usage metadata:
- **AI Cost Health** (unchanged output - byte-stable)
- **Model & Output Waste** - premium-model + verbose-output detectors
- **Prompt Cache Readiness** - caching + new prompt-bloat detector
- **AI Margin Leak** - cost attribution by project/customer; **optional revenue-map upload** computes true margins + flags below-cost accounts
- **Agent Waste Detector** - retry/error + new runaway-volume detector, **clearly metadata-limited** (confidence capped, disclaimer shown)

### 2. Architecture (see `SPEC-multireport.md` for the full contract)
- **Engine** refactored to a shared `ScanContext` → `analyzeAll()` fans out over a pure report **`registry.ts`** (`ReportDef` binds slug → detectors + free-insight picker + limits). `analyzeUsage` kept as a byte-stable `ai-cost-health` shim so nothing downstream broke.
- **Paywall enforced once**, identically for all 5 reports, in a generalized `buildSnapshot` - with a **single-finding guard** (never reveal the lone finding) and a **hard guard** (the rank-1 fix/evidence can never serialize into a snapshot).
- **Storage:** additive `scan` columns (`rows_json`, `reports_json`, `revenue_map_json`, `cost_basis`, `engine_version`) + a new `scan_unlock(scan_id, report_slug)` table for **independent per-report unlocks** (`'bundle'` = all). Legacy columns kept as the ai-cost-health mirror. Idempotent migration (`addColumn` + `CREATE TABLE IF NOT EXISTS`) - no manual step.

### 3. Cost reconciliation (accuracy)
- Each parsed row now carries `costSource: 'actual' | 'estimated'`. `reconcileCosts()` produces a scan-level `costBasis` (`actual`/`estimated`/`mixed`) shown as a badge on the hub/snapshot/report.
- When costs are estimated, finding confidence is capped at **medium** and a disclaimer is attached. Optional `invoiceTotal` anchoring scales estimated rows to a real total.

### 4. Screens
- `/s/$scanId` → **report hub** (5 preview cards).
- `/s/$scanId/r/$reportSlug` → per-report **free snapshot + paywall** (+ revenue-map upload on margin).
- `/s/$scanId/r/$reportSlug/report` → per-report **full report** (findings *or* margin-table renderer), gated on unlock, PDF via print.
- `/s/$scanId/report` → back-compat redirect.
- Landing reflects all 5 live reports + bundle pricing; admin shows per-report unlock counts + cost basis.

### 5. Payments
- `startCheckout`/`confirmCheckout` now take a `slug` (or `'bundle'`); per-report Polar product ids in `.env` (`POLAR_PRODUCT_ID_OUTPUT/_CACHE/_MARGIN/_AGENT`, `POLAR_PRODUCT_ID_BUNDLE`). Mock mode (no Polar) unlocks the exact target - demo path unchanged.

---

## Decisions I made (you were asleep)
- **No server-side "paste your admin key" connector.** Asking users to paste an org-wide OpenAI/Anthropic Admin key into a web app they're evaluating is a trust/security smell. The real-data path stays: **export CSV/JSON → upload**, or run the local `scripts/openai-usage.mjs` (key never leaves your machine). This is safer and already works. (Reversible - say the word and I'll add the server connector.)
- **Bundle price = $299** for all 5 (vs $495 à la carte) - a placeholder; tune freely in `catalog.ts`.
- **Margin report needs a revenue map** for true margins; without one it degrades gracefully to cost-concentration (low confidence, prominent "add a revenue map" upsell). Upload a `project,monthly_revenue,plan` CSV on the margin report's preview page.

## Deferred / needs your credentials (coded + guarded, works when keys added)
- Real OAuth, live Polar product ids, live OpenRouter, SMTP email delivery - all wired with mock/guards.
- **Agent Waste Detector** is metadata-only by design; true per-call loop detection needs request traces (an SDK), which your positioning rules out. It's shipped honest, not fake.

## How to verify
```bash
pnpm install && pnpm dev      # localhost:3000
pnpm test                      # 26 pass
pnpm build                     # green; pnpm start to run the prod server
```
Click **Run Free Scan → "Preview a sample report"**, land on the **hub**, open each report's preview, and unlock one (mock checkout) to see the full report. Margin report: upload a revenue CSV on its preview page.

## Adversarial review & hardening (after the build)
A 3-agent review swept the engine, server layer, and screens (24 findings). I fixed all
3 blocking/major + the cheap high-value minors:
- **[blocking] Polar webhook paywall bypass** - it unlocked on *any* `checkout.updated`
  (including `open`/`expired`/`failed`), so merely starting/abandoning a checkout granted
  the report. Now only unlocks on completed payment (`order.paid`, or `checkout.updated`
  with status `succeeded`/`confirmed`), and records the checkout id.
- **[major] Fail-open mock unlock** - `confirmCheckout` free-unlocked whenever a *per-slug*
  Polar product id was missing, even with a token set. Now mock-unlock happens only when
  Polar is *globally* absent (local/demo); a configured-but-incomplete prod returns
  `unlocked:false`. Slug is validated against a fixed enum in both checkout fns.
- **[major] Cost-reconciliation note** - `actualPct` could exceed 100% / go negative with an
  implausible invoice total. Now classified from raw sums, clamped 0–1, invoice honored only
  when ≥ actual, and `reconciledTotal` matches the displayed spend.
- Minors fixed: margin detector zero/negative-revenue handling; `mixed`-basis confidence cap;
  hub redundant query + `mixed` badge; backfill now persists `cost_basis`; removed the lone
  chart shadow (flat design); margin-table empty state; report `validateSearch`; HealthScore
  a11y label; registry hoisted-function guard comment; +2 reconciliation tests (now **28**).
- Deferred minors (documented, low impact): `toPublicSnapshot` projector, `sideEffects` flag,
  CTA-copy wording drift - client bundle already verified leak-free so these are insurance.

Re-verified after fixes: typecheck 0 · 28 tests · build green · client bundle clean · paywall
leak-free on hub/snapshot/locked-report at runtime · prod server serves every route (200).

Demo scans seeded in your local db for clicking around: `/s/demo_acme` (hub),
`/s/demo_acme_paid/r/ai-cost-health/report` (unlocked), `/s/demo_margin/r/ai-margin-leak/report`.

## Not touched
No git commit/push, no deploy, no external accounts, no keys. All local; mock data for tests.
