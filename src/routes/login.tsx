import * as React from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Container } from '@/components/Container'
import { Panel } from '@/components/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { signIn, signUp } from '@/lib/auth-client'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

type Mode = 'signin' | 'signup'
type Pending = 'email' | 'google' | null

/** Brand mark - functional exception to the monochrome rule. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.88h3.72c2.18-2 3.44-4.96 3.44-8.37Z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.1 0 5.7-1.03 7.62-2.78l-3.72-2.88c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.74H1.7v2.97A11.5 11.5 0 0 0 12 23.5Z"
      />
      <path
        fill="#FBBC05"
        d="M5.55 14.2a6.9 6.9 0 0 1 0-4.4V6.83H1.7a11.5 11.5 0 0 0 0 10.34l3.85-2.97Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.7 1.31 15.1.25 12 .25A11.5 11.5 0 0 0 1.7 6.83L5.55 9.8C6.46 7.08 9 4.75 12 4.75Z"
      />
    </svg>
  )
}

function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = React.useState<Mode>('signin')
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [pending, setPending] = React.useState<Pending>(null)
  const [error, setError] = React.useState<string | null>(null)

  const isSignup = mode === 'signup'
  const busy = pending !== null

  function toggleMode() {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
    setError(null)
  }

  async function handleGoogle() {
    setError(null)
    setPending('google')
    try {
      const res = await signIn.social({ provider: 'google', callbackURL: '/' })
      // On success the browser redirects to Google; reaching here means a failure.
      if (res?.error) {
        setError(res.error.message ?? 'Google sign-in is unavailable right now.')
        setPending(null)
      }
    } catch {
      setError('Google sign-in is unavailable right now.')
      setPending(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setPending('email')
    try {
      const res = isSignup
        ? await signUp.email({ email, password, name, callbackURL: '/' })
        : await signIn.email({ email, password, callbackURL: '/' })

      if (res?.error) {
        setError(res.error.message ?? 'Something went wrong. Check your details and try again.')
        setPending(null)
        return
      }
      navigate({ to: '/' })
    } catch {
      setError('Something went wrong. Check your details and try again.')
      setPending(null)
    }
  }

  return (
    <Container size="narrow">
      <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center py-16 sm:py-24">
        <Panel className="w-full max-w-md bg-surface p-8 sm:p-10">
          <div className="eyebrow mb-3">{isSignup ? 'Create account' : 'Sign in'}</div>
          <h1 className="text-3xl font-light leading-tight">
            {isSignup ? 'Start saving on tokens.' : 'Welcome back.'}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {isSignup
              ? 'One account to run scans and unlock your AI cost health reports.'
              : 'Sign in to access your scans and unlocked reports.'}
          </p>

          <div className="mt-8">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={handleGoogle}
              disabled={busy}
            >
              <GoogleMark />
              {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </Button>
          </div>

          <div className="my-6 flex items-center gap-4" aria-hidden="true">
            <Separator className="flex-1" />
            <span className="text-xs font-medium uppercase tracking-wider text-faint">or</span>
            <Separator className="flex-1" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {isSignup && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Jane Founder"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={busy}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={busy}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-risk-ink">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {pending === 'email'
                ? isSignup
                  ? 'Creating account…'
                  : 'Signing in…'
                : isSignup
                  ? 'Create account'
                  : 'Sign in'}
              {pending !== 'email' && <ArrowRight />}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {isSignup ? 'Already have an account?' : 'No account yet?'}{' '}
            <button
              type="button"
              onClick={toggleMode}
              disabled={busy}
              className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
            >
              {isSignup ? 'Sign in' : 'Create one'}
            </button>
          </p>

          <div className="mt-8 flex items-center gap-1.5 border-t border-border pt-5 text-xs text-faint">
            <ShieldCheck className="size-3.5 shrink-0 text-primary" />
            <span>No prompts or responses required. We only read usage metadata.</span>
          </div>
        </Panel>

        <Link
          to="/"
          className="mt-6 text-sm font-medium text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Back to home
        </Link>
      </div>
    </Container>
  )
}
