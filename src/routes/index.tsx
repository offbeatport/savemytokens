import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  Plug,
  ScanLine,
  Eye,
  CreditCard,
  FileText,
  Target,
  FileSignature,
  ShieldCheck,
  HeartPulse,
  TrendingDown,
  Scissors,
  DatabaseZap,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { Container } from '@/components/Container'
import { Panel, Stat, SectionHeading } from '@/components/primitives'
import { HealthScore } from '@/components/HealthScore'
import { TrustLine } from '@/components/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from '@/components/ui/accordion'
import {
  LIVE_REPORT,
  REPORTS,
  REPORT_PRICE,
  BUNDLE_PRICE,
  PAID_REPORT_COUNT,
} from '@/lib/reports/catalog'
import { usd, usdRange } from '@/lib/format'
import { track } from '@/lib/analytics'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

/** lucide icons keyed by ReportProduct.icon */
const REPORT_ICONS: Record<string, LucideIcon> = {
  HeartPulse,
  TrendingDown,
  Scissors,
  DatabaseZap,
  Workflow,
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Plug,
    title: 'Connect',
    body: 'Connect your provider read-only, or drop in a usage CSV. Upload-first - no code.',
  },
  {
    icon: ScanLine,
    title: 'Scan',
    body: 'We analyze spend by model, project, and token type - deterministically, in seconds.',
  },
  {
    icon: Eye,
    title: 'Free Preview',
    body: 'See your health score, estimated savings, and a sample opportunity. Free.',
  },
  {
    icon: CreditCard,
    title: 'Pay',
    body: `A one-time ${usd(REPORT_PRICE)} unlocks the full report. No subscription, ever.`,
  },
  {
    icon: FileText,
    title: 'Full Report',
    body: 'Ranked fixes, exact affected projects and models, and a founder-ready memo.',
  },
]

const VALUE_CARDS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Target,
    title: 'Exact fixes, not vibes',
    body: 'Every recommendation names the model, the project, and the precise change to make.',
  },
  {
    icon: Plug,
    title: 'Zero integration',
    body: 'No SDK, no proxy, no code changes. Upload a CSV or connect read-only and you are done.',
  },
  {
    icon: FileSignature,
    title: 'Founder-ready memo',
    body: 'A clear, concrete summary you can paste straight to your team or your investors.',
  },
  {
    icon: ShieldCheck,
    title: 'Diagnosis even if healthy',
    body: 'If nothing is leaking, you learn what is working and where not to waste engineering time.',
  },
]

// Exactly what we ingest (left) and exactly what comes back (right).
const INPUTS: string[] = [
  'provider, model, date',
  'project / API-key label',
  'input & output token counts',
  'request counts & error counts',
  'cost (or we estimate it from tokens)',
]

const OUTPUTS: { t: string; d: string }[] = [
  {
    t: 'Your spend, decoded',
    d: 'Cost by model and by project, the input-vs-output split, and the cost-per-request for each.',
  },
  {
    t: 'Cheaper-model math',
    d: 'e.g. gpt-4o at $0.0128/req vs gpt-4o-mini at $0.0008/req — and how much moving suitable traffic saves.',
  },
  {
    t: 'Ranked fixes, with receipts',
    d: 'Each opportunity names the model, the project, the math behind it, and the exact change to make.',
  },
  {
    t: 'A leak ledger',
    d: 'Every lever added up to one recoverable number — per month and annualized.',
  },
  {
    t: 'A founder-ready memo',
    d: 'A concrete summary you can paste straight to your team or your investors.',
  },
  {
    t: 'Honest limits',
    d: 'What the scan can and cannot see from metadata — so you trust the numbers that are here.',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What data do you need?',
    a: 'Only aggregate usage fields: provider, model, date, project or API-key label, input and output token counts, request counts, and cost. We never see your prompts, completions, or any customer data.',
  },
  {
    q: 'Is it secure?',
    a: 'Yes. We ingest only the usage fields above - no prompts or responses ever leave your side. Connections are read-only, and you can upload a CSV instead of connecting anything at all.',
  },
  {
    q: 'How accurate are the estimates?',
    a: 'Estimates are ranges derived deterministically from your real usage and current provider pricing. Every finding shows a low–high band and a confidence level so you can prioritize with eyes open.',
  },
  {
    q: 'What if no savings are found?',
    a: 'You still get value. The paid report tells you what is already working, what to monitor, the budget thresholds to watch, and where not to waste engineering time chasing savings that are not there.',
  },
  {
    q: 'Refunds and one-time pricing?',
    a: `Every report is a one-time ${usd(REPORT_PRICE)} - no subscription and no seat fees. The initial scan is free, so you see your health score and estimated savings before you ever pay.`,
  },
]

const TRUST_ITEMS = ['No SDK', 'No proxy', 'No dashboard', 'No prompts or responses']

function LandingPage() {
  const navigate = useNavigate()

  function runScan(location: string) {
    track('cta_click', { location })
    navigate({ to: '/scan' })
  }

  const LiveIcon = REPORT_ICONS[LIVE_REPORT.icon] ?? HeartPulse

  return (
    <>
      {/* ───────────── HERO ───────────── */}
      <section className="pt-16 pb-20 sm:pt-24 sm:pb-28">
        <Container>
          <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-16">
            <div>
              <Badge tone="primary" dot>
                Free spend snapshot
              </Badge>
              <h1 className="mt-6">Find ways to cut your AI bill in minutes.</h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                One-time scan. No setup, no SDK, no dashboard. Get clear savings recommendations,
                estimated impact, and exact fixes to reduce LLM spend.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Button size="lg" onClick={() => runScan('hero')}>
                  Run Free Scan
                  <ArrowRight />
                </Button>
                <TrustLine />
              </div>
            </div>

            {/* Flat sample snapshot preview */}
            <div className="lg:pl-4">
              <Panel className="p-6 sm:p-8">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Spend snapshot</span>
                  <Badge tone="watch" dot>
                    Worth a look
                  </Badge>
                </div>
                <div className="mt-7 flex flex-col items-center gap-8 sm:flex-row sm:items-center">
                  <HealthScore score={58} band="watch" label="Worth a look" />
                  <div className="grid w-full flex-1 gap-5">
                    <Stat label="Spend analyzed" value={usd(8420)} />
                    <Stat label="Opportunities" value="6" sub="across models & projects" />
                    <Stat
                      label="Est. savings"
                      value={usdRange(1900, 4600)}
                      sub="per month, estimated"
                      valueClassName="text-2xl text-primary"
                    />
                  </div>
                </div>
                <div className="mt-7 border-t border-border pt-4 text-xs text-faint">
                  Example output. Your numbers come from your own usage.
                </div>
              </Panel>
            </div>
          </div>
        </Container>
      </section>

      {/* ───────────── TRUST STRIP ───────────── */}
      <section className="border-y border-border bg-surface-sunken/40">
        <Container>
          <ul className="flex flex-wrap items-center justify-center divide-x divide-border py-5 text-sm font-medium text-muted">
            {TRUST_ITEMS.map((item) => (
              <li key={item} className="px-5 py-1 sm:px-7">
                {item}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ───────────── HOW IT WORKS ───────────── */}
      <section id="how" className="scroll-mt-24 py-20 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="From usage to fixes in five steps."
            lead="No integration project, no waiting on a sales call. Scan first, decide after you see the savings."
          />
          <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
            {STEPS.map((step, i) => {
              const Icon = step.icon
              return (
                <li key={step.title} className="relative">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-3xl font-light tnum text-faint">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="grid size-9 place-items-center rounded-lg border border-border text-muted">
                      <Icon className="size-4" />
                    </span>
                  </div>
                  <h3 className="mt-4 text-xl">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
                </li>
              )
            })}
          </ol>
        </Container>
      </section>

      {/* ───────────── WHAT YOU GIVE / WHAT YOU GET ───────────── */}
      <section id="what-you-get" className="scroll-mt-24 border-t border-border py-20 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow="What you give, what you get"
            title="A CSV of usage metadata in. A decision you can act on, out."
            lead="No prompts, no responses, no customer data — only the aggregate fields below. We turn them into ranked, dollar-quantified fixes with the math shown."
          />
          <div className="mt-12 grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-8">
            {/* Inputs */}
            <Panel className="flex flex-col p-7">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-lg border border-border text-muted">
                  <DatabaseZap className="size-4" />
                </span>
                <h3 className="text-lg">What you hand over</h3>
              </div>
              <ul className="mt-6 space-y-2.5">
                {INPUTS.map((field) => (
                  <li key={field} className="flex items-center gap-2.5 text-sm">
                    <span className="size-1.5 shrink-0 rounded-full bg-faint" />
                    <code className="font-mono text-[0.82rem] text-muted">{field}</code>
                  </li>
                ))}
              </ul>
              <div className="mt-auto border-t border-border pt-5 text-xs leading-relaxed text-faint">
                Aggregate usage metadata only. We never see your prompts, completions, or any customer
                data — upload a CSV or connect read-only.
              </div>
            </Panel>

            {/* Outputs */}
            <Panel className="p-7">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-lg border border-primary/40 text-primary">
                  <FileText className="size-4" />
                </span>
                <h3 className="text-lg">What you walk away with</h3>
              </div>
              <ul className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {OUTPUTS.map((o) => (
                  <li key={o.t} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <div className="text-sm font-medium text-foreground">{o.t}</div>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{o.d}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </Container>
      </section>

      {/* ───────────── REPORTS SUITE + PRICING ───────────── */}
      <section id="reports" className="scroll-mt-24 border-t border-border py-20 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow="Reports suite & pricing"
            title="One free scan to begin. Five reports, $99 each."
            lead={`Start free. One scan powers all ${PAID_REPORT_COUNT} reports - unlock any for a one-time ${usd(REPORT_PRICE)}, or the whole suite for ${usd(BUNDLE_PRICE)}. No subscription, no seat fees.`}
          />
          <div
            id="pricing"
            className="mt-7 flex scroll-mt-24 flex-wrap items-center gap-3 text-sm"
          >
            <Badge tone="primary" dot>
              1 free scan
            </Badge>
            <span className="text-faint">+</span>
            <Badge tone="neutral">
              {PAID_REPORT_COUNT} reports · {usd(REPORT_PRICE)} each
            </Badge>
            <span className="text-faint">·</span>
            <Badge tone="neutral">all {PAID_REPORT_COUNT} for {usd(BUNDLE_PRICE)}</Badge>
          </div>

          {/* Featured LIVE report */}
          <Panel className="mt-10 border-primary/40 p-7 sm:p-10">
            <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr] lg:items-center">
              <div>
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl border border-primary/40 text-primary">
                    <LiveIcon className="size-5" />
                  </span>
                  <Badge tone="primary" dot>
                    Available now
                  </Badge>
                </div>
                <h3 className="mt-5">{LIVE_REPORT.name}</h3>
                <p className="mt-1.5 text-muted">{LIVE_REPORT.tagline}</p>
                <p className="mt-4 max-w-xl leading-relaxed text-muted">
                  {LIVE_REPORT.description}
                </p>
                <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
                  {LIVE_REPORT.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col items-start gap-4 lg:border-l lg:border-border lg:pl-10">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl font-light tnum text-foreground">
                    Free
                  </span>
                  <span className="text-muted">scan to begin</span>
                </div>
                <Button size="lg" className="w-full sm:w-auto" onClick={() => runScan('reports')}>
                  Run Free Scan
                  <ArrowRight />
                </Button>
                <p className="text-sm text-muted">
                  then <span className="tnum font-medium text-foreground">{usd(REPORT_PRICE)}</span>{' '}
                  to unlock
                </p>
                <TrustLine />
              </div>
            </div>
          </Panel>

          {/* The other 4 reports - all live, all from the same scan */}
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {REPORTS.filter((r) => r.slug !== LIVE_REPORT.slug).map((r) => {
              const Icon = REPORT_ICONS[r.icon] ?? FileText
              return (
                <Panel key={r.slug} className="flex flex-col p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-lg border border-border text-muted">
                      <Icon className="size-5" />
                    </span>
                    <Badge tone="neutral">{usd(REPORT_PRICE)} · one-time</Badge>
                  </div>
                  <h3 className="mt-5 text-xl">{r.name}</h3>
                  <p className="mt-1 text-sm font-medium text-muted">{r.tagline}</p>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{r.description}</p>
                  <ul className="mt-4 space-y-2">
                    {r.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-sm text-foreground">
                        <span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-6">
                    <Button variant="secondary" size="sm" onClick={() => runScan('reports-grid')}>
                      Run Free Scan
                      <ArrowRight />
                    </Button>
                  </div>
                </Panel>
              )
            })}
          </div>
        </Container>
      </section>

      {/* ───────────── WHY / WHAT YOU GET ───────────── */}
      <section className="border-t border-border py-20 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow="Why SaveMyTokens"
            title="A decision you can act on, not a dashboard to babysit."
            lead="Built for founders and engineering leads who want the answer, not another tool to maintain."
          />
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE_CARDS.map((card) => {
              const Icon = card.icon
              return (
                <Panel key={card.title} className="p-6">
                  <span className="grid size-10 place-items-center rounded-lg border border-border text-muted">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-5 text-lg">{card.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{card.body}</p>
                </Panel>
              )
            })}
          </div>
        </Container>
      </section>

      {/* ───────────── FAQ ───────────── */}
      <section id="faq" className="scroll-mt-24 border-t border-border py-20 sm:py-28">
        <Container size="narrow">
          <SectionHeading
            eyebrow="FAQ"
            title="Answers before you scan."
            align="center"
          />
          <div className="mt-12">
            <Accordion className="divide-y divide-border border-y border-border">
              {FAQ.map((item, i) => (
                <AccordionItem key={item.q} value={String(i)}>
                  <AccordionTrigger className="font-display text-lg text-foreground">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionPanel>
                    <p className="pb-5 text-sm leading-relaxed text-muted">{item.a}</p>
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </Container>
      </section>

      {/* ───────────── FINAL CTA ───────────── */}
      <section className="border-t border-border py-20 sm:py-28">
        <Container size="narrow" className="text-center">
          <h2>Find ways to cut your AI bill in minutes.</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Run the free scan, see your savings, then decide. No setup and no card required to start.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <Button size="lg" onClick={() => runScan('final')}>
              Run Free Scan
              <ArrowRight />
            </Button>
            <TrustLine />
          </div>
        </Container>
      </section>
    </>
  )
}
