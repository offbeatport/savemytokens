import * as React from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Check, Eye, AlertTriangle, Download, TrendingUp, ArrowLeft, Info } from 'lucide-react'
import { Container } from '@/components/Container'
import { Panel, Stat, SectionHeading } from '@/components/primitives'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from '@/components/ui/accordion'
import { HealthScore } from '@/components/HealthScore'
import { BandBadge, SeverityBadge, ConfidenceBadge } from '@/components/StatusBadges'
import { SpendTrendChart, SpendByModelChart, TokenSplitBar } from '@/components/charts'
import { Markdown } from '@/components/Markdown'
import { getFullReport } from '@/lib/server/scans'
import { confirmCheckout } from '@/lib/server/payments'
import { reportBySlug } from '@/lib/reports/catalog'
import { track } from '@/lib/analytics'
import { usd, usdRange, pct, num, dateShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Finding, FindingMetric, DiagnosticMetric, MarketRow, Report } from '@/lib/analysis/types'

export const Route = createFileRoute('/s/$scanId/r/$reportSlug/report')({
  validateSearch: (s: Record<string, unknown>): { checkout?: string } => ({
    checkout: typeof s.checkout === 'string' ? s.checkout : undefined,
  }),
  loaderDeps: ({ search }) => ({ checkout: search.checkout }),
  loader: async ({ params, deps }) => {
    const checkout = deps.checkout
    let r = await getFullReport({ data: { id: params.scanId, slug: params.reportSlug } })
    if (!r.unlocked && checkout) {
      await confirmCheckout({ data: { scanId: params.scanId, slug: params.reportSlug, checkoutId: checkout } })
      r = await getFullReport({ data: { id: params.scanId, slug: params.reportSlug } })
    }
    if (!r.unlocked) {
      throw redirect({ to: '/s/$scanId/r/$reportSlug', params: { scanId: params.scanId, reportSlug: params.reportSlug } })
    }
    return r
  },
  component: ReportPage,
})

function ReportPage() {
  const { report } = Route.useLoaderData()
  const { scanId, reportSlug } = Route.useParams()
  const meta = reportBySlug(reportSlug)

  React.useEffect(() => {
    if (report) track('report_view', { scanId, slug: reportSlug, healthy: report.healthy })
  }, [scanId, reportSlug, report])

  const handlePrint = React.useCallback(() => {
    track('report_download', { scanId, slug: reportSlug })
    if (typeof window !== 'undefined') window.print()
  }, [scanId, reportSlug])

  if (!report) {
    return (
      <Container size="narrow" className="py-24">
        <SectionHeading eyebrow={meta?.name ?? 'Report'} title="This report isn't available" lead="Try running a fresh scan." />
        <Link to="/scan" className={cn(buttonVariants({ variant: 'primary' }), 'mt-8 no-print')}>
          Run Free Scan
        </Link>
      </Container>
    )
  }

  const isMargin = report.kind === 'margin'

  return (
    <Container size="default" className="py-12 sm:py-16">
      {/* Header (not <header>: global print CSS hides that) */}
      <section className="print-block">
        <div className="no-print mb-4">
          <Link
            to="/s/$scanId"
            params={{ scanId }}
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> All reports
          </Link>
        </div>
        <div className="eyebrow mb-3">{meta?.name ?? 'Report'}</div>
        <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <h1>
              {report.healthy
                ? meta?.tagline ?? 'Your AI spend appears healthy'
                : `${usdRange(report.estMonthlyImpactLow, report.estMonthlyImpactHigh)}/mo in likely ${isMargin ? 'margin' : 'savings'}`}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{report.executiveSummary}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <BandBadge band={report.band} label={report.bandLabel} />
              <span className="text-sm text-faint">Period analyzed: {report.periodLabel}</span>
            </div>
            {report.reconciliation && (
              <p className="mt-3 max-w-2xl text-sm text-faint">{report.reconciliation.note}</p>
            )}
            <div className="mt-7 flex flex-wrap items-center gap-3 no-print">
              <Button variant="secondary" onClick={handlePrint}>
                <Download />
                Download PDF
              </Button>
              <Link to="/scan" className={buttonVariants({ variant: 'ghost' })}>
                Run a new scan
              </Link>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HealthScore score={report.healthScore} band={report.band} label={report.bandLabel} size={184} />
          </div>
        </div>

        {(report.limitationNote || report.confidenceNote) && (
          <div className="mt-6 flex flex-col gap-2">
            {report.limitationNote && (
              <p className="flex items-start gap-2 text-sm leading-relaxed text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-faint" />
                {report.limitationNote}
              </p>
            )}
            {report.confidenceNote && (
              <p className="flex items-start gap-2 text-sm leading-relaxed text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-faint" />
                {report.confidenceNote}
              </p>
            )}
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 gap-6 border-t border-border pt-8 sm:grid-cols-3">
          <Stat label="Spend analyzed" value={usd(report.spendAnalyzed)} sub={report.periodLabel} />
          <Stat
            label={isMargin ? 'Margin at risk' : 'Est. monthly impact'}
            value={usdRange(report.estMonthlyImpactLow, report.estMonthlyImpactHigh)}
            valueClassName={report.healthy ? undefined : 'text-primary-strong'}
            sub={
              report.healthy
                ? 'headroom to keep an eye on'
                : `≈ ${usdRange(report.estMonthlyImpactLow * 12, report.estMonthlyImpactHigh * 12)}/yr`
            }
          />
          {report.healthy ? (
            <Stat label="Output cost share" value={pct(report.tokenSplit.outputCostPct)} sub={`${num(report.spendByModel.length)} models tracked`} />
          ) : (
            <Stat label={isMargin ? 'Issues found' : 'Opportunities found'} value={num(report.findings.length)} sub="ranked by impact" />
          )}
        </div>
      </section>

      {/* Body */}
      {report.healthy ? (
        <HealthyReport report={report} />
      ) : isMargin ? (
        <MarginReport report={report} scanId={scanId} />
      ) : (
        <SavingsReport report={report} />
      )}
    </Container>
  )
}

/* ================= Healthy ================= */
function HealthyReport({ report }: { report: Report }) {
  const hr = report.healthyReport
  return (
    <div className="mt-14 space-y-14">
      <section className="print-block">
        <SectionHeading
          eyebrow="The verdict"
          title="Nothing urgent to fix"
          lead="Your usage is efficient relative to your spend. Here's what's working, what to watch, and the thresholds worth a closer look."
        />
        {hr && (
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <HealthList title="What looks good" tone="good" icon={Check} items={hr.whatLooksGood} />
            <HealthList title="What to monitor" tone="watch" icon={Eye} items={hr.whatToMonitor} />
            <HealthList title="Warning signs" tone="risk" icon={AlertTriangle} items={hr.warningSigns} />
          </div>
        )}
      </section>
      {hr && hr.budgetThresholds.length > 0 && (
        <section className="print-block">
          <SectionHeading eyebrow="Guardrails" title="Budget thresholds" />
          <Panel className="mt-6 p-6">
            <dl className="divide-y divide-border">
              {hr.budgetThresholds.map((t) => (
                <div key={t.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <dt className="text-sm text-muted">{t.label}</dt>
                  <dd className="tnum text-sm font-medium text-foreground">{t.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </section>
      )}
      <Diagnostics items={report.diagnostics} />
      <MarketCheck rows={report.marketRows} asOf={report.marketAsOf} />
      <FounderMemo report={report} />
      <SpendBreakdown report={report} />
    </div>
  )
}

function HealthList({
  title,
  items,
  tone,
  icon: Icon,
}: {
  title: string
  items: string[]
  tone: 'good' | 'watch' | 'risk'
  icon: React.ComponentType<{ className?: string }>
}) {
  if (!items?.length) return null
  const dot = tone === 'good' ? 'bg-good' : tone === 'watch' ? 'bg-watch' : 'bg-risk'
  const ink = tone === 'good' ? 'text-good-ink' : tone === 'watch' ? 'text-watch-ink' : 'text-risk-ink'
  return (
    <Panel className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Icon className={`size-4 ${ink}`} />
        <h3 className="text-base font-medium">{title}</h3>
      </div>
      <ul className="space-y-2.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm text-muted">
            <span className={`mt-[0.45rem] size-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/* ================= Savings (findings) ================= */
function SavingsReport({ report }: { report: Report }) {
  return (
    <div className="mt-14 space-y-16">
      <FounderMemo report={report} />
      <LeakLedger report={report} />
      <Diagnostics items={report.diagnostics} />
      <MarketCheck rows={report.marketRows} asOf={report.marketAsOf} />
      <section id="opportunities" className="scroll-mt-24 print-block">
        <SectionHeading
          eyebrow="Ranked opportunities"
          title="Every fix, ordered by impact"
          lead="The highest-value change is at the top. Each item includes the evidence and the exact change to make."
        />
        <Opportunities findings={report.findings} />
      </section>
      {report.topLeaks.length > 0 && (
        <section id="leaks" className="scroll-mt-24 print-block">
          <SectionHeading eyebrow="Top cost leaks" title="Where the money goes first" lead="The three changes with the biggest dollar impact - start here." />
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {report.topLeaks.slice(0, 3).map((f, i) => (
              <Panel key={f.id} className="flex flex-col p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow">Leak {i + 1}</span>
                  <SeverityBadge severity={f.severity} />
                </div>
                <h3 className="mt-3 text-base font-medium leading-snug">{f.title}</h3>
                <div className="mt-3 font-display text-xl font-light tnum text-primary-strong">
                  {usdRange(f.estMonthlyLow, f.estMonthlyHigh)}
                  <span className="text-sm text-faint"> /mo</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.evidence}</p>
              </Panel>
            ))}
          </div>
        </section>
      )}
      <div id="breakdown" className="scroll-mt-24">
        <SpendBreakdown report={report} />
      </div>
      <section id="spikes" className="scroll-mt-24 print-block">
        <SectionHeading eyebrow="Spend spikes" title="Unusual days, flagged" lead="Daily spend with anomalies marked - spikes often trace to a runaway job, a retry storm, or a model swap." />
        <Panel className="mt-8 p-5 sm:p-6">
          <SpendTrendChart trend={report.trend} spikes={report.spikes} />
        </Panel>
        {report.spikes.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {report.spikes.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-risk" />
                <span className="text-muted">
                  <span className="font-medium text-foreground tnum">{dateShort(s.date)}</span> -{' '}
                  <span className="tnum text-risk-ink">+{pct(s.deltaPct)}</span> vs baseline (
                  <span className="tnum">{usd(s.cost)}</span> vs <span className="tnum">{usd(s.baseline)}</span>). {s.note}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-muted">No unusual spikes detected - spend tracked close to its baseline.</p>
        )}
      </section>
      <ScanLimits />
    </div>
  )
}

/* ================= Margin ================= */
function MarginReport({ report, scanId }: { report: Report; scanId: string }) {
  const rows = report.extras?.marginRows ?? []
  const coverage = report.extras?.coveragePct ?? 0
  return (
    <div className="mt-14 space-y-16">
      <FounderMemo report={report} />
      {report.findings.length > 0 && (
        <section className="print-block">
          <SectionHeading eyebrow="Margin issues" title="Ordered by impact" lead="The accounts and projects most likely to be hurting your AI margin." />
          <Opportunities findings={report.findings} />
        </section>
      )}
      <section className="print-block">
        <SectionHeading
          eyebrow="Margin table"
          title="Cost vs revenue by project"
          lead={coverage > 0 ? `${pct(coverage)} of spend is covered by your revenue map.` : 'No revenue map attached - showing cost attribution only.'}
        />
        {coverage === 0 && (
          <Panel className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5 no-print">
            <span className="text-sm text-muted">Attach a project→revenue map to compute true margins.</span>
            <Link
              to="/s/$scanId/r/$reportSlug"
              params={{ scanId, reportSlug: 'ai-margin-leak' }}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
            >
              Add revenue map
            </Link>
          </Panel>
        )}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
                <th className="py-2.5 pr-4 font-medium">Project / customer</th>
                <th className="py-2.5 px-4 font-medium">Plan</th>
                <th className="py-2.5 px-4 text-right font-medium">AI cost</th>
                <th className="py-2.5 px-4 text-right font-medium">Revenue</th>
                <th className="py-2.5 px-4 text-right font-medium">Margin</th>
                <th className="py-2.5 pl-4 text-right font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted">
                    No project-level cost rows for this scan.
                  </td>
                </tr>
              )}
              {rows.map((m) => (
                <tr key={m.key} className="border-b border-border last:border-0">
                  <td className="py-2.5 pr-4 text-foreground">{m.key}</td>
                  <td className="py-2.5 px-4 text-muted">{m.plan ?? '-'}</td>
                  <td className="py-2.5 px-4 text-right tnum">{usd(m.cost)}</td>
                  <td className="py-2.5 px-4 text-right tnum text-muted">{m.revenue !== undefined ? usd(m.revenue) : '-'}</td>
                  <td className="py-2.5 px-4 text-right tnum">{m.marginPct !== undefined ? pct(m.marginPct) : '-'}</td>
                  <td className="py-2.5 pl-4 text-right">
                    {m.belowCost ? (
                      <Badge tone="risk" size="sm">Below cost</Badge>
                    ) : m.marginPct !== undefined && m.marginPct < 50 ? (
                      <Badge tone="watch" size="sm">Thin</Badge>
                    ) : m.marginPct !== undefined ? (
                      <Badge tone="good" size="sm">OK</Badge>
                    ) : (
                      <span className="text-faint">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <ScanLimits />
    </div>
  )
}

/* ================= Shared ================= */
function Opportunities({ findings }: { findings: Finding[] }) {
  const ranked = React.useMemo(() => [...findings].sort((a, b) => a.rank - b.rank), [findings])
  const defaultOpen = ranked.slice(0, 2).map((f) => f.id)
  if (ranked.length === 0) {
    return (
      <Panel className="mt-8 p-6">
        <p className="text-sm text-muted">No individual items were isolated for this scan.</p>
      </Panel>
    )
  }
  return (
    <Panel className="mt-8 px-5 sm:px-7">
      <Accordion defaultValue={defaultOpen}>
        {ranked.map((f) => (
          <AccordionItem key={f.id} value={f.id} className="border-b border-border last:border-0">
            <AccordionTrigger>
              <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2 pr-2">
                <span className="w-7 shrink-0 font-display text-lg font-light tnum text-faint">#{f.rank}</span>
                <span className="font-medium text-foreground">{f.title}</span>
                <SeverityBadge severity={f.severity} />
                {f.rank === 1 && (
                  <Badge tone="primary" size="sm">Top opportunity</Badge>
                )}
                <span className="ml-auto whitespace-nowrap tnum text-sm font-medium text-primary-strong">
                  {usdRange(f.estMonthlyLow, f.estMonthlyHigh)}/mo
                </span>
              </div>
            </AccordionTrigger>
            <AccordionPanel>
              <div className="space-y-5 pb-6 sm:pl-10">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral" size="sm">{f.categoryLabel}</Badge>
                  <ConfidenceBadge confidence={f.confidence} />
                </div>
                {(f.affectedProjects.length > 0 || f.affectedModels.length > 0) && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:gap-10">
                    {f.affectedProjects.length > 0 && (
                      <div>
                        <div className="eyebrow mb-2">Affected projects</div>
                        <div className="flex flex-wrap gap-1.5">
                          {f.affectedProjects.map((p) => (
                            <Badge key={p} tone="neutral" size="sm">{p}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {f.affectedModels.length > 0 && (
                      <div>
                        <div className="eyebrow mb-2">Affected models</div>
                        <div className="flex flex-wrap gap-1.5">
                          {f.affectedModels.map((m) => (
                            <Badge key={m} tone="neutral" size="sm">{m}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <div className="eyebrow mb-1.5">Evidence</div>
                  <p className="leading-relaxed text-muted">{f.evidence}</p>
                </div>
                <Receipts metrics={f.metrics} />
                <div className="border-l-2 border-primary pl-4">
                  <div className="eyebrow mb-1.5 text-primary-strong">The fix</div>
                  <p className="font-medium leading-relaxed text-foreground">{f.fix}</p>
                </div>
                {f.detail && <p className="text-sm leading-relaxed text-muted">{f.detail}</p>}
              </div>
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
    </Panel>
  )
}

/** The receipts: the checkable math behind a single finding. */
function Receipts({ metrics }: { metrics?: FindingMetric[] }) {
  if (!metrics || metrics.length === 0) return null
  return (
    <div>
      <div className="eyebrow mb-2">The math behind it</div>
      <dl className="divide-y divide-border rounded-md border border-border">
        {metrics.map((m, i) => (
          <div key={i} className="flex items-baseline justify-between gap-6 px-4 py-2.5">
            <dt className="text-sm text-muted">{m.label}</dt>
            <dd className={cn('tnum text-right text-sm font-medium', m.emphasis ? 'text-primary-strong' : 'text-foreground')}>
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Leak ledger: every recoverable dollar, by category, summing to the headline. */
function LeakLedger({ report }: { report: Report }) {
  const findings = report.findings
  if (findings.length < 2) return null
  const spend = report.spendAnalyzed || 1
  const shareOf = (low: number, high: number) => pct((((low + high) / 2) / spend) * 100, 1)
  return (
    <section id="ledger" className="scroll-mt-24 print-block">
      <SectionHeading
        eyebrow="Leak ledger"
        title="Where every recoverable dollar comes from"
        lead="Each line is an independent estimate from a different lever. They add up to the headline number - no double counting."
      />
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
              <th className="py-2.5 pr-4 font-medium">Leak category</th>
              <th className="py-2.5 px-4 font-medium">Where</th>
              <th className="py-2.5 px-4 text-right font-medium">Monthly recoverable</th>
              <th className="py-2.5 pl-4 text-right font-medium">% of spend</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="border-b border-border last:border-0">
                <td className="py-2.5 pr-4">
                  <span className="text-foreground">{f.categoryLabel}</span>
                  {f.rank === 1 && <span className="ml-2 text-xs text-primary-strong">top</span>}
                </td>
                <td className="py-2.5 px-4 text-muted">
                  {f.affectedProjects.slice(0, 2).join(', ') || f.affectedModels.slice(0, 2).join(', ') || '-'}
                </td>
                <td className="py-2.5 px-4 text-right tnum">{usdRange(f.estMonthlyLow, f.estMonthlyHigh)}</td>
                <td className="py-2.5 pl-4 text-right tnum text-muted">{shareOf(f.estMonthlyLow, f.estMonthlyHigh)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground">
              <td className="py-3 pr-4 font-medium text-foreground">Total recoverable</td>
              <td className="py-3 px-4 text-muted">{findings.length} levers</td>
              <td className="py-3 px-4 text-right tnum font-semibold text-primary-strong">
                {usdRange(report.estMonthlyImpactLow, report.estMonthlyImpactHigh)}
              </td>
              <td className="py-3 pl-4 text-right tnum text-muted">
                {shareOf(report.estMonthlyImpactLow, report.estMonthlyImpactHigh)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-4 text-xs text-faint">
        Independent low/high estimates per lever; the total is their sum. Annualized:{' '}
        {usdRange(report.estMonthlyImpactLow * 12, report.estMonthlyImpactHigh * 12)}.
      </p>
    </section>
  )
}

/** The three checks no provider dashboard runs - visibility, not savings. */
function Diagnostics({ items }: { items?: DiagnosticMetric[] }) {
  if (!items || items.length === 0) return null
  const tone = (s: DiagnosticMetric['status']) =>
    s === 'good' ? 'good' : s === 'watch' ? 'watch' : s === 'risk' ? 'risk' : 'neutral'
  const word = (s: DiagnosticMetric['status']) =>
    s === 'good' ? 'Healthy' : s === 'watch' ? 'Watch' : s === 'risk' ? 'At risk' : 'Limited'
  const valueInk = (d: DiagnosticMetric) =>
    d.status === 'risk'
      ? 'text-risk-ink'
      : d.status === 'watch'
        ? 'text-watch-ink'
        : d.available
          ? 'text-foreground'
          : 'text-faint'
  return (
    <section id="diagnostics" className="scroll-mt-24 print-block">
      <SectionHeading
        eyebrow="What your dashboard won't show you"
        title="Three checks no provider console runs"
        lead="Computed from the same metadata — visibility and governance signals, not dollar savings, so they stay out of the leak ledger."
      />
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {items.map((d) => (
          <Panel key={d.id} className="flex flex-col p-6">
            <div className="flex items-center justify-between gap-2">
              <span className="eyebrow">{d.label}</span>
              <Badge tone={tone(d.status)} size="sm">
                {word(d.status)}
              </Badge>
            </div>
            <div className={cn('mt-3 font-display text-2xl font-light leading-tight tnum', valueInk(d))}>
              {d.value}
            </div>
            {d.benchmark && <div className="mt-1.5 text-xs text-faint">{d.benchmark}</div>}
            <p className="mt-3 text-sm leading-relaxed text-muted">{d.detail}</p>
          </Panel>
        ))}
      </div>
    </section>
  )
}

/** Market & quality: the user's models joined against the whole market. */
function MarketCheck({ rows, asOf }: { rows?: MarketRow[]; asOf?: string }) {
  if (!rows || rows.length === 0) return null
  return (
    <section id="market" className="scroll-mt-24 print-block">
      <SectionHeading
        eyebrow="Market & quality check"
        title="Your models vs the whole market"
        lead={`Your spend joined against current list prices, third-party quality scores, and model lifecycle${asOf ? ` (as of ${asOf})` : ''}. The "cheapest equivalent" is the lowest-priced open model that benchmarks close - shown with its LMArena Elo so you can judge the tradeoff yourself.`}
      />
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
              <th className="py-2.5 pr-4 font-medium">Model</th>
              <th className="py-2.5 px-4 text-right font-medium">Your spend</th>
              <th className="py-2.5 px-4 text-right font-medium">$/1M in · out</th>
              <th className="py-2.5 px-4 text-right font-medium">Quality (Elo)</th>
              <th className="py-2.5 pl-4 font-medium">Cheapest equivalent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className="border-b border-border align-top last:border-0">
                <td className="py-3 pr-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground">{r.model}</span>
                    {r.deprecated && (
                      <Badge tone="risk" size="sm">
                        Deprecated
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-[0.7rem] leading-relaxed text-faint">
                    {[r.promptCaching ? 'caching' : null, r.batchEligible ? 'batch 50% off' : null]
                      .filter(Boolean)
                      .join(' · ')}
                    {r.deprecated && r.successor ? ` · → ${r.successor}` : ''}
                  </div>
                </td>
                <td className="py-3 px-4 text-right tnum">{usd(r.cost)}</td>
                <td className="py-3 px-4 text-right tnum text-muted">
                  {r.inPer1m !== undefined ? `$${r.inPer1m} · $${r.outPer1m}` : '-'}
                </td>
                <td className="py-3 px-4 text-right tnum text-muted">{r.arenaElo ?? '-'}</td>
                <td className="py-3 pl-4">
                  {r.bestAlt ? (
                    <div>
                      <span className="text-foreground">{r.bestAlt.model}</span>{' '}
                      <span className="text-faint">@ {r.bestAlt.host}</span>
                      <div className="mt-0.5 text-xs">
                        <span className="tnum text-primary-strong">{pct(r.bestAlt.cheaperPct * 100)} cheaper/token</span>
                        {r.bestAlt.arenaElo ? <span className="text-faint"> · {r.bestAlt.arenaElo} Elo</span> : null}
                      </div>
                    </div>
                  ) : (
                    <span className="text-faint">already near-cheapest</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-faint">
        Quality is LMArena (Chatbot Arena) Elo; prices are public list rates per 1M tokens. A cheapest-equivalent is a
        migration candidate to A/B - not a guarantee. Proving equivalence on your own workload is the real work. Sources:
        provider pricing pages, artificialanalysis.ai, lmarena.ai.
      </p>
    </section>
  )
}

/** Honesty section: the ceiling of usage-metadata analysis, stated plainly. */
function ScanLimits() {
  const computed = [
    'Spend, requests, and the input/output token split for every model and project, from your own export.',
    'Cost per request, and each model’s cheaper-sibling price at list rates.',
    'Error rate and daily spend anomalies across the analyzed window.',
  ]
  const estimated = [
    'Migration %, cache-hit rate, and trim % are assumed ranges - labeled on every finding.',
    'We never ingest prompts or responses, so quality impact must be confirmed with a short A/B.',
    'True agent-loop and retry detail needs request traces; metadata only flags the signature.',
  ]
  return (
    <section className="print-block">
      <SectionHeading
        eyebrow="Method & limits"
        title="What this scan can and can't see"
        lead="The ceiling of usage-metadata analysis, stated plainly - so you can trust the numbers that are here."
      />
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Panel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Check className="size-4 text-good-ink" />
            <h3 className="text-base font-medium">Measured from your data</h3>
          </div>
          <ul className="space-y-2.5">
            {computed.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-muted">
                <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-good" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Info className="size-4 text-faint" />
            <h3 className="text-base font-medium">Estimated or out of view</h3>
          </div>
          <ul className="space-y-2.5">
            {estimated.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-muted">
                <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-watch" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  )
}

function FounderMemo({ report }: { report: Report }) {
  return (
    <section id="memo" className="scroll-mt-24 print-block">
      <SectionHeading eyebrow="Founder-ready memo" title="The summary you can forward" lead="Written to paste straight into Slack or an email to your team - no editing required." />
      <Panel className="mt-6 p-6 sm:p-8">
        <Markdown>{report.founderMemo}</Markdown>
      </Panel>
      <p className="mt-3 text-xs text-faint">
        {report.generatedFromLlm
          ? 'Drafted with AI assistance from your usage data - figures are computed deterministically.'
          : 'Generated deterministically from your usage data.'}
      </p>
    </section>
  )
}

function SpendBreakdown({ report }: { report: Report }) {
  const split = report.tokenSplit
  const out = split.outputCostPct
  const takeaway =
    out >= 55
      ? `Output tokens drive ${pct(out)} of cost - shorter completions and output caps move the needle fastest.`
      : out <= 35
        ? `Input dominates at ${pct(100 - out)} of cost - prompt caching and context trimming are your biggest levers.`
        : `Cost splits fairly evenly between input and output - room to trim on both prompt size and completion length.`
  return (
    <div className="space-y-16">
      <section className="print-block">
        <SectionHeading eyebrow="Spend by model" title="Which models cost the most" />
        <Panel className="mt-8 p-5 sm:p-6">
          <SpendByModelChart data={report.spendByModel} />
        </Panel>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
                <th className="py-2.5 pr-4 font-medium">Model</th>
                <th className="py-2.5 px-4 text-right font-medium">Cost</th>
                <th className="py-2.5 px-4 text-right font-medium">Share</th>
                <th className="py-2.5 pl-4 text-right font-medium">Requests</th>
              </tr>
            </thead>
            <tbody>
              {report.spendByModel.map((m) => (
                <tr key={m.model} className="border-b border-border last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="text-foreground">{m.model}</span>
                    <span className="ml-2 text-xs text-faint">{m.provider}</span>
                  </td>
                  <td className="py-2.5 px-4 text-right tnum">{usd(m.cost)}</td>
                  <td className="py-2.5 px-4 text-right tnum text-muted">{pct(m.pct)}</td>
                  <td className="py-2.5 pl-4 text-right tnum text-muted">{num(m.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="print-block">
        <SectionHeading eyebrow="Spend by project / API key" title="Where spend is concentrated" />
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
                <th className="py-2.5 pr-4 font-medium">Project / key</th>
                <th className="py-2.5 px-4 text-right font-medium">Cost</th>
                <th className="py-2.5 px-4 text-right font-medium">Share</th>
                <th className="py-2.5 pl-4 text-right font-medium">Requests</th>
              </tr>
            </thead>
            <tbody>
              {report.spendByProject.map((p) => (
                <tr key={p.project} className="border-b border-border last:border-0">
                  <td className="py-2.5 pr-4 text-foreground">{p.project}</td>
                  <td className="py-2.5 px-4 text-right tnum">{usd(p.cost)}</td>
                  <td className="py-2.5 px-4 text-right tnum text-muted">{pct(p.pct)}</td>
                  <td className="py-2.5 pl-4 text-right tnum text-muted">{num(p.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="print-block">
        <SectionHeading eyebrow="Input vs output" title="What you're paying tokens for" />
        <Panel className="mt-8 p-6">
          <TokenSplitBar split={split} />
          <p className="mt-5 flex items-start gap-2 text-sm leading-relaxed text-muted">
            <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{takeaway}</span>
          </p>
        </Panel>
      </section>
    </div>
  )
}
