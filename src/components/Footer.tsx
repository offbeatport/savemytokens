import { Link } from '@tanstack/react-router'
import { Logo } from './Logo'
import { Container } from './Container'
import { REPORTS } from '@/lib/reports/catalog'

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border">
      <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            A one-time AI cost savings scan. Find ways to cut your AI bill in minutes - no setup,
            no SDK, no dashboard.
          </p>
          <p className="mt-4 text-xs text-faint">No prompts or responses required.</p>
        </div>

        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-faint">Reports</h5>
          <ul className="mt-4 space-y-2.5">
            {REPORTS.map((r) => (
              <li key={r.slug}>
                <Link
                  to="/"
                  hash="reports"
                  className="text-sm text-muted transition-colors hover:text-foreground"
                >
                  {r.name}
                  {r.status === 'coming-soon' && (
                    <span className="ml-1.5 text-[0.65rem] text-faint">soon</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-faint">Start</h5>
          <ul className="mt-4 space-y-2.5">
            <li>
              <Link to="/scan" className="text-sm text-muted transition-colors hover:text-foreground">
                Run a free scan
              </Link>
            </li>
            <li>
              <Link to="/" hash="how" className="text-sm text-muted transition-colors hover:text-foreground">
                How it works
              </Link>
            </li>
            <li>
              <Link to="/" hash="pricing" className="text-sm text-muted transition-colors hover:text-foreground">
                Pricing
              </Link>
            </li>
          </ul>
        </div>
      </Container>
      <Container className="flex flex-col items-center justify-between gap-3 border-t border-border py-6 text-xs text-faint sm:flex-row">
        <span>© {2026} SaveMyTokens</span>
        <span>Estimates are directional, based on usage metadata only.</span>
      </Container>
    </footer>
  )
}
