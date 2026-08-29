import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  Plug,
  CreditCard,
  FileText,
  Target,
  ShieldCheck,
  TrendingDown,
  DatabaseZap,
  LayoutGrid,
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
import { usd } from '@/lib/format'
import { track } from '@/lib/analytics'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Plug,
    title: 'Connect usage',
    body: 'Drop a usage CSV or connect read-only — OpenAI, Anthropic, OpenRouter, or any gateway. Upload-first, no code.',
  },
  {
    icon: CreditCard,
    title: 'Add revenue',
    body: 'Paste a Stripe read-only key or a revenue CSV. We auto-match your usage to your customers — no manual tagging.',
  },
  {
    icon: FileText,
    title: 'Get one report',
    body: 'Margin Health Score, the per-customer margin ledger, leaks, ranked actions, cost evidence, and a CFO report — all in tabs.',
  },
  {
    icon: Target,
    title: 'Act on it',
    body: 'Every action names the customer, the dollar impact, and the exact fix. Re-scan to track margin and catch below-cost crossovers.',
  },
]

const TABS: { label: string; body: string }[] = [
  { label: 'Overview', body: 'Your Margin Health Score, top leaks, and the highest-impact actions — the 30-second answer.' },
  { label: 'Margins', body: 'The margin ledger by customer, plan, feature, project, or model — who is profitable and who is below cost.' },
  { label: 'Actions', body: 'Recommendations ranked by monthly impact × confidence × ease, each tied to a specific entity.' },
  { label: 'Risk', body: '“Who is about to go below cost,” concentration risk, and accounts that newly crossed since last period.' },
  { label: 'Cost breakdown', body: 'Spend by model, the input/output split, caching, retries — the cost evidence behind every leak.' },
  { label: 'CFO Report', body: 'Revenue/cost/margin change and a founder-ready memo. Export to PDF and send your team.' },
]

const VALUE_CARDS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Target,
    title: 'Margin, not just spend',
    body: 'We answer “who is unprofitable,” not just “how much did we spend.” Revenue → cost → margin, per customer.',
  },
  {
    icon: DatabaseZap,
    title: 'Automatic attribution',
    body: 'We map messy usage keys (acme-prod-api) to your real customers — the join a spreadsheet can’t do, even with no customer column.',
  },
  {
    icon: TrendingDown,
    title: 'Below-cost alerts',
    body: 'See exactly which customers cost more in AI than they pay you — and who newly crossed below cost since last period.',
  },
  {
    icon: ShieldCheck,
    title: 'Metadata only',
    body: 'Revenue totals + usage metadata. Never your prompts, responses, or customer data. No SDK, no proxy.',
  },
]

const INPUTS: string[] = [
  'provider, model, date',
  'customer / project / API-key label',
  'input & output token counts',
  'cost (or we estimate it from tokens)',
  'Stripe MRR by customer — read-only, optional',
]

const OUTPUTS: { t: string; d: string }[] = [
  {
    t: 'Per-customer margin ledger',
    d: 'Revenue × cost per customer, plan, feature, project and model — sortable, with a margin % and a status on each.',
  },
  {
    t: 'Below-cost accounts, named',
    d: 'Exactly which customers are unprofitable on AI, how much margin is at risk, and why.',
  },
  {
    t: 'Automatic attribution',
    d: 'We resolve usage keys to your customers automatically and surface anything we can’t match for you to confirm.',
  },
  {
    t: 'Ranked actions with receipts',
    d: 'Each fix tied to a customer/feature, ranked by monthly impact × confidence × ease, with the math shown.',
  },
  {
    t: 'Cost evidence behind every leak',
    d: 'Expensive model mix, output inflation, caching, retries — the supporting why, not the headline.',
  },
  {
    t: 'Weekly AI CFO Report',
    d: 'Revenue/cost/margin change and a founder-ready memo you can export to PDF and send to your team.',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I need Stripe?',
    a: 'No. Upload usage alone and you get Cost Intelligence plus an AI Health Score. Connect Stripe (or drop a revenue CSV) to unlock per-customer margin — who is below cost and what to do about it.',
  },
  {
    q: 'How is this different from my gateway dashboard?',
    a: 'Gateways (OpenRouter, Helicone, Vercel/Cloudflare AI Gateway) show cost by model. None of them has your revenue. Only we join cost to revenue to give you margin per customer — the number that decides pricing.',
  },
  {
    q: 'How does attribution work without a customer column?',
    a: 'Usage exports rarely carry a customer id — they carry a project/API-key label. We auto-match those to your revenue customers by name, populate the join, and surface anything ambiguous for you to confirm. No manual tagging in a spreadsheet.',
  },
  {
    q: 'Is it secure?',
    a: 'We read aggregate usage metadata and revenue totals — never your prompts, responses, or customer data. Connections are read-only and used once; you can upload CSVs instead of connecting anything.',
  },
  {
    q: 'How accurate are the numbers?',
    a: 'Per-customer margin is exact arithmetic — your revenue minus your billed AI cost. Cost-optimization estimates show a low–high range and a confidence level, and we label what is measured versus inferred so you can trust the headline.',
  },
]

const TRUST_ITEMS = ['No SDK', 'No proxy', 'Revenue + usage, never prompts', 'Read-only']

function LandingPage() {
  const navigate = useNavigate()

  function go(location: string) {
    track('cta_click', { location })
    navigate({ to: '/margin' })
  }

  return (
    <>
      {/* ───────────── HERO ───────────── */}
      <section className="pt-16 pb-20 sm:pt-24 sm:pb-28">
        <Container>
          <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-16">
            <div>
              <Badge tone="primary" dot>
                AI Margin Intelligence
              </Badge>
              <h1 className="mt-6">Know which customers, plans, and features are killing your AI margins.</h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                Connect your AI usage and revenue. We compute margin by customer, plan, feature,
                workspace, project, and model — and tell you exactly what&rsquo;s below cost and what to
                do. No SDK, no proxy.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Button size="lg" onClick={() => go('hero')}>
                  See your AI margins
                  <ArrowRight />
                </Button>
                <TrustLine />
              </div>
              <p className="mt-3 text-sm text-faint">
                No revenue yet?{' '}
                <button
                  type="button"
                  onClick={() => go('hero-cost')}
                  className="font-medium text-muted underline underline-offset-2 hover:text-foreground"
                >
                  Run a cost-only analysis
                </button>{' '}
                — add Stripe later to unlock margin.
              </p>
            </div>

            {/* Flat sample margin preview */}
            <div className="lg:pl-4">
              <Panel className="p-6 sm:p-8">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Margin snapshot</span>
                  <Badge tone="risk" dot>
                    2 below cost
                  </Badge>
                </div>
                <div className="mt-7 flex flex-col items-center gap-8 sm:flex-row sm:items-center">
                  <HealthScore score={64} band="watch" label="Watch" />
                  <div className="grid w-full flex-1 gap-5">
                    <Stat label="Gross AI margin" value="62%" sub={`${usd(18400)} of ${usd(29600)} revenue`} />
                    <Stat label="Customers below cost" value="2" sub="of 18" />
                    <Stat
                      label="Revenue at risk"
                      value={usd(4200)}
                      sub="per month"
                      valueClassName="text-2xl text-risk-ink"
                    />
                  </div>
                </div>
                <div className="mt-7 border-t border-border pt-4 text-xs text-faint">
                  Example output. Your numbers come from your own usage + revenue.
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
            title="From usage to margin in four steps."
            lead="No integration project, no sales call. Upload first, connect revenue, get one report you can act on."
          />
          <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
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
            title="Usage + revenue in. Per-customer margin, out."
            lead="No prompts, no responses, no customer data — only the aggregate fields below. We turn them into a margin number per customer, with the cost evidence and the fix."
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
                Aggregate metadata + revenue totals only. We never see your prompts, completions, or any
                customer data — upload CSVs or connect read-only.
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

      {/* ───────────── THE ONE REPORT ───────────── */}
      <section id="report" className="scroll-mt-24 border-t border-border py-20 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow="One report"
            title="Everything in one place, organized into tabs."
            lead="No five separate reports to buy, no dashboards to babysit. One scan produces one report — switch tabs to go from the 30-second answer to the receipts."
          />

          <div className="mt-7 flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="primary" dot>
              Free to run
            </Badge>
            <span className="text-faint">·</span>
            <Badge tone="neutral">Cost Intelligence on usage alone</Badge>
            <span className="text-faint">·</span>
            <Badge tone="neutral">Margin Intelligence when you connect revenue</Badge>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TABS.map((t, i) => (
              <Panel key={t.label} className="flex flex-col p-6">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 place-items-center rounded-lg border border-border text-muted">
                    <LayoutGrid className="size-4" />
                  </span>
                  <span className="font-display text-lg">{t.label}</span>
                  {i === 0 && (
                    <Badge tone="primary" size="sm">
                      default
                    </Badge>
                  )}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted">{t.body}</p>
              </Panel>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <Button size="lg" onClick={() => go('report')}>
              See your AI margins
              <ArrowRight />
            </Button>
            <TrustLine />
          </div>
        </Container>
      </section>

      {/* ───────────── WHY ───────────── */}
      <section className="border-t border-border py-20 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow="Why SaveMyTokens"
            title="The number your gateway dashboard can’t show you."
            lead="Built for founders and finance leads who need to know which customers, plans, and features are profitable — not just how many tokens they burned."
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
          <SectionHeading eyebrow="FAQ" title="Answers before you run it." align="center" />
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
          <h2>See what&rsquo;s eating your AI margins.</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Upload your usage, add revenue, get one report. Free to start — no setup, no card required.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <Button size="lg" onClick={() => go('final')}>
              See your AI margins
              <ArrowRight />
            </Button>
            <TrustLine />
          </div>
        </Container>
      </section>
    </>
  )
}
