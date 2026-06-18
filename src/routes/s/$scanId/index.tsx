import * as React from 'react'
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Lock,
  Check,
  HeartPulse,
  Scissors,
  DatabaseZap,
  TrendingDown,
  Workflow,
  FileText,
  type LucideIcon,
} from 'lucide-react'
import { Container } from '@/components/Container'
import { Panel, Stat } from '@/components/primitives'
import { HealthScore } from '@/components/HealthScore'
import { BandBadge } from '@/components/StatusBadges'
import { TrustLine } from '@/components/Header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { getReportHub } from '@/lib/server/scans'
import { reportBySlug } from '@/lib/reports/catalog'
import { usd, usdRange, pct, dateShort } from '@/lib/format'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/s/$scanId/')({
  loader: async ({ params }) => {
    const hub = await getReportHub({ data: { id: params.scanId } })
    if (!hub) throw redirect({ to: '/scan' })
    return hub
  },
  component: HubPage,
})

const ICONS: Record<string, LucideIcon> = {
  HeartPulse,
  Scissors,
  DatabaseZap,
  TrendingDown,
  Workflow,
}

function HubPage() {
  const hub = Route.useLoaderData()
  const { scanId } = Route.useParams()

  React.useEffect(() => {
    track('hub_view', { scanId })
  }, [scanId])

  const health = hub.reports.find((r) => r.slug === 'ai-cost-health')
  const healthSnap = health?.snapshot ?? null
  const basisLabel =
    hub.costBasis === 'actual' ? 'Actual spend' : hub.costBasis === 'mixed' ? 'Mixed spend' : 'Estimated spend'

  return (
    <Container className="py-12 sm:py-16">
      {/* Header */}
      <header className="flex flex-col gap-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="eyebrow mb-3">Your scan</div>
          <h1 className="max-w-xl">Your AI cost reports</h1>
          {healthSnap && (
            <div className="mt-7 flex flex-wrap items-center gap-x-8 gap-y-4">
              <Stat label="Spend analyzed" value={usd(healthSnap.spendAnalyzed)} sub={healthSnap.periodLabel} />
              <Badge tone={hub.costBasis === 'actual' ? 'primary' : 'neutral'} dot>
                {basisLabel}
              </Badge>
            </div>
          )}
          <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted">
            One scan, five reports. Each has a free preview below - unlock any report for its exact
            fixes.
          </p>
          <div className="mt-5">
            <TrustLine />
          </div>
        </div>
        {healthSnap && (
          <div className="flex shrink-0 flex-col items-center gap-3">
            <HealthScore score={healthSnap.healthScore} band={healthSnap.band} label={healthSnap.bandLabel} />
            <BandBadge band={healthSnap.band} label={healthSnap.bandLabel} />
          </div>
        )}
      </header>

      {/* Report cards */}
      <div className="mt-14 grid gap-5 sm:grid-cols-2">
        {hub.reports.map((card) => {
          const Icon = ICONS[card.icon] ?? FileText
          const snap = card.snapshot
          const featured = card.slug === 'ai-cost-health'
          const meta = reportBySlug(card.slug)
          return (
            <Panel
              key={card.slug}
              className={cn('flex flex-col p-6 sm:p-7', featured && 'border-primary/40')}
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    'grid size-10 place-items-center rounded-lg border',
                    featured ? 'border-primary/40 text-primary' : 'border-border text-muted',
                  )}
                >
                  <Icon className="size-5" />
                </span>
                {card.unlocked ? (
                  <Badge tone="good" dot>
                    Unlocked
                  </Badge>
                ) : (
                  <Badge tone="neutral">{usd(card.price)}</Badge>
                )}
              </div>

              <h3 className="mt-4 text-lg leading-snug">{card.name}</h3>
              <p className="mt-1 text-sm text-muted">{card.tagline}</p>

              {snap ? (
                <>
                  <p className="mt-4 text-sm leading-relaxed text-foreground">
                    {snap.visibleInsight.title}
                  </p>
                  <div className="mt-3 text-sm text-muted">
                    {snap.opportunityCount > 0 ? (
                      <>
                        <span className="tnum font-medium text-foreground">
                          {snap.opportunityCount}
                        </span>{' '}
                        opportunities · est.{' '}
                        <span className="tnum text-primary-strong">
                          {usdRange(snap.estSavingsLow, snap.estSavingsHigh)}
                        </span>
                        /mo
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-good-ink">
                        <Check className="size-4" /> Looks healthy
                      </span>
                    )}
                  </div>
                  {snap.lockedCount > 0 && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-faint">
                      <Lock className="size-3.5" />
                      {snap.lockedCount} locked
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  Re-scan your usage to unlock this report.
                </p>
              )}

              {card.slug === 'ai-margin-leak' && meta?.metadataLimitNote && (
                <p className="mt-3 text-xs text-faint">{meta.metadataLimitNote}</p>
              )}

              <div className="mt-auto pt-6">
                {!card.available ? (
                  <Link
                    to="/scan"
                    className={cn(buttonVariants({ variant: 'subtle', size: 'sm' }))}
                  >
                    Run a new scan
                  </Link>
                ) : card.unlocked ? (
                  <Link
                    to="/s/$scanId/r/$reportSlug/report"
                    params={{ scanId, reportSlug: card.slug }}
                    className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
                  >
                    View report
                    <ArrowRight />
                  </Link>
                ) : (
                  <Link
                    to="/s/$scanId/r/$reportSlug"
                    params={{ scanId, reportSlug: card.slug }}
                    className={cn(buttonVariants({ variant: featured ? 'primary' : 'secondary', size: 'sm' }))}
                  >
                    See preview · {usd(card.price)}
                    <ArrowRight />
                  </Link>
                )}
              </div>
            </Panel>
          )
        })}
      </div>

      {hub.reconciliation && (
        <p className="mt-8 text-xs text-faint">
          {hub.reconciliation.note}
          {hub.createdAt ? ` · scanned ${dateShort(new Date(hub.createdAt).toISOString().slice(0, 10))}` : ''}
          {hub.reconciliation.actualPct ? ` · ${pct(hub.reconciliation.actualPct * 100)} provider-reported` : ''}
        </p>
      )}
    </Container>
  )
}
