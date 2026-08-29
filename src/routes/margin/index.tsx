import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Check, Loader2, UploadCloud, FileText } from 'lucide-react'
import { Container } from '@/components/Container'
import { SectionHeading, Panel } from '@/components/primitives'
import { TrustLine } from '@/components/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createMarginScan, createMarginSample } from '@/lib/server/margin'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/margin/')({
  component: MarginOnboarding,
})

const ACCEPT = '.csv,.json,.txt'

function readText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsText(file)
  })
}

function Drop({
  file,
  onPick,
  title,
  hint,
  optional,
  disabled,
}: {
  file: File | null
  onPick: (f: File | null) => void
  title: string
  hint: string
  optional?: boolean
  disabled?: boolean
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  const [drag, setDrag] = React.useState(false)
  return (
    <Panel
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && ref.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          ref.current?.click()
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        const f = e.dataTransfer.files?.[0]
        if (f && !disabled) onPick(f)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDrag(true)
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrag(false)
      }}
      className={cn(
        'flex min-h-[10rem] cursor-pointer flex-col items-center justify-center border-dashed px-6 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/35',
        drag ? 'border-primary bg-primary-soft' : 'border-border-strong',
        disabled && 'opacity-60',
      )}
    >
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          e.target.value = ''
          onPick(f)
        }}
        aria-label={title}
      />
      {file ? (
        <>
          <FileText className="size-7 text-primary" aria-hidden />
          <div className="mt-2 font-medium text-foreground">{file.name}</div>
          <button
            type="button"
            className="mt-1 text-xs text-muted underline underline-offset-2 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onPick(null)
            }}
          >
            Replace
          </button>
        </>
      ) : (
        <>
          <UploadCloud className={drag ? 'size-7 text-primary' : 'size-7 text-muted'} aria-hidden />
          <div className="mt-2 font-display text-base font-light text-foreground">{title}</div>
          <p className="mt-1 text-xs text-muted">{hint}</p>
          {optional && <span className="mt-2 text-[0.7rem] font-semibold uppercase tracking-wider text-faint">Optional</span>}
        </>
      )}
    </Panel>
  )
}

function MarginOnboarding() {
  const navigate = useNavigate()
  const [usageFile, setUsageFile] = React.useState<File | null>(null)
  const [revenueFile, setRevenueFile] = React.useState<File | null>(null)
  const [stripeKey, setStripeKey] = React.useState('')
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const busy = pending !== null

  const analyze = React.useCallback(async () => {
    if (!usageFile || busy) return
    setError(null)
    setPending('Analyzing margins…')
    track('margin_scan_started', { hasRevenue: !!revenueFile })
    try {
      const csv = await readText(usageFile)
      const revenueCsv = revenueFile ? await readText(revenueFile) : undefined
      const res = await createMarginScan({ data: { csv, revenueCsv, stripeKey: stripeKey.trim() || undefined } })
      if (!res.ok) {
        setPending(null)
        setError(res.error)
        return
      }
      navigate({ to: '/m/$marginId', params: { marginId: res.id } })
    } catch {
      setPending(null)
      setError('Something went wrong analyzing your data. Please try again.')
    }
  }, [usageFile, revenueFile, stripeKey, busy, navigate])

  const sample = React.useCallback(async () => {
    if (busy) return
    setError(null)
    setPending('Loading sample…')
    try {
      const { id } = await createMarginSample()
      navigate({ to: '/m/$marginId', params: { marginId: id } })
    } catch {
      setPending(null)
      setError('Could not load the sample.')
    }
  }, [busy, navigate])

  return (
    <Container size="default" className="py-14 sm:py-20">
      <SectionHeading
        eyebrow="AI Margin Intelligence"
        title="See what's eating your AI margins"
        lead="Upload your AI usage, then add revenue (Stripe or a CSV) to turn cost into margin by customer, plan, feature, project, and model. No SDK, no proxy — metadata only."
      />

      {error && (
        <div role="alert" className="mt-8 flex items-start gap-3 rounded-lg border border-risk-ink/20 bg-risk-soft px-4 py-3 text-sm text-risk-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <div>
          <div className="eyebrow mb-3">1 · AI usage (required)</div>
          <Drop
            file={usageFile}
            onPick={setUsageFile}
            disabled={busy}
            title="Drop your usage export"
            hint="OpenAI / Anthropic / OpenRouter / gateway CSV or JSON"
          />
        </div>
        <div>
          <div className="eyebrow mb-3">2 · Revenue (unlocks margin)</div>
          <Drop
            file={revenueFile}
            onPick={setRevenueFile}
            disabled={busy || !!stripeKey.trim()}
            optional
            title="Drop a revenue CSV"
            hint="columns: customer, monthly_revenue, plan"
          />
          <div className="mt-3">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="…or paste a Stripe restricted key (rk_…)"
              value={stripeKey}
              onChange={(e) => setStripeKey(e.target.value)}
              disabled={busy}
              className="font-mono text-xs"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
            />
            <p className="mt-1 text-xs text-faint">Read-only, used once to pull MRR per customer — never stored.</p>
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted">
        Tag usage rows with a <code>customer</code> (and optionally <code>feature</code>, <code>plan</code>,{' '}
        <code>workspace</code>) column so we can attribute margin. No revenue?{' '}
        <span className="text-foreground">You'll still get Cost Intelligence + an AI Health Score</span>, then can add Stripe later.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button size="lg" onClick={analyze} disabled={!usageFile || busy} aria-busy={busy}>
          {busy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> {pending}
            </>
          ) : (
            <>
              {revenueFile || stripeKey.trim() ? 'Compute margins' : 'Analyze cost (add revenue for margin)'}
              <ArrowRight />
            </>
          )}
        </Button>
        <TrustLine />
      </div>

      <ul className="mt-10 grid gap-2.5 text-sm sm:grid-cols-2">
        {[
          'AI Margin Health Score in 30 seconds',
          'Which customers, plans & features are below cost',
          'Cost evidence behind every margin leak',
          'Actions ranked by monthly business impact',
        ].map((b) => (
          <li key={b} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-good-ink" aria-hidden />
            <span className="text-foreground">{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-12 border-t border-border pt-6 text-xs text-faint">
        Just exploring?{' '}
        <button type="button" onClick={sample} disabled={busy} className="font-medium text-muted underline underline-offset-2 hover:text-foreground disabled:opacity-50">
          Preview a sample margin dashboard
        </button>{' '}
        with anonymized example data. Cost-only works too — just skip the revenue step above.
      </div>
    </Container>
  )
}
