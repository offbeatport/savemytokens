import * as React from 'react'
import { createFileRoute, redirect, useNavigate, useRouter, Link } from '@tanstack/react-router'
import { ArrowRight, Check, CheckCircle2, Loader2, Lock, Info, ArrowLeft, Upload } from 'lucide-react'
import { Container } from '@/components/Container'
import { Panel, Stat } from '@/components/primitives'
import { HealthScore } from '@/components/HealthScore'
import { BandBadge } from '@/components/StatusBadges'
import { TrustLine } from '@/components/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { getReportSnapshot, attachRevenueMap } from '@/lib/server/scans'
import { startCheckout, confirmCheckout } from '@/lib/server/payments'
import { reportBySlug, REPORT_PRICE } from '@/lib/reports/catalog'
import { usd, usdRange, pct, num } from '@/lib/format'
import { track } from '@/lib/analytics'

export const Route = createFileRoute('/s/$scanId/r/$reportSlug/')({
  loader: async ({ params }) => {
    const r = await getReportSnapshot({ data: { id: params.scanId, slug: params.reportSlug } })
    if (!r) throw redirect({ to: '/s/$scanId', params: { scanId: params.scanId } })
    return r
  },
  component: SnapshotPage,
})

const FAUX_IMPACT = ['$2,400/mo', '$1,180/mo', '$760/mo', '$430/mo', '$2,950/mo', '$910/mo']

function SnapshotPage() {
  const r = Route.useLoaderData()
  const { scanId, reportSlug } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()
  const s = r.snapshot
  const meta = reportBySlug(reportSlug)

  const [email, setEmail] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const hasOpps = s.opportunityCount > 0
  const hasLocked = s.lockedCount > 0 && s.lockedCategories.length > 0
  const ctaCopy = hasOpps ? `Unlock exact fixes for ${usd(REPORT_PRICE)}.` : `Unlock the full report for ${usd(REPORT_PRICE)}.`
  const includes = meta?.includes ?? []

  async function goToReport() {
    await navigate({ to: '/s/$scanId/r/$reportSlug/report', params: { scanId, reportSlug } })
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    track('checkout_started', { scanId, slug: reportSlug })
    try {
      const res = await startCheckout({ data: { scanId, slug: reportSlug, email: email.trim() || undefined } })
      if (res.mode === 'polar' && res.url) {
        window.location.href = res.url
        return
      }
      await confirmCheckout({ data: { scanId, slug: reportSlug } })
      await goToReport()
    } catch {
      setError("We couldn't start checkout. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <Container size="narrow" className="py-12 sm:py-16">
      <Link
        to="/s/$scanId"
        params={{ scanId }}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All reports
      </Link>

      {r.unlocked && (
        <Panel className="mt-6 flex flex-wrap items-center justify-between gap-4 border-primary/40 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden />
            <span className="font-medium text-primary-strong">You&rsquo;ve unlocked this report</span>
          </div>
          <Button onClick={goToReport} size="sm">
            View full report
            <ArrowRight />
          </Button>
        </Panel>
      )}

      {/* Header */}
      <header className="mt-8 flex flex-col gap-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="eyebrow mb-3">{meta?.name ?? 'Report'} · free preview</div>
          <h1 className="max-w-md">
            {hasOpps ? 'We found ways to cut your AI bill' : (meta?.tagline ?? 'Your AI spend looks healthy')}
          </h1>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Stat label="Spend analyzed" value={usd(s.spendAnalyzed)} sub={s.periodLabel} />
            {s.costBasis && (
              <Badge tone={s.costBasis === 'actual' ? 'primary' : 'neutral'} dot>
                {s.costBasis === 'actual' ? 'Actual' : s.costBasis === 'mixed' ? 'Mixed' : 'Estimated'}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-4">
          <HealthScore score={s.healthScore} band={s.band} label={s.bandLabel} />
          <BandBadge band={s.band} label={s.bandLabel} />
        </div>
      </header>

      {s.metadataLimited && meta?.metadataLimitNote && (
        <p className="mt-6 flex items-start gap-2 text-sm leading-relaxed text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-faint" />
          {meta.metadataLimitNote}
        </p>
      )}

      {hasOpps && (
        <Panel className="mt-12 overflow-hidden">
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Stat
              className="p-5 sm:p-6"
              label="Estimated savings"
              value={usdRange(s.estSavingsLow, s.estSavingsHigh)}
              sub="per month"
              valueClassName="text-2xl text-primary-strong"
            />
            <Stat
              className="p-5 sm:p-6"
              label="Opportunities found"
              value={num(s.opportunityCount)}
              sub="in this report"
              valueClassName="text-2xl"
            />
            <Stat
              className="p-5 sm:p-6"
              label="Top model"
              value={s.topModel.model}
              sub={`${pct(s.topModel.pct)} of spend`}
              valueClassName="text-2xl"
            />
          </div>
        </Panel>
      )}

      {/* The one middle-ground reveal */}
      <Panel className="mt-12 p-6 sm:p-7">
        <Badge tone="primary">Free insight</Badge>
        <h3 className="mt-4">{s.visibleInsight.title}</h3>
        <p className="mt-2.5 max-w-2xl leading-relaxed text-muted">{s.visibleInsight.body}</p>
      </Panel>

      {/* Margin: revenue-map upsell */}
      {reportSlug === 'ai-margin-leak' && (
        <RevenueMapUpload
          scanId={scanId}
          onAttached={() => router.invalidate()}
        />
      )}

      {!hasOpps && (
        <Panel className="mt-8 p-6 sm:p-7">
          <h3>What the full report confirms</h3>
          <p className="mt-2.5 max-w-2xl leading-relaxed text-muted">
            No urgent issues stood out in this window. The full report turns that into a documented,
            founder-ready confirmation - so you know it for sure, not just by gut.
          </p>
          <ul className="mt-5 grid gap-2.5 text-sm sm:grid-cols-2">
            {["What's working in your current setup", 'What to monitor as usage grows', 'Where not to waste engineering time', 'Budget thresholds worth watching'].map(
              (item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-good-ink" aria-hidden />
                  <span className="text-foreground">{item}</span>
                </li>
              ),
            )}
          </ul>
        </Panel>
      )}

      {hasLocked && (
        <section className="mt-12">
          <h3 className="flex items-center gap-2.5">
            <Lock className="size-5 shrink-0 text-faint" aria-hidden />
            {s.lockedCount} more {s.lockedCount === 1 ? 'opportunity' : 'opportunities'} found
            <span className="text-muted"> - including higher-impact savings</span>
          </h3>
          <Panel className="mt-5 overflow-hidden">
            <ul className="divide-y divide-border">
              {s.lockedCategories.map((cat, i) => (
                <li key={cat} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Lock className="size-4 shrink-0 text-faint" aria-hidden />
                    <span className="truncate text-foreground">{cat}</span>
                  </div>
                  <span aria-hidden className="tnum shrink-0 select-none text-muted blur-[3px]">
                    {FAUX_IMPACT[i % FAUX_IMPACT.length]}
                  </span>
                  <span className="sr-only">Locked - unlock the full report to view</span>
                </li>
              ))}
            </ul>
          </Panel>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted">
            Unlock the full report to see exact affected projects, models, estimated impact, and
            recommended fixes.
          </p>
        </section>
      )}

      {/* Paywall */}
      {!r.unlocked && (
        <Panel className="mt-14 border-border-strong p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div>
              <div className="eyebrow mb-2">{meta?.name ?? 'Full report'}</div>
              <h2 className="max-w-md">{meta?.tagline ?? 'Unlock the full report'}</h2>
            </div>
            <div className="text-right">
              <div className="tnum font-display text-4xl font-light text-primary-strong">
                {usd(REPORT_PRICE)}
              </div>
              <div className="text-xs font-medium uppercase tracking-wider text-faint">One-time</div>
            </div>
          </div>

          <p className="mt-4 max-w-2xl leading-relaxed text-muted">
            The paid report is a full diagnosis. If savings are found, it shows exact fixes. If not,
            it shows what&rsquo;s working, what to monitor, and where not to waste engineering time.
          </p>

          {includes.length > 0 && (
            <>
              <Separator className="my-6" />
              <ul className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                {includes.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-good-ink" aria-hidden />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <Separator className="my-6" />

          <form onSubmit={handleUnlock} className="space-y-4">
            <div className="max-w-sm">
              <Label htmlFor="unlock-email">
                Email <span className="font-normal text-faint">(optional - we&rsquo;ll send your report)</span>
              </Label>
              <Input
                id="unlock-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="mt-1.5"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-risk-ink">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-1">
              <Button type="submit" size="lg" disabled={submitting} aria-busy={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Starting checkout…
                  </>
                ) : (
                  <>
                    {ctaCopy}
                    <ArrowRight />
                  </>
                )}
              </Button>
              <TrustLine />
            </div>
          </form>
        </Panel>
      )}
    </Container>
  )
}

function RevenueMapUpload({ scanId, onAttached }: { scanId: string; onAttached: () => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [state, setState] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [msg, setMsg] = React.useState('')

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setState('loading')
    try {
      const csv = await file.text()
      const res = await attachRevenueMap({ data: { scanId, csv } })
      if (res.ok) {
        setState('done')
        setMsg(`Matched ${res.matched} project${res.matched === 1 ? '' : 's'} · ${res.coveragePct}% of spend covered.`)
        track('revenue_map_attached', { scanId, matched: res.matched })
        onAttached()
      } else {
        setState('error')
        setMsg(res.warnings[0] ?? 'Could not read that file.')
      }
    } catch {
      setState('error')
      setMsg('Could not read that file.')
    }
  }

  return (
    <Panel className="mt-8 p-6 sm:p-7">
      <div className="flex items-center gap-2">
        <Upload className="size-4 text-muted" />
        <h3 className="text-base font-medium">Add a revenue map for true margins</h3>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        Upload a CSV mapping each project/customer to its monthly revenue (columns:{' '}
        <code>project, monthly_revenue, plan</code>). We&rsquo;ll compute real per-customer margins
        and flag below-cost accounts.
      </p>
      <input ref={inputRef} type="file" accept=".csv,.txt" onChange={onFile} className="sr-only" aria-label="Upload revenue map CSV" />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={state === 'loading'}>
          {state === 'loading' ? 'Attaching…' : 'Upload revenue map'}
        </Button>
        {msg && (
          <span className={state === 'error' ? 'text-sm text-risk-ink' : 'text-sm text-primary-strong'}>{msg}</span>
        )}
      </div>
    </Panel>
  )
}
