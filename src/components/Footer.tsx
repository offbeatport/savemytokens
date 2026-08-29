import { Link } from '@tanstack/react-router'
import { Logo } from './Logo'
import { Container } from './Container'

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border">
      <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            AI Margin Intelligence. Connect your usage and revenue and see which customers, plans, and
            features are below cost — in one report. No SDK, no proxy.
          </p>
          <p className="mt-4 text-xs text-faint">Revenue + usage metadata only. Never your prompts.</p>
        </div>

        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-faint">Product</h5>
          <ul className="mt-4 space-y-2.5">
            <li>
              <Link to="/" hash="report" className="text-sm text-muted transition-colors hover:text-foreground">
                The report
              </Link>
            </li>
            <li>
              <Link to="/" hash="how" className="text-sm text-muted transition-colors hover:text-foreground">
                How it works
              </Link>
            </li>
            <li>
              <Link to="/" hash="faq" className="text-sm text-muted transition-colors hover:text-foreground">
                FAQ
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-faint">Start</h5>
          <ul className="mt-4 space-y-2.5">
            <li>
              <Link to="/margin" className="text-sm text-muted transition-colors hover:text-foreground">
                Analyze my margins
              </Link>
            </li>
            <li>
              <Link to="/login" className="text-sm text-muted transition-colors hover:text-foreground">
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      </Container>
      <Container className="flex flex-col items-center justify-between gap-3 border-t border-border py-6 text-xs text-faint sm:flex-row">
        <span>© {2026} SaveMyTokens</span>
        <span>Per-customer margin is exact; cost-optimization estimates are directional, from usage metadata only.</span>
      </Container>
    </footer>
  )
}
