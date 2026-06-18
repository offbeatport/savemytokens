import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { env, isPolarConfigured } from '@/lib/env'
import { unlockReport } from './store'
import { REPORT_PRICE, BUNDLE_PRICE } from '@/lib/reports/catalog'

async function polarClient() {
  const { Polar } = await import('@polar-sh/sdk')
  return new Polar({ accessToken: env.POLAR_ACCESS_TOKEN, server: env.POLAR_SERVER })
}

const SLUG_VALUES = [
  'ai-cost-health',
  'model-output-waste',
  'prompt-cache-readiness',
  'ai-margin-leak',
  'agent-waste-detector',
  'bundle',
] as const

function productIdFor(slug: string): string {
  return slug === 'bundle' ? env.POLAR_PRODUCT_ID_BUNDLE : (env.POLAR_PRODUCT_ID[slug] ?? '')
}

function priceFor(slug: string): number {
  return slug === 'bundle' ? BUNDLE_PRICE : REPORT_PRICE
}

function successUrlFor(scanId: string, slug: string): string {
  return slug === 'bundle'
    ? `${env.APP_URL}/s/${scanId}`
    : `${env.APP_URL}/s/${scanId}/r/${slug}/report?checkout={CHECKOUT_ID}`
}

export interface CheckoutStart {
  mode: 'polar' | 'mock'
  url: string | null
  price: number
}

/** Begin a per-report (or bundle) unlock. Defaults to ai-cost-health. */
export const startCheckout = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ scanId: z.string(), slug: z.enum(SLUG_VALUES).default('ai-cost-health'), email: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<CheckoutStart> => {
    const { scanId, slug } = data
    if (!isPolarConfigured(slug)) {
      return { mode: 'mock', url: null, price: priceFor(slug) }
    }
    try {
      const polar = await polarClient()
      const checkout = await polar.checkouts.create({
        products: [productIdFor(slug)],
        successUrl: successUrlFor(scanId, slug),
        customerEmail: data.email,
        metadata: { scanId, slug },
      } as never)
      return { mode: 'polar', url: (checkout as { url: string }).url, price: priceFor(slug) }
    } catch {
      return { mode: 'mock', url: null, price: priceFor(slug) }
    }
  })

/** Confirm payment + unlock. Mock mode unlocks directly; polar verifies first. */
export const confirmCheckout = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({ scanId: z.string(), slug: z.enum(SLUG_VALUES).default('ai-cost-health'), checkoutId: z.string().optional() })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ unlocked: boolean }> => {
    const { scanId, slug } = data
    // Mock unlock ONLY when Polar is globally absent (local/demo). When a token
    // IS configured, never free-unlock - even if this slug's product id is missing.
    if (!env.POLAR_ACCESS_TOKEN) {
      await unlockReport(scanId, slug)
      return { unlocked: true }
    }
    if (!isPolarConfigured(slug) || !data.checkoutId) return { unlocked: false }
    try {
      const polar = await polarClient()
      const checkout = (await polar.checkouts.get({ id: data.checkoutId })) as { status?: string }
      if (['succeeded', 'confirmed'].includes(checkout.status ?? '')) {
        await unlockReport(scanId, slug, data.checkoutId)
        return { unlocked: true }
      }
    } catch {
      /* ignore */
    }
    return { unlocked: false }
  })
