import { useState } from 'react'
import { Check } from 'lucide-react'
import { subscribeNotify } from '@/lib/server/notify'
import { track } from '@/lib/analytics'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'

/** Email capture for a coming-soon report. Inline expand → submit → confirmed. */
export function NotifyButton({
  slug,
  label = 'Notify me',
  className,
}: {
  slug: string
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('loading')
    setError('')
    try {
      const r = await subscribeNotify({ data: { email, reportSlug: slug } })
      if (r.ok) {
        setState('done')
        track('notify_signup', { report: slug })
      } else {
        setState('error')
        setError(r.error ?? 'Something went wrong.')
      }
    } catch {
      setState('error')
      setError('Something went wrong.')
    }
  }

  if (state === 'done') {
    return (
      <div className={cn('inline-flex items-center gap-2 text-sm font-medium text-primary-strong', className)}>
        <Check className="size-4" />
        You&rsquo;re on the list
      </div>
    )
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }

  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-2 sm:flex-row', className)}>
      <Input
        type="email"
        required
        autoFocus
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="sm:max-w-56"
        aria-label="Email address"
      />
      <Button type="submit" size="sm" disabled={state === 'loading'}>
        {state === 'loading' ? 'Adding…' : 'Notify me'}
      </Button>
      {state === 'error' && <span className="self-center text-xs text-risk-ink">{error}</span>}
    </form>
  )
}
