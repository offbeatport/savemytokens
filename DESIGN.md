# SaveMyTokens - Build Contract (read fully before writing any screen)

You are building ONE screen of a polished, one-time AI-cost-savings diagnostic.
The spine (design system, components, server functions, data engine) already
exists and is verified. **Do not modify shared files.** Only create the route
file(s) assigned to you. Compose the existing pieces - don't reinvent them.

## Product in one line
Connect/upload LLM usage → free Spend Snapshot → pay $99 → full AI Cost Health
Report. 1 free scan + **5 paid reports @ $99 each** (1 live, 4 coming-soon).

## Funnel
Landing → /scan (connect/upload, **upload-first**) → /s/$id/scanning → /s/$id
(free snapshot + paywall) → pay → /s/$id/report (full report).

---

## Visual language (NON-NEGOTIABLE)
- **Flat. No shadows, no raised cards, no filled panels.** Group with hairline
  borders (`<Panel>` = `rounded-xl border border-border`) and generous whitespace.
- Hierarchy comes from **type scale**, not color. Titles are **large + light**
  Space Grotesk (use real `<h1>/<h2>/<h3>` - sizes/weights are preset in CSS).
- Text is **near-monochrome ink**. Color = meaning only (savings green, amber
  watch, red risk). Don't decorate with color.
- One accent: **savings green** (`primary`). Use sparingly for CTAs + key numbers.
- All money/metrics use `tnum` class + the `format.ts` helpers. Never hand-format $.
- No emojis. No gradients except the subtle chart fill already defined.
- Whitespace is the product feeling "calm/fast", not "enterprise-heavy".

## Tokens → Tailwind utilities (already generated, just use them)
- Surfaces: `bg-background` (page), `bg-surface`, `bg-surface-sunken`
- Text: `text-foreground`, `text-muted`, `text-faint`
- Borders: `border-border`, `border-border-strong`
- Brand: `bg-primary` `text-primary` `text-primary-foreground` `bg-primary-soft` `text-primary-strong` `bg-primary-strong`
- Semantic: `good`/`watch`/`risk` each with `-soft` (bg) and `-ink` (text). e.g. `bg-risk-soft text-risk-ink`
- Charts: `bg-chart-1` … `bg-chart-6` (and `var(--color-chart-N)`)
- Fonts: `font-display` (Space Grotesk), default body is Inter.
- Radius: `rounded-lg` / `rounded-xl`. Eyebrow label: `className="eyebrow"`.

## Components (import + use; do not restyle from scratch)
From `@/components/ui/*`:
- `Button` - variants `primary|secondary|ghost|subtle|danger|link`, sizes `sm|md|lg|icon`. lucide icon as child renders inline.
- `Badge` - tone `neutral|good|watch|risk|primary`, `dot`, size `sm|md`.
- `Input`, `Label`, `Separator`, `Skeleton`
- `Progress` - `<Progress value={0-100} />`
- Tabs: `Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel` from `@/components/ui/tabs`. Pattern: `<Tabs defaultValue><TabsList><TabsIndicator/><TabsTab value="x">…</TabsTab></TabsList><TabsPanel value="x">…</TabsPanel></Tabs>`
- Accordion: `Accordion, AccordionItem, AccordionTrigger, AccordionPanel` from `@/components/ui/accordion`. `<Accordion><AccordionItem value="0"><AccordionTrigger>…</AccordionTrigger><AccordionPanel>…</AccordionPanel></AccordionItem></Accordion>`
- Dialog: `Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose` from `@/components/ui/dialog`.

From `@/components/*`:
- `Container` (size `narrow|default|wide`), `Logo`, `Header`/`Footer` (ALREADY in root - do NOT add them to screens), `TrustLine` (from Header.tsx)
- `Panel`, `Stat`, `SectionHeading` from `@/components/primitives`
- `HealthScore` - `<HealthScore score band label size />` (the signature gauge)
- `BandBadge`, `SeverityBadge`, `ConfidenceBadge` from `@/components/StatusBadges`
- Charts from `@/components/charts`: `SpendTrendChart`, `SpendByModelChart`, `TokenSplitBar`
- `Markdown` from `@/components/Markdown` (renders the founder memo)
- `NotifyButton` from `@/components/NotifyButton` - `<NotifyButton slug="..." />`

## Server functions (call as `fn({ data })` from client, or in route `loader`)
From `@/lib/server/scans`:
- `createScan({ data: { source, scenario } }) → { id }`
- `createScanFromUpload({ data: { csv, filename? } }) → { id, rowCount, warnings, fellBack }`
- `getScan({ data: { id } }) → { id, source, createdAt, unlocked, snapshot } | null`  ← **snapshot only**
- `getScanReport({ data: { id } }) → { unlocked, report, snapshot }`  ← report null unless unlocked
- `listScans()` (admin)
From `@/lib/server/payments`: `startCheckout({data:{scanId,email?}}) → {mode,url,price}`, `confirmCheckout({data:{scanId,checkoutId?}}) → {unlocked}`
From `@/lib/server/notify`: `subscribeNotify`, `listNotify` (admin)
From `@/lib/server/memo`: `getFounderMemo({data:{scanId}}) → {memo, fromLlm}`
From `@/lib/server/session`: `getSession() → SessionUser|null`
Auth client `@/lib/auth-client`: `signIn`, `signUp`, `signOut`, `useSession`.

## Data shapes - import types from `@/lib/analysis/types`
`Snapshot { spendAnalyzed, periodLabel, healthScore, band, bandLabel, estSavingsLow, estSavingsHigh, opportunityCount, visibleInsight{title,body}, lockedCount, lockedCategories[], topModel{model,pct}, outputCostPct }`
`Report { …snapshot fields…, healthy, estMonthlyImpactLow/High, executiveSummary, findings: Finding[], topLeaks, spendByModel[], spendByProject[], tokenSplit, spikes[], trend[], founderMemo, healthyReport? }`
`Finding { rank, title, category, categoryLabel, severity, confidence, estMonthlyLow/High, affectedProjects[], affectedModels[], evidence, fix, detail }`
Reports catalog `@/lib/reports/catalog`: `REPORTS`, `LIVE_REPORT`, `COMING_SOON_REPORTS`, `REPORT_PRICE` (99), `PAID_REPORT_COUNT` (5). Icons are lucide names - render via a small `icons` map you define from `lucide-react`.
Format helpers `@/lib/format`: `usd`, `usdCompact`, `usdRange`, `pct`, `num`, `tokens`, `dateShort`.
Analytics `@/lib/analytics`: `track(event, props)`.

## ⚠️ PAYWALL RULE (most important)
- The free snapshot page uses **only** `getScan` → `snapshot`. The snapshot object
  is already sanitized: it NEVER contains the #1 highest-value finding's fix or
  evidence. **Do not** call `getScanReport` on the snapshot page.
- Reveal exactly `snapshot.visibleInsight` (a middle-ground insight) + the broad
  `snapshot.lockedCategories` + counts. Keep everything else locked/blurred.
- The `/s/$id/report` page calls `getScanReport`; if `!unlocked`, **redirect to
  `/s/$id`** (never render the report).

## CTA copy rules
- Hero CTA everywhere: **"Run Free Scan"** → `/scan`.
- Trust line near CTAs: **"No prompts or responses required."** (use `<TrustLine/>`).
- Paywall CTA when savings found: **"Unlock exact fixes for $99."**
- Paywall CTA when healthy: **"Unlock full health report."**
- Coming-soon report CTA: **"Notify me"** (use `<NotifyButton/>`).

## TanStack Start routing conventions
```tsx
import { createFileRoute, useNavigate, Link, redirect } from '@tanstack/react-router'
export const Route = createFileRoute('/path')({
  loader: async () => await someServerFn({ data: {...} }),   // optional
  component: Page,
})
function Page() {
  const data = Route.useLoaderData()         // if loader used
  const { scanId } = Route.useParams()       // for $scanId routes
  const navigate = useNavigate()
  ...
}
```
- Server functions are imported and called directly (they become RPC on client).
- Use a `loader` for initial data (SSR-friendly); use `useState`/effects for interactions.
- Gate the report route in `beforeLoad`/`loader` with `redirect({ to: '/s/$scanId', params })` when locked.

## Quality bar
- Responsive (mobile → desktop). Real empty/loading/error states.
- Accessible: labelled inputs, buttons are buttons, `alt`/`aria` where needed, visible focus.
- Polished microcopy. Founder/manager tone - confident, concrete, never salesy-cheesy.
- This must look good enough to validate demand. Sweat the spacing and the numbers.
