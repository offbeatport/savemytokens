import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db, schema } from '@/lib/db'
import { env } from '@/lib/env'

const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  }
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  socialProviders,
  // Persist auth cookies correctly within TanStack Start server handlers.
  plugins: [tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
