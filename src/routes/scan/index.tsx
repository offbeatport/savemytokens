import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Loader2, UploadCloud, ShieldCheck, Cloud, ExternalLink, Check } from 'lucide-react'
import { Container } from '@/components/Container'
import { SectionHeading } from '@/components/primitives'
import { Panel } from '@/components/primitives'
import { VendorLogo } from '@/components/VendorLogos'
import { TrustLine } from '@/components/Header'
import { ProviderExportGuide } from '@/components/ProviderExportGuide'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createScan, createScanFromUpload, createScanFromConnector } from '@/lib/server/scans'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/scan/')({
  component: ScanPage,
})

const ACCEPT = '.csv,.json,.txt'

type ProviderId = 'openai' | 'anthropic' | 'gemini'

const PROVIDERS: {
  id: ProviderId
  name: string
  keyHint: string
  keyLabel: string
  keyUrl: string
  keyUrlLabel: string
  keySteps: string[]
  billing?: boolean
}[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    keyHint: 'sk-admin-…',
    keyLabel: 'OpenAI Admin key',
    keyUrl: 'https://platform.openai.com/settings/organization/admin-keys',
    keyUrlLabel: 'Open OpenAI Admin keys',
    keySteps: [
      'Open the Admin keys page above (you must be an organization owner).',
      'Click "Create new admin key", name it, and copy the sk-admin-… value.',
      'Paste it in the field above and hit Connect. We use it once, then discard it.',
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    keyHint: 'sk-ant-admin-…',
    keyLabel: 'Anthropic Admin key',
    keyUrl: 'https://console.anthropic.com/settings/admin-keys',
    keyUrlLabel: 'Open Claude Console Admin keys',
    keySteps: [
      'Open the Admin keys page above (organization admins only).',
      'Create an Admin key and copy the sk-ant-admin-… value.',
      'Paste it in the field above and hit Connect. We use it once, then discard it.',
    ],
  },
  { id: 'gemini', name: 'Gemini', keyHint: '', keyLabel: '', keyUrl: '', keyUrlLabel: '', keySteps: [], billing: true },
]

const FIELDS = [
  'provider', 'model', 'date', 'project / API key',
  'input tokens', 'output tokens', 'request count', 'total cost', 'latency / errors (if available)',
]

function StepHeader({ n, title, dim }: { n: number; title: string; dim?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
          dim ? 'bg-surface-sunken text-muted' : 'bg-primary-soft text-primary-strong',
        )}
      >
        {n}
      </span>
      <h3 className="font-display text-xl font-light text-foreground">{title}</h3>
    </div>
  )
}

function ScanPage() {
  const navigate = useNavigate()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const step2Ref = React.useRef<HTMLDivElement>(null)

  const [dragging, setDragging] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<ProviderId>('openai')
  const [apiKey, setApiKey] = React.useState('')

  const busy = pending !== null
  const provider = PROVIDERS.find((p) => p.id === selected)!

  const goToScan = React.useCallback(
    (id: string) => navigate({ to: '/s/$scanId/scanning', params: { scanId: id } }),
    [navigate],
  )

  const handleConnect = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (busy || selected === 'gemini') return
      if (apiKey.trim().length < 16) {
        setError('Paste a valid Admin key.')
        return
      }
      setError(null)
      setPending('Connecting & pulling your usage…')
      track('connect_started', { provider: selected })
      try {
        const res = await createScanFromConnector({ data: { provider: selected, apiKey: apiKey.trim() } })
        if (!res.ok) {
          setPending(null)
          setError(res.error)
          return
        }
        setApiKey('')
        goToScan(res.id)
      } catch {
        setPending(null)
        setError('Something went wrong connecting. Please try again.')
      }
    },
    [busy, selected, apiKey, goToScan],
  )

  const readFileText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
      reader.readAsText(file)
    })

  const startUpload = React.useCallback(
    async (file: File) => {
      if (busy) return
      setError(null)
      setPending('Reading your usage…')
      try {
        const text = await readFileText(file)
        if (!text.trim()) throw new Error('That file looks empty. Export your usage and try again.')
        setPending('Reading your usage…')
        track('scan_started', { source: 'upload' })
        const result = await createScanFromUpload({ data: { csv: text, filename: file.name } })
        if (!result.ok) {
          setPending(null)
          setError(result.error)
          track('upload_parse_failed', { filename: file.name })
          return
        }
        setPending('Starting scan…')
        goToScan(result.id)
      } catch (err) {
        setPending(null)
        setError(err instanceof Error ? err.message : 'We could not read that file.')
      }
    },
    [busy, goToScan],
  )

  const startSample = React.useCallback(async () => {
    if (busy) return
    setError(null)
    setPending('Loading sample…')
    try {
      track('scan_started', { source: 'sample', scenario: 'acme' })
      const result = await createScan({ data: { source: 'sample', scenario: 'acme' } })
      goToScan(result.id)
    } catch {
      setPending(null)
      setError('We could not start that scan. Please try again.')
    }
  }, [busy, goToScan])

  const openPicker = React.useCallback(() => {
    if (!busy) inputRef.current?.click()
  }, [busy])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void startUpload(file)
  }
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) void startUpload(file)
  }
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!busy) setDragging(true)
  }
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragging(false)
  }

  // The dropzone - rendered in exactly one branch at a time (single file input).
  const uploadBox = (
    <div
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-label="Upload a usage export file"
      onClick={openPicker}
      onKeyDown={(e) => {
        if (!busy && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          openPicker()
        }
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      data-dragging={dragging || undefined}
      className={cn(
        'flex min-h-[12rem] items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/35',
        busy ? 'cursor-default' : 'cursor-pointer',
        dragging ? 'border-primary bg-primary-soft' : 'border-border-strong',
      )}
    >
      <input ref={inputRef} type="file" accept={ACCEPT} onChange={onInputChange} disabled={busy} className="sr-only" aria-label="Choose a usage export file" tabIndex={-1} />
      <div className="flex flex-col items-center">
        <UploadCloud className={dragging ? 'size-8 text-primary' : 'size-8 text-muted'} aria-hidden="true" />
        <h4 className="mt-3 font-display text-lg font-light text-foreground">
          {busy ? pending : dragging ? 'Drop to upload' : 'Drag & drop your CSV / JSON'}
        </h4>
        {!busy && !dragging && (
          <p className="mt-1.5 text-sm text-muted">
            or{' '}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                openPicker()
              }}
              className="font-medium text-primary hover:underline"
            >
              choose a file
            </button>
          </p>
        )}
      </div>
    </div>
  )

  const weReadOnly = (
    <p className="mt-4 text-sm leading-relaxed text-muted">
      <span className="font-medium text-foreground">We read only:</span> {FIELDS.join(' · ')}.
    </p>
  )

  return (
    <Container size="default" className="py-14 sm:py-20">
      <SectionHeading
        eyebrow="Step 1 of 3"
        title="Connect or upload your usage"
        lead="Pick your provider, then connect read-only with an Admin key, or drop in an export. We only read usage metadata, never prompts or responses."
      />

      {error && (
        <div
          role="alert"
          className="mt-8 flex items-start gap-3 rounded-lg border border-risk-ink/20 bg-risk-soft px-4 py-3 text-sm text-risk-ink"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* STEP 1 - pick a provider */}
      <section className="mt-10">
        <StepHeader n={1} title="Which provider do you use?" />
        <div className="mt-5 grid grid-cols-3 gap-3 sm:max-w-2xl" role="radiogroup" aria-label="Choose a provider">
          {PROVIDERS.map((p) => {
            const active = p.id === selected
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => {
                  setSelected(p.id)
                  setError(null)
                  setApiKey('')
                }}
                className={cn(
                  'relative flex flex-col items-center gap-3 rounded-xl border px-3 py-6 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
                  active ? 'border-primary bg-primary-soft/50' : 'border-border hover:border-border-strong hover:bg-surface-sunken/40',
                  busy && 'opacity-60',
                )}
              >
                <VendorLogo vendor={p.id} className="h-8 w-8" />
                <span className="text-sm font-medium text-foreground">{p.name}</span>
                {active && (
                  <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" aria-hidden />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* STEP 2 - connect or upload (contextual to the provider) */}
      <section ref={step2Ref} className="mt-12 scroll-mt-24">
        <StepHeader
          n={2}
          title={provider.billing ? `Upload your ${provider.name} export` : `Connect ${provider.name}, or upload an export`}
        />

        {provider.billing ? (
          /* Gemini - upload only */
          <div className="mt-5">
            <Panel className="flex items-start gap-3 p-5">
              <Cloud className="mt-0.5 size-5 shrink-0 text-muted" />
              <p className="text-sm leading-relaxed text-muted">
                Gemini API usage is billed through Google Cloud, so there&rsquo;s no usage key to
                paste. Export a Cloud Billing report and drop it below - we&rsquo;ll do the rest.
              </p>
            </Panel>
            <div className="mt-6 grid items-start gap-8 lg:grid-cols-2">
              <div>
                {uploadBox}
                {weReadOnly}
              </div>
              <div>
                <div className="eyebrow mb-3">How to export from Gemini</div>
                <ProviderExportGuide only="gemini" />
              </div>
            </div>
          </div>
        ) : (
          /* OpenAI / Anthropic - connect | OR | upload */
          <div className="mt-6 grid items-start gap-x-8 gap-y-8 lg:grid-cols-[1fr_auto_1fr]">
            {/* connect with key */}
            <div>
              <div className="eyebrow mb-3">Connect automatically</div>
              <form onSubmit={handleConnect}>
                <Panel className="p-6">
                  <label htmlFor="api-key" className="text-sm font-medium text-foreground">
                    {provider.keyLabel}
                  </label>
                  <div className="mt-2 flex flex-col gap-2">
                    <Input
                      id="api-key"
                      type="password"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder={provider.keyHint}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      disabled={busy}
                      className="font-mono"
                      // Suppress browser "save password" + password-manager prompts:
                      // this is a one-time, never-stored secret, not a credential.
                      data-1p-ignore
                      data-lpignore="true"
                      data-bwignore
                      data-form-type="other"
                    />
                    <Button type="submit" disabled={busy} className="w-full">
                      {busy ? (
                        <>
                          <Loader2 className="animate-spin" aria-hidden /> Connecting…
                        </>
                      ) : (
                        <>
                          Connect {provider.name}
                          <ArrowRight />
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Read-only. Your key is used once on our server to pull your last 30 days, then
                    discarded - never stored. Tip: create a dedicated Admin key and revoke it after.
                  </p>
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="eyebrow mb-3">How to get your key</div>
                    <a
                      href={provider.keyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
                    >
                      {provider.keyUrlLabel}
                      <ExternalLink aria-hidden />
                    </a>
                    <ol className="mt-4 space-y-3">
                      {provider.keySteps.map((step, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border text-[0.7rem] font-semibold tnum text-muted">
                            {i + 1}
                          </span>
                          <span className="leading-relaxed text-muted">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </Panel>
              </form>
            </div>

            {/* OR divider */}
            <div className="relative flex items-center justify-center py-1 lg:self-stretch lg:py-0">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border lg:hidden" />
              <div className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-border lg:block" />
              <span className="relative grid size-11 place-items-center rounded-full border border-border bg-background text-xs font-semibold uppercase tracking-wider text-muted">
                or
              </span>
            </div>

            {/* upload an export */}
            <div>
              <div className="eyebrow mb-3">Upload an export</div>
              {uploadBox}
              {weReadOnly}
              <div className="mt-6">
                <div className="eyebrow mb-3">How to export from {provider.name}</div>
                <ProviderExportGuide only={selected} />
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="mt-10 flex justify-center">
        <TrustLine />
      </div>

      {/* Subtle sample */}
      <div className="mt-12 border-t border-border pt-6">
        <p className="text-xs text-faint">
          Just exploring?{' '}
          <button
            type="button"
            onClick={() => void startSample()}
            disabled={busy}
            className="font-medium text-muted underline underline-offset-2 transition-colors hover:text-foreground disabled:opacity-50"
          >
            Preview a sample report
          </button>{' '}
          with anonymized example data - not your usage.
        </p>
      </div>
    </Container>
  )
}
