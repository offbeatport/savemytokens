import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel } from '@/components/ui/tabs'
import { buttonVariants } from '@/components/ui/button'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'

interface Guide {
  key: string
  label: string
  link: { href: string; label: string }
  steps: React.ReactNode[]
  note?: React.ReactNode
  api?: { intro: React.ReactNode; keyHref: string; keyLabel: string; code: string }
}

const GUIDES: Guide[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    link: { href: 'https://platform.openai.com/usage', label: 'Open OpenAI Usage' },
    steps: [
      <>
        Go to the <strong>Usage</strong> dashboard (Settings → Organization → Usage). You need to be
        an organization <strong>owner</strong> to export.
      </>,
      <>
        Set the date range to the <strong>last 30 days</strong> (or a billing cycle). Optionally
        filter to a single project.
      </>,
      <>
        Click <strong>Export</strong> and choose the <strong>usage</strong> (activity) export - it
        gives a CSV broken out by date, model, and project.
      </>,
      <>Drag the downloaded CSV into the box above. That&rsquo;s it.</>,
    ],
    note: (
      <>
        OpenAI&rsquo;s usage export may arrive split into a few files for long ranges - upload the
        largest one, or use the API path below for everything in one go.
      </>
    ),
    api: {
      intro: (
        <>
          Pull a clean 30-day CSV directly from the Usage API (grouped by model &amp; project). You
          need an <strong>Admin key</strong> (<code>sk-admin-…</code>).
        </>
      ),
      keyHref: 'https://platform.openai.com/settings/organization/admin-keys',
      keyLabel: 'Create an OpenAI Admin key',
      code: `OPENAI_ADMIN_KEY=sk-admin-... \\
  node scripts/openai-usage.mjs > openai-usage.csv
# then drag openai-usage.csv into the box above`,
    },
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    link: { href: 'https://console.anthropic.com/settings/usage', label: 'Open Claude Console Usage' },
    steps: [
      <>
        Open the <strong>Usage</strong> page in the Claude Console (Settings → Usage). The{' '}
        <strong>Cost</strong> page works too.
      </>,
      <>
        Filter by workspace, model, and month as needed - the table updates to match your selection.
      </>,
      <>
        Click <strong>Export</strong> to download a CSV of the displayed usage (by day, model, and
        API key).
      </>,
      <>Drag the CSV into the box above.</>,
    ],
    api: {
      intro: (
        <>
          For automation, use the Usage &amp; Cost Admin API with an <strong>Admin key</strong> (
          <code>sk-ant-admin…</code>) - endpoint{' '}
          <code>/v1/organizations/usage_report/messages</code>. Export the JSON and drag it in
          (we read it directly).
        </>
      ),
      keyHref: 'https://console.anthropic.com/settings/admin-keys',
      keyLabel: 'Create an Anthropic Admin key',
      code: `curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\\
starting_at=2026-05-01T00:00:00Z&bucket_width=1d&group_by[]=model&group_by[]=workspace_id" \\
  -H "x-api-key: $ANTHROPIC_ADMIN_KEY" \\
  -H "anthropic-version: 2023-06-01" > anthropic-usage.json`,
    },
  },
  {
    key: 'gemini',
    label: 'Gemini',
    link: { href: 'https://console.cloud.google.com/billing', label: 'Open Google Cloud Billing' },
    steps: [
      <>
        Gemini API spend is billed through <strong>Google Cloud Billing</strong>. For a quick view,
        AI Studio → <strong>Dashboard → Usage &amp; limits</strong> shows a daily cost breakdown by
        project and model.
      </>,
      <>
        For an export, open <strong>Cloud Billing → Reports</strong>, filter the service to the{' '}
        <strong>Gemini API</strong>, and set the date range.
      </>,
      <>
        Use <strong>Download CSV</strong> on the report, then drag it into the box above.
      </>,
      <>
        The Cloud Billing CSV is cost-oriented; if it has no token columns we still break spend down
        by model. For token detail, add a BigQuery billing export.
      </>,
    ],
  },
]

function GuideBody({ g }: { g: Guide }) {
  return (
    <>
      <a
        href={g.link.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track('export_link_click', { provider: g.key })}
        className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
      >
        {g.link.label}
        <ExternalLink aria-hidden />
      </a>

      <ol className="mt-6 space-y-4">
        {g.steps.map((step, i) => (
          <li key={i} className="flex gap-3.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold tnum text-muted">
              {i + 1}
            </span>
            <span className="pt-0.5 leading-relaxed text-muted">{step}</span>
          </li>
        ))}
      </ol>

      {g.note && <p className="mt-5 text-sm leading-relaxed text-faint">{g.note}</p>}
    </>
  )
}

/** Pass `only="openai|anthropic|gemini"` to render a single provider's steps
 * without the tab bar (used inline once a provider is chosen). */
export function ProviderExportGuide({ only }: { only?: string } = {}) {
  if (only) {
    const g = GUIDES.find((x) => x.key === only)
    return g ? <GuideBody g={g} /> : null
  }
  return (
    <Tabs defaultValue="openai" onValueChange={(v) => track('export_guide_view', { provider: v })}>
      <TabsList>
        <TabsIndicator />
        {GUIDES.map((g) => (
          <TabsTab key={g.key} value={g.key}>
            {g.label}
          </TabsTab>
        ))}
      </TabsList>
      {GUIDES.map((g) => (
        <TabsPanel key={g.key} value={g.key}>
          <GuideBody g={g} />
        </TabsPanel>
      ))}
    </Tabs>
  )
}
