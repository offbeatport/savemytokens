import { createServerFn } from '@tanstack/react-start'
import { resolveUser } from './guards'

export type { SessionUser } from './guards'

/**
 * Client-safe entry point for the current session. The server-only work lives
 * in `./guards` and is referenced only inside this handler, so it is stripped
 * from the client bundle (client gets an RPC stub).
 */
export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  return resolveUser()
})
