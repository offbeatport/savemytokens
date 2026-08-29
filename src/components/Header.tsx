import { Link, useRouter } from '@tanstack/react-router'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Logo } from './Logo'
import { Container } from './Container'
import { Button } from './ui/button'
import { useSession, signOut } from '@/lib/auth-client'
import { ThemeToggle } from './ThemeToggle'
import { track } from '@/lib/analytics'

const NAV = [
  { label: 'How it works', to: '/', hash: 'how' },
  { label: 'The report', to: '/', hash: 'report' },
  { label: 'FAQ', to: '/', hash: 'faq' },
] as const

export function Header() {
  const { data: session } = useSession()
  const router = useRouter()
  const user = session?.user

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              hash={n.hash}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              {(session as { user?: { email?: string } })?.user?.email && (
                <Link
                  to="/admin"
                  className="hidden text-sm font-medium text-muted transition-colors hover:text-foreground sm:block"
                >
                  Admin
                </Link>
              )}
              <button
                onClick={() => signOut()}
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground sm:block"
              >
                Sign out
              </button>
              <span className="grid size-9 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-strong">
                {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
              </span>
            </>
          ) : (
            <Link
              to="/login"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground sm:block"
            >
              Sign in
            </Link>
          )}
          <Button
            size="sm"
            onClick={() => {
              track('cta_click', { location: 'header' })
              router.navigate({ to: '/margin' })
            }}
          >
            See your margins
            <ArrowRight />
          </Button>
        </div>
      </Container>
    </header>
  )
}

export function TrustLine({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm text-muted ${className ?? ''}`}>
      <ShieldCheck className="size-4 text-primary" />
      No prompts or responses required.
    </span>
  )
}
