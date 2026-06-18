import { env } from '@/lib/env'
import { unlockReport } from './store'

/**
 * Polar webhook handler - used only by the /api/polar/webhook server route.
 * Server-only (touches the DB via unlockReport); never imported by client code.
 */
export async function handlePolarWebhook(request: Request): Promise<Response> {
  if (!env.POLAR_WEBHOOK_SECRET) return new Response('Webhook not configured', { status: 503 })
  const body = await request.text()
  try {
    const { validateEvent } = await import('@polar-sh/sdk/webhooks')
    const headers = Object.fromEntries(request.headers.entries())
    const event = validateEvent(body, headers, env.POLAR_WEBHOOK_SECRET) as {
      type: string
      data: { id?: string; status?: string; metadata?: Record<string, unknown> }
    }
    // Only unlock on COMPLETED payment. `checkout.updated` fires on every
    // transition (open/expired/failed too) - never unlock for those.
    const paid =
      event.type === 'order.paid' ||
      (event.type === 'checkout.updated' && ['succeeded', 'confirmed'].includes(event.data.status ?? ''))
    if (paid) {
      const scanId = event.data.metadata?.scanId
      const slug = event.data.metadata?.slug
      if (typeof scanId === 'string') {
        await unlockReport(scanId, typeof slug === 'string' ? slug : 'ai-cost-health', event.data.id)
      }
    }
    return new Response('ok', { status: 200 })
  } catch {
    return new Response('Invalid signature', { status: 403 })
  }
}
