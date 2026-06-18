import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '@/lib/auth'
import { isAdminEmail } from '@/lib/env'

/**
 * Server-only session helpers. These touch request context / auth and must
 * ONLY be called inside server-function handlers - never imported by client
 * code directly (import `getSession` from `./session` for that).
 */

export interface SessionUser {
  id: string
  name: string
  email: string
  image: string | null
  isAdmin: boolean
}

/** Resolve the current user (server-side). Returns null when signed out. */
export async function resolveUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session?.user) return null
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
    isAdmin: isAdminEmail(session.user.email),
  }
}

/** Throws unless the caller is an admin (ADMIN_EMAILS). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await resolveUser()
  if (!user || !user.isAdmin) throw new Error('Unauthorized')
  return user
}
