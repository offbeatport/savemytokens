import * as React from 'react'
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, ChevronDown, Lock, TrendingDown, AlertTriangle, Download } from 'lucide-react'
import { Container } from '@/components/Container'
import { Panel, Stat } from '@/components/primitives'
import { HealthScore } from '@/components/HealthScore'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { SpendByModelChart, TokenSplitBar, SpendTrendChart } from '@/components/charts'
import { Markdown } from '@/components/Markdown'
import { getMargin, compareMargin } from '@/lib/server/margin'
import type { Band } from '@/lib/analysis/types'
import type { EntityKind, Evidence, MarginBand, MarginLeak, MarginLedgerRow, MarginStatus, Recommendation } from '@/lib/margin'
import { usd, pct, num, tokens as fmtTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/m/$marginId')({
  loader: async ({ params }) => {
    const r = await getMargin({ data: { id: params.marginId } })
    if (!r) throw redirect({ to: '/margin' })
    const crossover = await compareMargin({ data: { id: params.marginId } }).catch(() => null)
    return { ...r, crossover }
  },
  component: MarginReport,
})

const BAND: Record<MarginBand, Band> = { strong: 'healthy', healthy: 'healthy', watch: 'watch', leaking: 'leaking' }
const STATUS: Record<MarginStatus, { tone: 'good' | 'watch' | 'risk' | 'neutral'; label: string }> = {
  'below-cost': { tone: 'risk', label: 'Below cost' },
  thin: { tone: 'watch', label: 'Thin' },
  healthy: { tone: 'good', label: 'Healthy' },
  strong: { tone: 'good', label: 'Strong' },
  unknown: { tone: 'neutral', label: 'No revenue' },
}
const DIM_LABEL: Record<EntityKind, string> = {
  customer: 'Customer', plan: 'Plan', feature: 'Feature', workspace: 'Workspace', project: 'Project', model: 'Model',
}

type TabId = 'overview' | 'margins' | 'actions' | 'risk' | 'cost' | 'cfo'

function StatusBadge({ status }: { status: MarginStatus }) {
  const s = STATUS[status]
  return <Badge tone={s.tone} dot size="sm">{s.label}</Badge>
}

function LedgerTable({ rows, hasRevenue }: { rows: MarginLedgerRow[]; hasRevenue: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-faint">
            <th className="px-4 py-3">Entity</th>
            {hasRevenue && <th className="px-4 py-3 text-right">Revenue</th>}
            <th className="px-4 py-3 text-right">AI cost</th>
            {hasRevenue && <th className="px-4 py-3 text-right">Margin</th>}
            {hasRevenue && <th className="px-4 py-3 text-right">Margin %</th>}
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((r) => (
            <tr key={`${r.entity.kind}:${r.entity.id}`} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-3">
                <span className="font-medium text-foreground">{r.entity.label}</span>
                {r.allocated && <span className="ml-2 text-[0.65rem] uppercase tracking-wider text-faint">allocated</span>}
              </td>
              {hasRevenue && <td className="px-4 py-3 text-right tnum text-muted">{r.revenue ? usd(r.revenue) : '—'}</td>}
              <td className="px-4 py-3 text-right tnum text-foreground">{usd(r.cost)}</td>
              {hasRevenue && <td className={cn('px-4 py-3 text-right tnum', r.margin < 0 ? 'text-risk-ink' : 'text-foreground')}>{r.revenue ? usd(r.margin) : '—'}</td>}
              {hasRevenue && <td className="px-4 py-3 text-right tnum text-muted">{r.marginPct === null ? '—' : pct(r.marginPct)}</td>}
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null
  return (
    <details className="group mt-3 border-t border-border pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        {evidence.length} cost {evidence.length === 1 ? 'driver' : 'drivers'} (evidence)
      </summary>
      <ul className="mt-3 grid gap-2.5">
        {evidence.map((e, i) => (
          <li key={i} className="rounded-lg bg-surface-sunken/50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">{e.title}</span>
              <span className="flex items-center gap-2">
                <Badge tone={e.confidenceTier === 'confirmed' ? 'good' : 'watch'} size="sm">{e.confidenceTier === 'confirmed' ? 'Confirmed' : 'Suspected'}</Badge>
                <span className="tnum shrink-0 text-sm text-muted">{usd(e.estMonthlyLow)}–{usd(e.estMonthlyHigh)}/mo</span>
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{e.detail}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

function LeakCard({ leak }: { leak: MarginLeak }) {
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <StatusBadge status={leak.status} />
            <span className="font-medium text-foreground">{leak.entity.label}</span>
            <span className="text-xs uppercase tracking-wider text-faint">{leak.entity.kind}</span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{leak.summary}</p>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wider text-faint">Impact</div>
          <div className="tnum font-display text-2xl font-light text-primary-strong">{usd(leak.monthlyImpact)}/mo</div>
        </div>
      </div>
      <EvidenceList evidence={leak.evidence} />
    </Panel>
  )
}

function RecCard({ rec, rank }: { rec: Recommendation; rank: number }) {
  return (
    <Panel className="flex flex-wrap items-start justify-between gap-4 p-5">
      <div className="flex min-w-0 gap-4">
        <span className="tnum grid size-7 shrink-0 place-items-center rounded-full bg-surface-sunken text-sm font-semibold text-muted">{rank}</span>
        <div className="min-w-0">
          <div className="font-medium text-foreground">{rec.title}</div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{rec.rationale}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="neutral" size="sm">{rec.difficulty === 'low' ? 'Easy' : rec.difficulty === 'medium' ? 'Medium' : 'Hard'}</Badge>
            <Badge tone={rec.confidence >= 0.8 ? 'good' : 'watch'} size="sm">{Math.round(rec.confidence * 100)}% confidence</Badge>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-medium uppercase tracking-wider text-faint">Impact</div>
        <div className="tnum font-display text-xl font-light text-primary-strong">+{usd(rec.monthlyImpact)}/mo</div>
      </div>
    </Panel>
  )
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'margins', label: 'Margins' },
  { id: 'actions', label: 'Actions' },
  { id: 'risk', label: 'Risk' },
  { id: 'cost', label: 'Cost breakdown' },
  { id: 'cfo', label: 'CFO Report' },
]

function MarginReport() {
  const { result, crossover } = Route.useLoaderData()
  const { ledger, health, leaks, risks, recommendations, cfo, mode, attribution, costReport } = result
  const hasRevenue = ledger.coverage.hasRevenue

  const [tab, setTab] = React.useState<TabId>('overview')
  const dims = (Object.keys(ledger.byDimension) as EntityKind[]).filter((k) => ledger.byDimension[k].length > 0)
  const [dim, setDim] = React.useState<EntityKind>(hasRevenue && dims.includes('customer') ? 'customer' : dims[0] ?? 'project')

  const handlePrint = () => { if (typeof window !== 'undefined') window.print() }

  return (
    <Container size="wide" className="py-10 sm:py-14">
      <Link to="/margin" className="no-print inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> New analysis
      </Link>

      {mode === 'cost' && (
        <Panel className="no-print mt-6 flex flex-wrap items-center justify-between gap-4 border-primary/40 bg-primary-soft/30 px-5 py-4">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <div className="font-medium text-primary-strong">You're seeing Cost Intelligence</div>
              <p className="text-sm text-muted">Add revenue (Stripe or CSV) to unlock per-customer margin — who's below cost and what to do.</p>
            </div>
          </div>
          <Link to="/margin" className={cn(buttonVariants({ size: 'sm' }))}>Connect revenue <ArrowRight /></Link>
        </Panel>
      )}

      {/* Persistent header */}
      <header className="mt-8 grid items-center gap-10 sm:grid-cols-[auto_1fr]">
        <HealthScore score={health.score} band={BAND[health.band]} label={health.bandLabel} />
        <div>
          <div className="eyebrow mb-3">AI Margin Report · {ledger.periodLabel}</div>
          {hasRevenue ? (
            <h1 className="max-w-2xl">
              {usd(ledger.totals.margin)} margin · {pct(ledger.totals.marginPct ?? 0)}
              {health.belowCostCount > 0 && <> · <span className="text-risk-ink">{health.belowCostCount} below cost</span></>}
            </h1>
          ) : (
            <h1 className="max-w-2xl">{usd(ledger.totals.cost)} of AI cost analyzed</h1>
          )}
          <p className="mt-4 max-w-2xl leading-relaxed text-muted">{health.summary}</p>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
            {hasRevenue && <Stat label="Revenue" value={usd(ledger.totals.revenue)} />}
            <Stat label="AI cost" value={usd(ledger.totals.cost)} />
            {hasRevenue && <Stat label="Revenue at risk" value={usd(health.revenueAtRisk)} valueClassName={health.revenueAtRisk > 0 ? 'text-risk-ink' : undefined} />}
            <Stat label="Est. monthly upside" value={usd(cfo.estimatedBusinessImpact)} valueClassName="text-primary-strong" />
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="no-print mt-10 flex flex-wrap gap-1.5 border-b border-border pb-px">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {/* ── Overview ── */}
        {tab === 'overview' && (
          <div className="grid gap-10">
            {attribution && attribution.method !== 'none' && (
              <Panel className="p-5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge tone={attribution.attributedPct >= 80 ? 'good' : 'watch'} dot>{attribution.attributedPct}% of cost attributed to customers</Badge>
                  <span className="text-sm text-muted">
                    {attribution.method === 'pre-tagged' ? 'Usage was already tagged by customer.' : `We matched ${attribution.matched.length} usage ${attribution.matched.length === 1 ? 'key' : 'keys'} to your customers automatically — no manual tagging.`}
                  </span>
                </div>
                {attribution.suggestions.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="eyebrow mb-2">Suggested matches — confirm to attribute more</div>
                    <ul className="grid gap-1.5 text-sm">
                      {attribution.suggestions.slice(0, 5).map((s) => (
                        <li key={s.key} className="text-muted"><span className="font-medium text-foreground">{s.key}</span> → {s.customerLabel} <span className="text-faint">({Math.round(s.score * 100)}% · {usd(s.cost)})</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {attribution.unmatched.length > 0 && (
                  <p className="mt-2 text-xs text-faint">{attribution.unmatched.length} unmapped {attribution.unmatched.length === 1 ? 'key' : 'keys'} ({usd(attribution.unmatched.reduce((a, x) => a + x.cost, 0))}) — add a customer column or a key→customer mapping to attribute them.</p>
                )}
              </Panel>
            )}
            {leaks.length > 0 && (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2.5"><TrendingDown className="size-5 text-risk-ink" aria-hidden /> Top {hasRevenue ? 'margin leaks' : 'cost drivers'}</h2>
                  <button type="button" onClick={() => setTab('margins')} className="text-sm text-primary hover:underline">See all →</button>
                </div>
                <div className="grid gap-3">{leaks.slice(0, 3).map((l) => <LeakCard key={l.id} leak={l} />)}</div>
              </section>
            )}
            {recommendations.length > 0 && (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2>Top actions</h2>
                  <button type="button" onClick={() => setTab('actions')} className="text-sm text-primary hover:underline">See all →</button>
                </div>
                <div className="grid gap-3">{recommendations.slice(0, 3).map((r, i) => <RecCard key={r.id} rec={r} rank={i + 1} />)}</div>
              </section>
            )}
          </div>
        )}

        {/* ── Margins (ledger + leaks) ── */}
        {tab === 'margins' && (
          <div className="grid gap-12">
            <section>
              <h2 className="mb-4">Margin Ledger</h2>
              <div className="mb-4 flex flex-wrap gap-2">
                {dims.map((k) => (
                  <button key={k} type="button" onClick={() => setDim(k)} className={cn('rounded-lg border px-3 py-1.5 text-sm transition-colors', dim === k ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border text-muted hover:border-border-strong')}>{DIM_LABEL[k]}</button>
                ))}
              </div>
              <Panel className="overflow-hidden"><LedgerTable rows={ledger.byDimension[dim]} hasRevenue={hasRevenue} /></Panel>
              {ledger.byDimension[dim].some((r) => r.allocated) && <p className="mt-2 text-xs text-faint">"Allocated" = revenue split by cost share (modeled). Per-customer margin is a direct join (exact).</p>}
            </section>
            {leaks.length > 0 && (
              <section>
                <h2 className="mb-4 flex items-center gap-2.5"><TrendingDown className="size-5 text-risk-ink" aria-hidden /> {hasRevenue ? 'All margin leaks' : 'All cost drivers'}</h2>
                <div className="grid gap-3">{leaks.map((l) => <LeakCard key={l.id} leak={l} />)}</div>
              </section>
            )}
          </div>
        )}

        {/* ── Actions ── */}
        {tab === 'actions' && (
          <section>
            <h2 className="mb-2">Recommended actions</h2>
            <p className="mb-4 max-w-2xl text-sm text-muted">Ranked by monthly business impact × confidence × ease. Every action is tied to a specific entity.</p>
            {recommendations.length ? (
              <div className="grid gap-3">{recommendations.map((r, i) => <RecCard key={r.id} rec={r} rank={i + 1} />)}</div>
            ) : (
              <Panel className="p-6 text-sm text-muted">No actions above the impact threshold — margins look clean for this period.</Panel>
            )}
          </section>
        )}

        {/* ── Risk ── */}
        {tab === 'risk' && (
          <section>
            <h2 className="mb-4">Margin risk</h2>
            {crossover?.hasBaseline && crossover.newlyBelowCost.length > 0 && (
              <Panel className="mb-4 border-risk-ink/30 bg-risk-soft/40 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-risk-ink">
                  <AlertTriangle className="size-4" aria-hidden /> {crossover.newlyBelowCost.length} account{crossover.newlyBelowCost.length > 1 ? 's' : ''} newly below cost since {crossover.periodFrom}
                </div>
                <p className="mt-1 text-sm text-muted">{crossover.newlyBelowCost.map((m) => m.entity.label).join(', ')}</p>
              </Panel>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {risks.map((risk) => (
                <Panel key={risk.id} className={cn('p-5', !risk.available && 'opacity-70')}>
                  {risk.available ? (
                    <Badge tone={risk.severity === 'high' ? 'risk' : risk.severity === 'medium' ? 'watch' : 'neutral'} dot size="sm">{risk.severity} risk</Badge>
                  ) : (
                    <Badge tone="neutral" size="sm">not yet available</Badge>
                  )}
                  <div className="mt-2 font-medium text-foreground">{risk.title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{risk.detail}</p>
                </Panel>
              ))}
            </div>
          </section>
        )}

        {/* ── Cost breakdown (the old reports, merged as evidence) ── */}
        {tab === 'cost' && costReport && (
          <div className="grid gap-12">
            <section>
              <h2 className="mb-1">Spend by model</h2>
              <p className="mb-4 text-sm text-muted">The cost evidence behind your margins — where the money goes.</p>
              <Panel className="p-5"><SpendByModelChart data={costReport.spendByModel} /></Panel>
            </section>
            <section className="grid gap-8 lg:grid-cols-2">
              <div>
                <h3 className="mb-3">Input vs output cost</h3>
                <Panel className="p-5"><TokenSplitBar split={costReport.tokenSplit} /></Panel>
              </div>
              <div>
                <h3 className="mb-3">Daily spend</h3>
                <Panel className="p-5"><SpendTrendChart trend={costReport.trend} spikes={costReport.spikes} /></Panel>
              </div>
            </section>
            {costReport.diagnostics && costReport.diagnostics.length > 0 && (
              <section>
                <h3 className="mb-3">Diagnostics</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {costReport.diagnostics.map((d) => (
                    <Panel key={d.id} className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{d.label}</span>
                        <Badge tone={d.status === 'risk' ? 'risk' : d.status === 'watch' ? 'watch' : d.status === 'good' ? 'good' : 'neutral'} size="sm">{d.value}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{d.detail}</p>
                    </Panel>
                  ))}
                </div>
              </section>
            )}
            {costReport.findings.length > 0 && (
              <section>
                <h3 className="mb-3">Cost-optimization findings</h3>
                <div className="grid gap-3">
                  {costReport.findings.map((f) => (
                    <Panel key={f.id} className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge tone={f.confidenceTier === 'confirmed' ? 'good' : 'watch'} size="sm">{f.confidenceTier === 'confirmed' ? 'Confirmed' : 'Suspected'}</Badge>
                            <span className="font-medium text-foreground">{f.title}</span>
                          </div>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{f.evidence}</p>
                          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-foreground">{f.fix}</p>
                        </div>
                        <span className="tnum shrink-0 text-sm text-muted">{usd(f.estMonthlyLow)}–{usd(f.estMonthlyHigh)}/mo</span>
                      </div>
                    </Panel>
                  ))}
                </div>
              </section>
            )}
            <section className="grid gap-3 text-sm text-muted sm:grid-cols-3">
              <Stat label="Input tokens" value={fmtTokens(costReport.tokenSplit.inputTokens)} />
              <Stat label="Output tokens" value={fmtTokens(costReport.tokenSplit.outputTokens)} />
              <Stat label="Output cost share" value={pct(costReport.tokenSplit.outputCostPct)} />
            </section>
          </div>
        )}

        {/* ── CFO Report ── */}
        {tab === 'cfo' && (
          <section className="print-block">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2.5">Weekly AI CFO Report</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted">{cfo.headline}</p>
              </div>
              <Button variant="secondary" className="no-print" onClick={handlePrint}><Download aria-hidden /> Download PDF</Button>
            </div>
            {crossover?.hasBaseline && crossover.newlyBelowCost.length > 0 && (
              <Panel className="mb-4 border-risk-ink/30 bg-risk-soft/40 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-risk-ink"><AlertTriangle className="size-4" aria-hidden /> {crossover.newlyBelowCost.length} account{crossover.newlyBelowCost.length > 1 ? 's' : ''} newly below cost since {crossover.periodFrom}</div>
                <p className="mt-1 text-sm text-muted">{crossover.newlyBelowCost.map((m) => m.entity.label).join(', ')}</p>
              </Panel>
            )}
            <Panel className="overflow-hidden">
              <dl className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x">
                {cfo.sections.map((s, i) => (
                  <div key={i} className="px-5 py-4">
                    <dt className="text-xs font-medium uppercase tracking-wider text-faint">{s.label}</dt>
                    <dd className={cn('mt-1 text-sm font-medium', s.tone === 'good' ? 'text-good-ink' : s.tone === 'risk' ? 'text-risk-ink' : s.tone === 'watch' ? 'text-watch-ink' : 'text-foreground')}>{s.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            {costReport?.founderMemo && (
              <div className="mt-8">
                <h3 className="mb-3">Founder memo</h3>
                <Panel className="p-6"><Markdown>{costReport.founderMemo}</Markdown></Panel>
              </div>
            )}
            {!cfo.hasBaseline && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-faint"><AlertTriangle className="size-3.5" aria-hidden /> This is your baseline period. Re-scan next month to unlock margin trend & "who's about to go below cost."</p>
            )}
          </section>
        )}
      </div>
    </Container>
  )
}
