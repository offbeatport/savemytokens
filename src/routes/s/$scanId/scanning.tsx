import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, Loader2, ShieldCheck } from 'lucide-react'
import { Container } from '@/components/Container'
import { Logo } from '@/components/Logo'
import { SectionHeading, Panel } from '@/components/primitives'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/s/$scanId/scanning')({
  component: ScanningPage,
})

const STEPS = [
  'Reading usage metadata',
  'Aggregating spend by model & project',
  'Scoring AI spend health',
  'Finding savings opportunities',
] as const

const STEP_MS = 700
const SETTLE_MS = 480

function ScanningPage() {
  const { scanId } = Route.useParams()
  const navigate = useNavigate()

  // `step` is the index of the stage currently in progress; STEPS.length === done.
  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const schedule = (fn: () => void, ms: number) => {
      timers.current.push(setTimeout(fn, ms))
    }

    // Immediate nudge so the bar reads as "live" the moment the screen mounts.
    schedule(() => setProgress(8), 80)

    STEPS.forEach((_, i) => {
      schedule(() => {
        setStep(i + 1)
        setProgress(Math.round(((i + 1) / STEPS.length) * 100))
      }, (i + 1) * STEP_MS)
    })

    // Let the final checkmark land before moving to the snapshot.
    schedule(() => {
      navigate({ to: '/s/$scanId', params: { scanId } })
    }, STEPS.length * STEP_MS + SETTLE_MS)

    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [scanId, navigate])

  const complete = step >= STEPS.length
  const liveMessage = complete ? 'Scan complete. Preparing your snapshot.' : STEPS[step]

  return (
    <Container size="narrow">
      <div className="flex min-h-[72vh] flex-col items-center justify-center py-16">
        <Logo />

        <SectionHeading
          align="center"
          className="mt-9"
          eyebrow="Scanning"
          title="Analyzing your AI spend"
          lead="Crunching your usage metadata to surface where the money is going. This only takes a moment."
        />

        <Panel className="mt-10 w-full max-w-xl p-6 text-left sm:p-8">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">{complete ? 'Done' : 'Scanning…'}</span>
            <span className="tnum text-sm text-faint">{progress}%</span>
          </div>

          <Progress value={progress} className="mt-3" />

          <ol className="mt-7 space-y-1">
            {STEPS.map((label, i) => {
              const status = i < step ? 'done' : i === step ? 'active' : 'upcoming'
              return (
                <li
                  key={label}
                  aria-current={status === 'active' ? 'step' : undefined}
                  className="flex items-center gap-3 py-2"
                >
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-full border transition-colors',
                      status === 'done' && 'border-primary/25 bg-primary-soft text-primary-strong',
                      status === 'active' && 'border-border-strong text-foreground',
                      status === 'upcoming' && 'border-border text-faint',
                    )}
                  >
                    {status === 'done' ? (
                      <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
                    ) : status === 'active' ? (
                      <Loader2
                        className="size-3.5 animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                    ) : (
                      <span className="size-1.5 rounded-full bg-current" aria-hidden />
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-[0.95rem]',
                      status === 'done' && 'text-muted',
                      status === 'active' && 'font-medium text-foreground',
                      status === 'upcoming' && 'text-faint',
                    )}
                  >
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>
        </Panel>

        <p className="mt-8 inline-flex items-center gap-2 text-sm text-faint">
          <ShieldCheck className="size-4" aria-hidden />
          Analyzing usage metadata only - no prompts or responses.
        </p>

        <p className="sr-only" role="status" aria-live="polite">
          {liveMessage}
        </p>
      </div>
    </Container>
  )
}
