import { createFileRoute } from '@tanstack/react-router'

// `auth` (better-auth → drizzle → better-sqlite3) is imported dynamically inside
// the handlers so it never enters the client static graph via routeTree.gen.ts.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { auth } = await import('@/lib/auth')
        return auth.handler(request)
      },
      POST: async ({ request }: { request: Request }) => {
        const { auth } = await import('@/lib/auth')
        return auth.handler(request)
      },
    },
  },
})
