# SaveMyTokens - Multi-Report Refactor Spec (build-ready)

One scan (one usage upload) computes ALL 5 reports from the same metadata. Each
report has its own free preview (never reveals its own #1 finding) and its own
independent $99 unlock. Cost is reconciled to actual $ when present; an optional
revenue map upgrades `ai-margin-leak`.

This spec is the single source of truth. It reconciles three proposals; the
"Decision" call-outs note where they disagreed and why one path won. Favoured
throughout: clean per-report computation, per-report independent unlock, one
generalized report screen, server-side paywall enforcement, smallest safe
migration from the current code.

The 5 reports (`ReportSlug`):
`ai-cost-health` (live today), `model-output-waste`, `prompt-cache-readiness`,
`ai-margin-leak`, `agent-waste-detector`.

---

## 0. Decisions that resolve the three proposals

| Topic | Decision | Loser / why |
|---|---|---|
| Unlock storage | **Dedicated `scan_unlock` join table** `(scan_id, report_slug)`, `report_slug='bundle'` = all. | Beats P3's `unlocks_json` column: append-only fact with its own `checkout_id`, no JSON read-modify-write race, no "mirror drift", and `CREATE TABLE IF NOT EXISTS` is *more* idempotent than `ALTER ADD COLUMN`. Migration delta is one statement - not bigger. |
| Reports storage | **`reports_json` blob** = `Record<ReportSlug,{snapshot,report}>`, computed once at scan time. | All three agree. |
| Persist inputs | **`rows_json`** = parsed `UsageRow[]` (metadata only). Load-bearing: enables revenue-map re-run + lazy backfill of the 4 new reports. | All three agree it is the single most important new column. |
| Row cost provenance | New `UsageRow.costSource: 'actual'\|'estimated'` (per-row). Aggregate summary is `costBasis` on `Reconciliation/Report/Snapshot`. | P2/P3 overloaded the name `costBasis` on the row; splitting the names removes ambiguity. |
| `detectLegacyModel` split | **Do NOT split.** `detectModelDowngrade` already emits `category:'legacy-model'` via `price.legacy`. | P1/P3 wanted a split - rejected because it would change `ai-cost-health`'s finding set and break byte-stability + `engine.test.ts`. |
| Single-finding paywall leak | **Adopt P3's guard:** if a report has ≤1 qualifying finding, reveal NO finding-level insight (generic teaser only). | P1/P2 missed that the median fallback resolves to the #1 finding when `length<=1` - a direct paywall violation for narrow reports (e.g. `prompt-cache-readiness`). |
| Per-report "healthy" threshold | `scope: 'meta'\|'focused'` on the report def. `meta` keeps today's `estHigh < total*0.05` clause; `focused` uses `findings.length===0` only. | Avoids focused reports falsely reading "healthy" because their findings are small vs *total* scan spend. |
| Routes | **`/s/$scanId/` hub** + **`/s/$scanId/r/$reportSlug/`** (snapshot) + **`/s/$scanId/r/$reportSlug/report`** (full). | The `r/` prefix removes any ambiguity with the literal `scanning`/`report` segments (P2/P3). Keeping snapshot and full as *separate* routes preserves today's clean "snapshot route never touches the full report" guarantee. |
| `analyzeUsage` | Kept as a thin shim returning the `ai-cost-health` `ScanResult`, so `engine.test.ts`, `memo.ts`, `getScan`/`getScanReport` stay green. | All three agree. |

---

## 1. Data model - exact schema + DDL

### 1.1 `scan` table - additive columns (KEEP everything existing)

Existing columns (unchanged, still written): `id, user_id, source, scenario,
spend_analyzed, health_score, snapshot_json, report_json, unlocked, checkout_id,
email, created_at`. `snapshot_json/report_json/unlocked` become the **legacy
`ai-cost-health` mirror** so current pages and shims keep working byte-for-byte.

ADD (all nullable except `engine_version`):

| Column | Type | Meaning |
|---|---|---|
| `rows_json` | `TEXT` | parsed `UsageRow[]` (metadata only). Enables re-run + backfill. |
| `reports_json` | `TEXT` | `Record<ReportSlug,{snapshot:Snapshot;report:Report}>`. Source of truth. |
| `revenue_map_json` | `TEXT` (null) | optional `RevenueMap` for `ai-margin-leak`. |
| `cost_basis` | `TEXT` (null) | `'actual'\|'estimated'\|'mixed'` - scan-level badge for hub/admin. |
| `engine_version` | `INTEGER NOT NULL DEFAULT 1` | bump to re-analyze/version reports. Current = `2`. |

### 1.2 New table `scan_unlock`

```sql
CREATE TABLE IF NOT EXISTS scan_unlock (
  id          TEXT PRIMARY KEY,
  scan_id     TEXT NOT NULL,
  report_slug TEXT NOT NULL,         -- a ReportSlug OR 'bundle'
  checkout_id TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_unlock ON scan_unlock(scan_id, report_slug);
CREATE INDEX IF NOT EXISTS idx_scan_unlock_checkout ON scan_unlock(checkout_id);
```

A report is unlocked iff a row exists for `(scan_id, slug)` OR `(scan_id, 'bundle')`.

### 1.3 Idempotent DDL - `src/lib/db/index.ts` `ensureSchema()`

SQLite has no `ADD COLUMN IF NOT EXISTS`. Add a PRAGMA-guarded helper and call it
after the existing `sqlite.exec(...)` block:

```ts
function addColumn(table: string, col: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === col)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
  }
}
// inside ensureSchema(), after the big exec:
addColumn('scan', 'rows_json', 'TEXT')
addColumn('scan', 'reports_json', 'TEXT')
addColumn('scan', 'revenue_map_json', 'TEXT')
addColumn('scan', 'cost_basis', 'TEXT')
addColumn('scan', 'engine_version', 'INTEGER NOT NULL DEFAULT 1')
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS scan_unlock (
    id TEXT PRIMARY KEY, scan_id TEXT NOT NULL, report_slug TEXT NOT NULL,
    checkout_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_unlock ON scan_unlock(scan_id, report_slug);
  CREATE INDEX IF NOT EXISTS idx_scan_unlock_checkout ON scan_unlock(checkout_id);
`)
```

### 1.4 Drizzle mirror - `src/lib/db/schema.ts`

Add to the `scan` table definition:

```ts
rowsJson: text('rows_json'),
reportsJson: text('reports_json'),
revenueMapJson: text('revenue_map_json'),
costBasis: text('cost_basis'),
engineVersion: integer('engine_version').notNull().default(1),
```

Add the new table + types:

```ts
export const scanUnlock = sqliteTable('scan_unlock', {
  id: text('id').primaryKey(),
  scanId: text('scan_id').notNull(),
  reportSlug: text('report_slug').notNull(),
  checkoutId: text('checkout_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})
export type ScanUnlockRow = typeof scanUnlock.$inferSelect
```

---

## 2. Types - `src/lib/analysis/types.ts` (all additive; nothing removed)

```ts
export type ReportSlug =
  | 'ai-cost-health' | 'model-output-waste' | 'prompt-cache-readiness'
  | 'ai-margin-leak' | 'agent-waste-detector'

export type ReportKind = 'findings' | 'margin'   // renderer family

// UsageRow: add per-row provenance (default 'estimated' is set in parse.ts)
export interface UsageRow {
  /* …existing fields… */
  costSource?: 'actual' | 'estimated'
}

export interface CostReconciliation {
  costBasis: 'actual' | 'estimated' | 'mixed'
  spendActual: number
  spendEstimated: number
  actualPct: number          // 0..1
  invoiceTotal?: number      // optional anchor if user supplies one
  reconciledTotal: number    // sum of row costs after backfill
  note: string
}

export interface RevenueEntry { key: string; monthlyRevenue: number; plan?: string }
export interface RevenueMap { keyBy: 'project'; entries: RevenueEntry[] }

// margin-leak table rows surfaced into the full report only
export interface MarginRow {
  key: string; plan?: string; cost: number; revenue?: number
  marginPct?: number; belowCost: boolean
}
export interface ReportExtras { marginRows?: MarginRow[]; coveragePct?: number }

// Snapshot: add slug + costBasis + metadata flag (all optional → back-compat)
export interface Snapshot {
  /* …existing fields… */
  slug?: ReportSlug
  costBasis?: CostReconciliation['costBasis']
  metadataLimited?: boolean
}

// Report: add slug/kind/reconciliation/extras + limitation notes (all optional)
export interface Report {
  /* …existing fields… */
  slug?: ReportSlug
  kind?: ReportKind
  reconciliation?: CostReconciliation
  extras?: ReportExtras
  metadataLimited?: boolean
  limitationNote?: string     // verbatim metadata-only disclaimer
  confidenceNote?: string     // e.g. "Costs are list-price estimates."
}
```

`ScanResult { snapshot: Snapshot; report: Report }` is unchanged. Existing
`Finding` is unchanged (its `confidence` may be clamped during assembly).

Add a new unused-category note: `'prompt-bloat'` already exists in
`FindingCategory` and is now used by `detectPromptBloat`.

---

## 3. Report registry - `src/lib/analysis/registry.ts` (new, pure, no DB)

The registry is the engine-side source of truth. `src/lib/reports/catalog.ts`
stays the marketing/pricing source of truth; the two join by `slug`.

```ts
import type { Confidence } from './types'
import type { ScanContext, Detector } from './engine'

export interface ReportDef {
  slug: ReportSlug
  kind: ReportKind
  scope: 'meta' | 'focused'
  detectors: Detector[]
  /** Free-preview picker. Receives ONLY non-#1 findings; cannot select #1.
   *  Return null to force the generic teaser (used for ≤1-finding reports). */
  pickFreeInsight?: (nonTop: Finding[], ctx: ScanContext) =>
    { title: string; body: string } | null
  confidenceCeiling?: Confidence          // clamps every finding's confidence
  metadataLimited?: boolean               // true → render limitationNote
  limitationNote?: string                 // verbatim disclaimer
  usesRevenueMap?: boolean
}

export const REGISTRY: Record<ReportSlug, ReportDef>
export const ALL_REPORT_DEFS: ReportDef[]   // Object.values(REGISTRY)
export function getReportDef(slug: string): ReportDef | undefined
```

### 3.1 Detector → report wiring (reuse current detectors verbatim)

| slug | kind | scope | detectors | notes |
|---|---|---|---|---|
| `ai-cost-health` | findings | meta | `detectModelDowngrade, detectOutputCaps, detectPromptCaching, detectRetryWaste, detectProjectLeak` | **identical to today**; dedupe by finding `id`. Default picker = today's output-caps-prefer logic. |
| `model-output-waste` | findings | focused | `detectModelDowngrade, detectOutputCaps` | picker prefers `output-caps` (never #1). |
| `prompt-cache-readiness` | findings | focused | `detectPromptCaching, detectPromptBloat` *(new)* | `detectPromptBloat` uses input-tokens/request, emits `category:'prompt-bloat'`. |
| `agent-waste-detector` | findings | focused | `detectRetryWaste, detectRunawayVolume` *(new)* | `metadataLimited:true`, `confidenceCeiling:'medium'`, `limitationNote` required. |
| `ai-margin-leak` | margin | focused | `detectProjectLeak, detectMarginLeak` *(new)* | `usesRevenueMap:true`. No map → cost-concentration only, `confidenceCeiling:'low'`, `limitationNote`. |

`limitationNote` strings:
- agent: `"Metadata-only: agent loops/duplicates are inferred from request and error density, not request traces. Connect traces for certainty."`
- margin (no map): `"No revenue map attached - this shows cost concentration only. Upload a project→revenue map to compute true margins."`

---

## 4. Engine - `src/lib/analysis/engine.ts`

Refactor by **extraction, not rewrite**. Move the 5 detector bodies to take a
single `ScanContext`; lift the assembly tail of today's `analyzeUsage` into a
parameterized `assembleReport`; lift `buildSnapshot` into a generalized,
per-report paywall chokepoint. Keep `rowSplit/totals/byModel/byProject/dailyTrend/
detectSpikes/scoreFor/bandFor/deterministicMemo/healthyDetail` as-is.

### 4.1 Shared context (computed ONCE per scan)

```ts
export interface ScanContext {
  rows: UsageRow[]
  periodLabel: string
  totals: Totals            // existing internal Totals
  models: SpendByModel[]
  projects: SpendByProject[]
  trend: TrendPoint[]
  spikes: Spike[]
  tokenSplit: TokenSplit
  reconciliation: CostReconciliation
  revenueMap?: RevenueMap
}

export interface AnalyzeOptions {
  periodLabel?: string
  revenueMap?: RevenueMap
  invoiceTotal?: number
}

export function buildContext(rows: UsageRow[], opts?: AnalyzeOptions): ScanContext
```

### 4.2 Detector interface (one signature for all)

```ts
export type Detector = (ctx: ScanContext) => Finding[]
```

Migration of existing detectors (read from `ctx`, identical logic):
- `detectModelDowngrade(ctx)` ← was `(rows, models)` → `ctx.rows, ctx.models`
- `detectOutputCaps(ctx)` ← was `(rows, t)` → `ctx.rows, ctx.totals`
- `detectPromptCaching(ctx)` ← was `(rows, t)`
- `detectRetryWaste(ctx)` ← was `(rows, t)`
- `detectProjectLeak(ctx)` ← was `(projects, rows)` → `ctx.projects, ctx.rows`

New detectors (metadata-only):
- `detectPromptBloat(ctx)`: per-project `inputTokens/requests`; flag projects with
  high input/req AND high request count where caching alone is insufficient
  (prompt trimming). `category:'prompt-bloat'`, `confidence:'medium'`.
- `detectRunawayVolume(ctx)`: per-project requests/day vs scan baseline; very high
  requests with low tokens/request (fan-out), correlated with `ctx.spikes` and
  error density. `category:'retry-waste'`. Confidence capped by registry ceiling.
- `detectMarginLeak(ctx)`: attribute `ctx.projects` cost; when `ctx.revenueMap`
  present, join by `project===entry.key`, compute `marginPct`, flag `belowCost`
  plans/customers; emit `Finding[]` + drive `ReportExtras.marginRows`. When absent,
  emit one cost-concentration finding + set `coveragePct=0`.

### 4.3 Reconciliation API

```ts
export function reconcileCosts(rows: UsageRow[], invoiceTotal?: number): CostReconciliation
```

Rules:
- `spendActual = Σ cost where costSource==='actual'`; `spendEstimated = Σ` rest.
- `costBasis = spendEstimated===0 ? 'actual' : spendActual===0 ? 'estimated' : 'mixed'`.
- `actualPct = reconciledTotal ? spendActual/reconciledTotal : 0`.
- `reconciledTotal = Σ row.cost` (estimated rows already backfilled from list price
  in `parse.ts`). If `invoiceTotal` given, allocate the `invoiceTotal − Σactual`
  delta across estimated rows by token weight (keeps row-level splits coherent);
  set `reconciledTotal = invoiceTotal`.
- `note`: human summary, e.g. `"82% of analyzed spend is provider-reported; 18% estimated from list prices."`.
- Allocation primitive stays `rowSplit(r)` (list-price ratio) for input/output;
  `byModel`/`byProject` continue to sum raw `r.cost`.

`costBasis` propagation: when `ctx.reconciliation.costBasis === 'estimated'`, every
finding's confidence is capped at `'medium'` and `Report.confidenceNote` is set.

### 4.4 Per-report assembly + generalized paywall

```ts
// generalization of today's analyzeUsage tail (lines ~403-458)
export function assembleReport(def: ReportDef, ctx: ScanContext): ScanResult

// generalization of today's buildSnapshot (lines ~467-530) - the SOLE paywall point
function buildSnapshot(report: Report, def: ReportDef, ctx: ScanContext): Snapshot
```

`assembleReport`:
1. `findings = def.detectors.flatMap(d => d(ctx))`; for `scope:'meta'` dedupe by `id`.
2. `.filter(f => f.estMonthlyHigh >= 25)` (today's threshold).
3. clamp each finding's confidence: `min(def.confidenceCeiling, costBasisCap)`.
4. sort by midpoint desc; assign `rank = i+1`.
5. `healthScore = scoreFor(...)`, `band = bandFor(...)`.
6. `healthy = findings.length===0 || (def.scope==='meta' && estHigh < ctx.totals.cost*0.05)`.
7. build `tokenSplit/executiveSummary/founderMemo`, attach `healthyReport` (healthy),
   `extras` + `coveragePct` (margin), `metadataLimited`, `limitationNote`,
   `confidenceNote`, `slug`, `kind`, `reconciliation`, `costBasis`.
8. `snapshot = buildSnapshot(report, def, ctx)`.

### 4.5 Top-level entry points

```ts
export function analyzeAll(rows: UsageRow[], opts?: AnalyzeOptions): {
  reconciliation: CostReconciliation
  reports: Record<ReportSlug, ScanResult>
} {
  const ctx = buildContext(rows, opts)
  const reports = {} as Record<ReportSlug, ScanResult>
  for (const def of ALL_REPORT_DEFS) reports[def.slug] = assembleReport(def, ctx)
  return { reconciliation: ctx.reconciliation, reports }
}

// BACK-COMPAT shim - unchanged external behavior; keeps engine.test.ts green:
export function analyzeUsage(rows: UsageRow[], opts: AnalyzeOptions = {}): ScanResult {
  return analyzeAll(rows, opts).reports['ai-cost-health']
}
```

---

## 5. Per-report paywall rule (server-side, enforced once)

The "never reveal the #1 highest-value finding for free" rule is enforced ONCE in
`buildSnapshot`, applied identically to all 5 reports. Report authors cannot opt
out. Guarantees:

1. **Rank independently per report.** Each report ranks its OWN findings; rank 1 =
   its own highest-midpoint finding.
2. **Picker can't see #1.** The candidate pool passed to `def.pickFreeInsight` is
   `findings.filter(f => f.rank !== 1)`. The picker physically cannot return #1.
3. **Single-finding guard (P3 fix).** If `findings.length <= 1`, reveal NO
   finding-level insight - `visibleInsight` becomes a generic teaser
   (`"1 opportunity found - unlock to see it."`) and `lockedCount = findings.length`.
   Prevents the median-fallback from resolving to #1 on narrow reports.
4. **Hard guard.** After the picker returns, assert `chosen.id !== rank1.id` and
   that `JSON.stringify(snapshot)` contains neither `top.fix` nor `top.evidence`;
   on failure fall back to the median non-#1 finding (today's behavior).
5. **Locked categories** = `uniq(findings.filter(f => f.id !== chosen.id).map(f => f.categoryLabel))`
   - counts/labels only, the (vague) top category included.
6. **Transport separation.** `getReportHub`/`getReportSnapshot` read ONLY the
   `snapshot` half of each bundle entry. The full `report` (with
   `findings[*].fix/evidence/detail`) is returned ONLY by `getFullReport`, and only
   when `isUnlocked(id, slug)`. Add a `toPublicSnapshot()` projector so a dev can't
   accidentally spread the report half.
7. **Healthy reports** keep today's "confirmation, not a fix list" framing per
   report.

---

## 6. Unlock model

- Source of truth: rows in `scan_unlock`. `isUnlocked(scanId, slug)` ⇔ a
  `(scanId, slug)` row OR a `(scanId, 'bundle')` row exists.
- Per report: `$99` (`REPORT_PRICE`, unchanged), own Polar product
  `POLAR_PRODUCT_ID[slug]`. Bundle: `BUNDLE_PRICE` (e.g. `$299`) via
  `POLAR_PRODUCT_ID_BUNDLE`, inserts one `(scanId,'bundle')` row.
- Decoupled from generation: all 5 reports are computed and stored at scan time
  regardless of payment. Unlock only flips visibility - no recompute, buying report
  #3 never touches #1.
- Mock mode (no Polar / missing product id) unlocks exactly the requested target,
  preserving today's frictionless demo path. Gate per slug on `isPolarConfigured(slug)`.
- Legacy `scan.unlocked` boolean kept in sync ONLY for `ai-cost-health`.

---

## 7. Route map - `src/routes/s/$scanId/`

| File | Role | Loader | Lock behavior |
|---|---|---|---|
| `index.tsx` | **Report hub** (repurpose today's snapshot page) | `getReportHub({id})` | n/a - snapshots only |
| `r/$reportSlug/index.tsx` | per-report **free snapshot + paywall** (generalized today's `index.tsx` body) | `getReportSnapshot({id,slug})` | 404→hub if slug unknown |
| `r/$reportSlug/report.tsx` | per-report **full report** (generalized today's `report.tsx`) | `getFullReport({id,slug})` | `!unlocked` → `redirect({to:'/s/$scanId/r/$reportSlug', params})` |
| `report.tsx` | **back-compat redirect** → `/s/$scanId/r/ai-cost-health/report` (preserve `?checkout=`) | - | - |
| `scanning.tsx` | unchanged; already navigates to `/s/$scanId` (now the hub) | - | - |

- The `r/` static prefix removes ambiguity with the `scanning`/`report` literal
  segments; `scanning` stays a static sibling (static wins in TanStack).
- Hub cards are driven by `getReportHub` joined with `catalog.REPORTS` (name,
  tagline, icon, bullets). Each card shows: that report's `snapshot.visibleInsight`
  teaser, `lockedCount`, `costBasis` badge, and "Unlock $99" / "View report".
  Add an "Add revenue map" affordance on the `ai-margin-leak` card.
- The full-report renderer is generalized: `kind:'findings'` → existing
  `HealthyReport`/`SavingsReport` (chosen by `report.healthy`); `kind:'margin'` →
  `SpendBreakdown` + a margin table from `report.extras.marginRows`. Per-report
  eyebrow/title/includes come from `catalog` by slug → a 6th report is data-only.
- `successUrl` for checkout → `/s/${scanId}/r/${slug}/report?checkout={CHECKOUT_ID}`
  (bundle → `/s/${scanId}` hub). `report.tsx` loader confirms `?checkout` then
  re-reads, exactly like today.
- Regenerate `src/routeTree.gen.ts` from the new files.

---

## 8. Server functions

### 8.1 `src/lib/server/scans.ts`

```ts
// CREATE - signatures unchanged externally
createScan({ source, scenario }) → { id }
createScanFromUpload({ csv, filename?, revenueMapCsv? }) → UploadResult   // + optional map

// internal
persistBundle(bundle, meta) : writes rows_json, reports_json, cost_basis,
  engine_version, spend_analyzed + health_score (from ai-cost-health), and
  (legacy mirror) snapshot_json/report_json = reports['ai-cost-health'].

// READ - snapshot-only is the default; full report gated per slug
getReportHub({ id }) → {
  id; source; createdAt; costBasis; reconciliation;
  reports: Array<{ slug; status; name; tagline; icon;
                   snapshot: Snapshot; unlocked: boolean; price: number }>
} | null                                   // NEVER returns any full `report`

getReportSnapshot({ id, slug }) → { slug; snapshot: Snapshot; unlocked } | null
getFullReport({ id, slug }) → { unlocked; report: Report | null; snapshot: Snapshot }

// revenue map after the fact (re-runs ai-margin-leak from rows_json)
attachRevenueMap({ scanId, csv }) → { ok; matched: number; unmatched: number; coveragePct: number; warnings: string[] }

// BACK-COMPAT shims (DESIGN.md contract) - delegate to slug 'ai-cost-health'
getScan({ id }) → ScanPublic | null        // reshape getReportSnapshot
getScanReport({ id }) → { unlocked; report; snapshot }  // reshape getFullReport

// admin
listScans() → […, unlockedCount per scan]  // join scan_unlock
```

- `unlockedSlugs(id) → Set<string>` and `isUnlocked(id, slug)` are server helpers
  reading `scan_unlock` (treats `'bundle'` as all). `getFullReport` and the
  `report.tsx` loader are the only gates; the client never decides unlock state.
- **Lazy backfill:** if `reports_json` is null but `rows_json` exists, re-run
  `analyzeAll`, persist, then serve. If both are null (pre-migration row), the hub
  shows a 1-card view (`ai-cost-health` from legacy `report_json`) and seeds a
  `scan_unlock` row from `scan.unlocked`; the other 4 cards show a
  "Re-scan to unlock new reports" empty state.
- `attachRevenueMap` rewrites only `reports_json['ai-margin-leak']` (+ `cost_basis`
  if unchanged) and `revenue_map_json`; unlock state in `scan_unlock` is untouched,
  so an unlocked margin report never relocks, and the paywall snapshot is rebuilt.

### 8.2 `src/lib/server/payments.ts`

```ts
startCheckout({ scanId, slug?: ReportSlug | 'bundle', email? }) → { mode; url; price }
confirmCheckout({ scanId, slug?: ReportSlug | 'bundle', checkoutId? }) → { unlocked }
```

- `slug` defaults to `'ai-cost-health'` (back-compat with current callers).
- Polar: pick `POLAR_PRODUCT_ID[slug]` or `POLAR_PRODUCT_ID_BUNDLE`;
  `metadata = { scanId, slug }`; `successUrl` per §7.
- Fail-soft to mock when `!isPolarConfigured(slug)`; mock `confirmCheckout` calls
  `unlockReport(scanId, slug)` directly.

### 8.3 `src/lib/server/store.ts`

```ts
export async function unlockReport(scanId: string, target: string, checkoutId?: string): Promise<void>
// INSERT OR IGNORE into scan_unlock (id genId('u_')). target==='bundle' inserts one
// 'bundle' row. If target==='ai-cost-health' (or 'bundle'), also set legacy scan.unlocked=1.

export function isUnlocked(scanId: string, slug: string): boolean
export function unlockedSlugs(scanId: string): Set<string>

// kept, delegates → unlockReport(scanId, 'ai-cost-health', checkoutId)
export async function markUnlocked(scanId: string, checkoutId?: string): Promise<void>
```

### 8.4 `src/lib/server/polar-webhook.ts`

Read `event.data.metadata.slug` (default `'ai-cost-health'`) and call
`unlockReport(scanId, slug)` on `order.paid` / `checkout.updated`.

### 8.5 `src/lib/env.ts`

```ts
POLAR_PRODUCT_ID: {                       // per-slug map
  'ai-cost-health': str('POLAR_PRODUCT_ID_HEALTH'),       // existing var reused
  'model-output-waste': str('POLAR_PRODUCT_ID_OUTPUT'),
  'prompt-cache-readiness': str('POLAR_PRODUCT_ID_CACHE'),
  'ai-margin-leak': str('POLAR_PRODUCT_ID_MARGIN'),
  'agent-waste-detector': str('POLAR_PRODUCT_ID_AGENT'),
},
POLAR_PRODUCT_ID_BUNDLE: str('POLAR_PRODUCT_ID_BUNDLE'),
// isPolarConfigured(slug?: ReportSlug | 'bundle'): boolean  → token + that product id
```

---

## 9. Catalog + parse changes

- `src/lib/reports/catalog.ts`: flip the 4 `status:'coming-soon'` → `'live'`; add
  `BUNDLE_PRICE = 299`; add per-report `includes: string[]` (move the hardcoded
  `REPORT_INCLUDES` from today's `index.tsx`) and optional `metadataLimitNote`.
  `LIVE_REPORT`/`COMING_SOON_REPORTS` remain exported (now `COMING_SOON_REPORTS`
  is empty; landing page §`src/routes/index.tsx` keeps compiling - switch its
  "Notify me" grid to link into a scan, or guard on length).
- `src/lib/analysis/parse.ts`: set `costSource` per row. In BOTH `parseUsageCsv`
  (line ~118-122) and `rowFromObject` (line ~165-174): `costSource = 'actual'` when
  a cost value was present and `>0`, else `'estimated'` (the list-price backfill
  branch). Add `export function parseRevenueMap(csv: string): { map: RevenueMap; warnings: string[] }`
  (columns: `project|key`, `monthly_revenue|revenue|mrr`, `plan?`). `mock.ts` rows
  default to `costSource:'actual'`.

---

## 10. Tests

- Generalize `src/lib/analysis/engine.test.ts`: loop ALL `ALL_REPORT_DEFS` and, per
  report with ≥2 findings, assert `JSON.stringify(snapshot)` excludes
  `findings[0].fix` and `findings[0].evidence`, `visibleInsight.title !== findings[0].title`,
  and `lockedCount === findings.length - 1`. For ≤1-finding reports assert NO
  finding-level reveal (single-finding guard).
- Keep the existing `analyzeUsage(mockUsage('acme'/'healthy'/'scaleup'))` assertions
  green (byte-stable `ai-cost-health`).
- Add reconciliation tests: all-actual → `'actual'`, none-actual → `'estimated'`,
  mixed → `'mixed'`; estimated-only caps finding confidence at `'medium'`.
- Add margin-leak tests: with revenue map (marginRows + belowCost flagged) vs
  without (cost-concentration only, `coveragePct=0`, `confidenceCeiling:'low'`).
- Add a server test: `getReportHub` payload contains no `report` field and none of
  any report's top `fix` strings.

---

## 11. Ordered migration checklist (each step compiles + ships)

1. **types.ts** - add `ReportSlug`, `ReportKind`, `costSource` on `UsageRow`,
   `CostReconciliation`, `RevenueMap`/`RevenueEntry`, `MarginRow`/`ReportExtras`,
   additive optional fields on `Snapshot`/`Report`. Nothing removed → all compiles.
2. **parse.ts** - set `costSource`; add `parseRevenueMap`. No behavior change.
3. **engine.ts** - extract `buildContext`, `assembleReport`; generalize
   `buildSnapshot(report,def,ctx)` (+ single-finding guard + hard guard); add
   `reconcileCosts`; adapt 5 detectors to `Detector`; add `detectPromptBloat`,
   `detectRunawayVolume`, `detectMarginLeak`; add `analyzeAll`; redefine
   `analyzeUsage` as the `ai-cost-health` shim. (Only breaking internal change is
   detector signatures - all callers are in this file + the new registry.)
4. **registry.ts** (new) - 5 `ReportDef`s. **catalog.ts** - flip 4 → `live`, add
   `BUNDLE_PRICE`, `includes`, `metadataLimitNote`.
5. **schema.ts + db/index.ts** - add 5 `scan` columns via `addColumn`, create
   `scan_unlock` + indexes; mirror in drizzle. Keep all old columns.
6. **store.ts** - add `unlockReport`/`isUnlocked`/`unlockedSlugs`; `markUnlocked`
   delegates.
7. **scans.ts** - switch persist to `analyzeAll` + `persistBundle` (write new
   columns + legacy mirror); add `getReportHub`/`getReportSnapshot`/`getFullReport`/
   `attachRevenueMap`; keep `getScan`/`getScanReport` shims; lazy backfill.
   `memo.ts` is unchanged (still reads legacy `report_json`).
8. **payments.ts + polar-webhook.ts + env.ts** - thread `slug`/`bundle`; per-slug
   product map + bundle; webhook reads `metadata.slug`.
9. **routes** - repurpose `s/$scanId/index.tsx` as hub; add
   `r/$reportSlug/index.tsx` + `r/$reportSlug/report.tsx` (generalized current
   index/report, parameterized by slug, with `kind`-switched renderer); convert
   `s/$scanId/report.tsx` to a redirect; `scanning.tsx` unchanged. Regenerate
   `routeTree.gen.ts`. Update `src/routes/index.tsx` (landing) + `Footer.tsx` for
   the now-live 4 reports.
10. **tests** - generalize paywall loop; add reconciliation + margin-leak + hub
    transport tests.

Ship order: 1-2 (no behavior change) → 3-4 → 5-6 → 7-8 → 9-10. The single-report
funnel keeps working until the routes flip in step 9.

---

## 12. Risk register (carried from proposals, with mitigations)

- **Pre-migration scans can't backfill 4 new reports** (no `rows_json`). Mitigation:
  hub 1-card fallback + "re-scan" empty state; seed `scan_unlock` from legacy boolean.
- **SQLite `ADD COLUMN` not idempotent** → PRAGMA-guarded `addColumn`; `scan_unlock`
  via `CREATE TABLE IF NOT EXISTS`.
- **Paywall leak surface ×5** → single `buildSnapshot` chokepoint + transport split
  + loop-all-reports test + hub-payload test. The single-finding guard is mandatory.
- **Agent-waste is metadata-limited** → `confidenceCeiling:'medium'`, mandatory
  `limitationNote`, enforced in `assembleReport` (not the detector).
- **Margin-leak near-empty without a map** → graceful degraded mode (cost
  concentration, `confidenceCeiling:'low'`), prominent "Add revenue map" upsell;
  explicit "no rows matched" state when join keys don't line up.
- **costSource mislabeling** corrupts every dollar's trust → capture provenance at
  parse time (cost column present & >0); mock rows `'actual'`; estimated-derived
  findings carry capped confidence + `confidenceNote`.
- **Cross-report double-counting** (same waste in `ai-cost-health` + `model-output-waste`)
  → acceptable (independent purchases); `ai-cost-health` dedupes by finding id;
  marketing copy must not sum savings across reports.
- **Revenue-map re-run after purchase** must not relock/leak → unlock lives in
  `scan_unlock` (untouched by re-run); paywall snapshot rebuilt on rewrite.
- **Per-report ranking vs umbrella ranking** differ → keep `ai-cost-health` as the
  canonical global gauge; label per-report scores as scoped.
- **Polar multi-product** → per-slug + bundle product ids; `isPolarConfigured(slug)`
  gates each; missing id falls to mock-unlock (fine for demo, assert `metadata.slug`
  end-to-end before prod).
- **Storage at rest** - `rows_json` is new usage metadata (no prompts/responses);
  document retention / consider TTL purge.
```
