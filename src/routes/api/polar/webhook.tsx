import { createFileRoute } from '@tanstack/react-router'

// Handler imported dynamically so the server-only webhook code (→ db) stays out
// of the client static graph (routeTree.gen.ts imports every route).
export const Route = createFileRoute('/api/polar/webhook')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { handlePolarWebhook } = await import('@/lib/server/polar-webhook')
        return handlePolarWebhook(request)
      },
    },
  },
})
