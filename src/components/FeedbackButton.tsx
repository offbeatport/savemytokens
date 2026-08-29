import * as React from 'react'
import { MessageSquarePlus, Check, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { submitFeedback } from '@/lib/server/feedback'
import { track } from '@/lib/analytics'

type State = 'idle' | 'loading' | 'done' | 'error'

export function FeedbackButton() {
  const [open, setOpen] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [state, setState] = React.useState<State>('idle')
  const [error, setError] = React.useState('')

  function reset() {
    setMessage('')
    setEmail('')
    setState('idle')
    setError('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (message.trim().length < 3) {
      setError('Please add a little more detail.')
      setState('error')
      return
    }
    setState('loading')
    setError('')
    try {
      const path = typeof window !== 'undefined' ? window.location.pathname : undefined
      const res = await submitFeedback({ data: { message: message.trim(), email: email.trim() || undefined, path } })
      if (res.ok) {
        setState('done')
        track('feedback_submitted', { path })
      } else {
        setState('error')
        setError(res.error ?? 'Something went wrong.')
      }
    } catch {
      setState('error')
      setError('Something went wrong. Please try again.')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset()
          setOpen(true)
        }}
        className="no-print fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-sunken"
        aria-label="Request a report or feature"
      >
        <MessageSquarePlus className="size-4 text-primary" aria-hidden />
        <span className="hidden sm:inline">Request a report</span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(o: boolean) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent>
          {state === 'done' ? (
            <div className="py-4 text-center">
              <div className="mx-auto grid size-11 place-items-center rounded-full bg-good-soft text-good-ink">
                <Check className="size-5" />
              </div>
              <DialogTitle className="mt-4">Thanks - we read every one.</DialogTitle>
              <DialogDescription className="mt-1.5">
                Your request helps decide what we build next.
              </DialogDescription>
              <Button className="mt-6" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <DialogTitle>What would make this more useful?</DialogTitle>
              <DialogDescription>
                A report, a connector, an integration, a feature - tell us what you need and we&rsquo;ll
                prioritize it.
              </DialogDescription>

              <div className="mt-5">
                <Label htmlFor="fb-message">Your request</Label>
                <textarea
                  id="fb-message"
                  rows={4}
                  required
                  autoFocus
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. “Alert me on Slack when daily spend spikes”, or “add an Azure OpenAI connector”."
                  className="mt-1.5 w-full resize-y rounded-lg border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-faint outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                />
              </div>

              <div className="mt-4">
                <Label htmlFor="fb-email">
                  Email <span className="font-normal text-faint">(optional - if you want a reply)</span>
                </Label>
                <Input
                  id="fb-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5"
                />
              </div>

              {state === 'error' && (
                <p role="alert" className="mt-3 text-sm text-risk-ink">
                  {error}
                </p>
              )}

              <div className="mt-6 flex items-center justify-end gap-3">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={state === 'loading'}>
                  {state === 'loading' ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden /> Sending…
                    </>
                  ) : (
                    'Send request'
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
