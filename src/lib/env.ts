/**
 * SERVER-ONLY environment access.
 * Reads process.env - never import this from a client component.
 * Client-safe values live in `client-env.ts`.
 */

function str(key: string, fallback = ''): string {
  // Guard so this module is harmless if it ever ends up in a client bundle
  // (no `process` in the browser). Server reads real values; client gets
  // fallbacks. Never embeds secret values either way.
  if (typeof process === 'undefined' || !process.env) return fallback
  return process.env[key] ?? fallback
}

export const env = {
  APP_URL: str('APP_URL', 'http://localhost:3000'),
  SQLITE_PATH: str('SQLITE_PATH', './data/savemytokens.db'),

  BETTER_AUTH_SECRET: str('BETTER_AUTH_SECRET', 'dev-only-insecure-secret'),
  BETTER_AUTH_URL: str('BETTER_AUTH_URL', 'http://localhost:3000'),
  GOOGLE_CLIENT_ID: str('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: str('GOOGLE_CLIENT_SECRET'),

  ADMIN_EMAILS: str('ADMIN_EMAILS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  POLAR_ACCESS_TOKEN: str('POLAR_ACCESS_TOKEN'),
  POLAR_WEBHOOK_SECRET: str('POLAR_WEBHOOK_SECRET'),
  POLAR_SERVER: (str('POLAR_SERVER', 'sandbox') as 'sandbox' | 'production'),
  // Per-report Polar product ids (ai-cost-health reuses the original var).
  POLAR_PRODUCT_ID: {
    'ai-cost-health': str('POLAR_PRODUCT_ID_HEALTH'),
    'model-output-waste': str('POLAR_PRODUCT_ID_OUTPUT'),
    'prompt-cache-readiness': str('POLAR_PRODUCT_ID_CACHE'),
    'ai-margin-leak': str('POLAR_PRODUCT_ID_MARGIN'),
    'agent-waste-detector': str('POLAR_PRODUCT_ID_AGENT'),
  } as Record<string, string>,
  POLAR_PRODUCT_ID_BUNDLE: str('POLAR_PRODUCT_ID_BUNDLE'),

  OPENROUTER_API_KEY: str('OPENROUTER_API_KEY'),
  OPENROUTER_MODEL: str('OPENROUTER_MODEL', 'google/gemini-3.1-flash-lite-preview'),

  SENTRY_DSN: str('SENTRY_DSN'),
}

/** True when Polar is wired up for a given report (or bundle); else mock mode. */
export function isPolarConfigured(slug: string = 'ai-cost-health'): boolean {
  if (!env.POLAR_ACCESS_TOKEN) return false
  if (slug === 'bundle') return Boolean(env.POLAR_PRODUCT_ID_BUNDLE)
  return Boolean(env.POLAR_PRODUCT_ID[slug])
}

/** True when an LLM is available for narrative generation. */
export function isLlmConfigured(): boolean {
  return Boolean(env.OPENROUTER_API_KEY)
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false
  return env.ADMIN_EMAILS.includes(email.toLowerCase())
}
