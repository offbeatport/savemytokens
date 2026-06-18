import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '@/lib/server/session'
import { listScans } from '@/lib/server/scans'
import { listNotify } from '@/lib/server/notify'
import { listFeedback } from '@/lib/server/feedback'
import { reportBySlug } from '@/lib/reports/catalog'
import { Container } from '@/components/Container'
import { Panel, Stat } from '@/components/primitives'
import { Badge } from '@/components/ui/badge'
import { usd, num, pct } from '@/lib/format'

export const Route = createFileRoute('/admin/')({
  beforeLoad: async () => {
    const user = await getSession()
    if (!user || !user.isAdmin) throw redirect({ to: '/login' })
  },
  loader: async () => {
    const [scans, notify, feedback] = await Promise.all([listScans(), listNotify(), listFeedback()])
    return { scans, notify, feedback }
  },
  component: AdminPage,
})

/** Epoch-ms → "Jun 6, 2026". createdAt fallbacks (0) render as an em dash. */
function fmtDate(ms: number): string {
  if (!ms) return '-'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms))
}

function reportName(slug: string): string {
  return reportBySlug(slug)?.name ?? slug
}

function AdminPage() {
  const { scans, notify, feedback } = Route.useLoaderData()

  const totalScans = scans.length
  const unlockedCount = scans.filter((s) => s.unlocked || (s.unlockedReports ?? 0) > 0).length
  const conversion = totalScans ? (unlockedCount / totalScans) * 100 : 0
  const totalReportsUnlocked = scans.reduce((acc, s) => acc + (s.unlockedReports ?? 0), 0)
  const totalSpend = scans.reduce((acc, s) => acc + (s.spendAnalyzed ?? 0), 0)
  const totalNotify = notify.length

  // Notify signups grouped by report, highest demand first.
  const notifyByReport = Array.from(
    notify.reduce((map, n) => {
      map.set(n.reportSlug, (map.get(n.reportSlug) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  )
    .map(([slug, count]) => ({ slug, count, name: reportName(slug) }))
    .sort((a, b) => b.count - a.count)

  const recentNotify = notify.slice(0, 12)

  return (
    <Container className="py-12 sm:py-16" size="wide">
      <header className="max-w-2xl">
        <div className="eyebrow mb-3">Admin</div>
        <h1>Dashboard</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Live overview of scans, unlocks, and report demand. Showing the 100 most
          recent scans and 200 most recent notify signups.
        </p>
      </header>

      {/* Top stats */}
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Panel className="p-5">
          <Stat label="Total scans" value={num(totalScans)} />
        </Panel>
        <Panel className="p-5">
          <Stat
            label="Unlocked"
            value={num(unlockedCount)}
            sub={`${num(totalReportsUnlocked)} reports · ${pct(conversion, conversion % 1 === 0 ? 0 : 1)} conv.`}
            valueClassName="text-primary"
          />
        </Panel>
        <Panel className="p-5">
          <Stat label="Notify signups" value={num(totalNotify)} />
        </Panel>
        <Panel className="p-5">
          <Stat label="Spend analyzed" value={usd(totalSpend)} />
        </Panel>
      </div>

      {/* Notify signups */}
      <section className="mt-14">
        <div className="eyebrow mb-3">Notify signups</div>
        <h2 className="text-2xl">Report demand</h2>

        {totalNotify === 0 ? (
          <Panel className="mt-6 p-8 text-center text-muted">No notify signups yet.</Panel>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* By report */}
            <Panel className="p-6">
              <h3 className="text-xs font-medium uppercase tracking-wider text-faint">
                By report
              </h3>
              <ul className="mt-4 divide-y divide-border">
                {notifyByReport.map((r) => (
                  <li
                    key={r.slug}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="text-sm text-foreground">{r.name}</span>
                    <Badge tone="primary" className="tnum">
                      {num(r.count)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Panel>

            {/* Recent signups */}
            <Panel className="p-6">
              <h3 className="text-xs font-medium uppercase tracking-wider text-faint">
                Recent signups
              </h3>
              <ul className="mt-4 divide-y divide-border">
                {recentNotify.map((n) => (
                  <li key={n.id} className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-foreground">{n.email}</div>
                      <div className="truncate text-xs text-muted">{reportName(n.reportSlug)}</div>
                    </div>
                    <time className="shrink-0 text-xs text-faint tnum">{fmtDate(n.createdAt)}</time>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )}
      </section>

      {/* Feature requests */}
      <section className="mt-14">
        <div className="eyebrow mb-3">Demand</div>
        <h2 className="text-2xl">Feature requests {feedback.length > 0 && <span className="text-muted">({feedback.length})</span>}</h2>
        {feedback.length === 0 ? (
          <Panel className="mt-6 p-8 text-center text-muted">No requests yet.</Panel>
        ) : (
          <ul className="mt-6 space-y-3">
            {feedback.map((f) => (
              <Panel key={f.id} as="li" className="p-5">
                <p className="text-sm leading-relaxed text-foreground">{f.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
                  {f.email && <span className="text-muted">{f.email}</span>}
                  {f.path && <span className="font-mono">{f.path}</span>}
                  <span className="tnum">{fmtDate(f.createdAt)}</span>
                </div>
              </Panel>
            ))}
          </ul>
        )}
      </section>

      {/* Recent scans */}
      <section className="mt-14">
        <div className="eyebrow mb-3">Activity</div>
        <h2 className="text-2xl">Recent scans</h2>

        {totalScans === 0 ? (
          <Panel className="mt-6 p-8 text-center text-muted">No scans yet.</Panel>
        ) : (
          <Panel className="mt-6 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
                    <th scope="col" className="px-5 py-3 font-medium">
                      ID
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Source
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Scenario
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      Spend
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      Score
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      Reports
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Basis
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Email
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-border last:border-0 hover:bg-surface-sunken"
                    >
                      <td className="px-5 py-3 font-mono text-xs text-faint">{s.id.slice(0, 10)}</td>
                      <td className="px-5 py-3 text-foreground">{s.source}</td>
                      <td className="px-5 py-3 text-muted">{s.scenario}</td>
                      <td className="px-5 py-3 text-right text-foreground tnum">
                        {usd(s.spendAnalyzed ?? 0)}
                      </td>
                      <td className="px-5 py-3 text-right text-foreground tnum">
                        {num(s.healthScore ?? 0)}
                      </td>
                      <td className="px-5 py-3 text-right text-muted tnum">
                        {num(s.unlockedReports ?? 0)}/5
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={s.costBasis === 'actual' ? 'primary' : 'neutral'}>
                          {s.costBasis ?? '-'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={s.unlocked || (s.unlockedReports ?? 0) > 0 ? 'good' : 'neutral'} dot>
                          {s.unlocked || (s.unlockedReports ?? 0) > 0 ? 'Unlocked' : 'Locked'}
                        </Badge>
                      </td>
                      <td className="max-w-[220px] truncate px-5 py-3 text-muted">
                        {s.email ?? '-'}
                      </td>
                      <td className="px-5 py-3 text-right text-faint tnum">{fmtDate(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </section>
    </Container>
  )
}
