import posthog from 'posthog-js'
import * as Sentry from '@sentry/react'
import { clientEnv } from '@/lib/client-env'

let initialized = false

/** Initialize PostHog + Sentry on the client. No-ops without keys. */
export function initObservability() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  if (clientEnv.POSTHOG_KEY) {
    posthog.init(clientEnv.POSTHOG_KEY, {
      api_host: clientEnv.POSTHOG_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: 'identified_only',
    })
  }

  if (clientEnv.SENTRY_DSN) {
    Sentry.init({
      dsn: clientEnv.SENTRY_DSN,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
    })
  }
}

/** Funnel/event tracking. Safe to call anywhere on the client. */
export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  if (clientEnv.POSTHOG_KEY) posthog.capture(event, props)
}
