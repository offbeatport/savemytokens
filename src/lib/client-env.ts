/** Client-safe env (VITE_ prefixed). Safe to import anywhere (reads only
 * import.meta.env, which exists in both SSR and browser). */
export const clientEnv = {
  APP_URL: import.meta.env.VITE_APP_URL ?? 'http://localhost:3000',
  SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN ?? '',
  POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY ?? '',
  POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com',
}
