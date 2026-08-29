import type { RevenueRow } from '@/lib/analysis/types'
import { ConnectorError } from '../connectors'

/**
 * Stripe revenue connector. A restricted key (read access to Subscriptions +
 * Customers) is used ONCE to pull active subscriptions and normalize them to MRR
 * per customer — never stored or logged. The transform is pure + unit-tested;
 * the fetcher is a thin wrapper around the Stripe API.
 */

interface StripePrice {
  unit_amount?: number | null
  nickname?: string | null
  recurring?: { interval?: string; interval_count?: number } | null
}
interface StripeSubItem {
  id: string
  status?: string
  customer?: string | { id: string; name?: string | null; email?: string | null; description?: string | null }
  items?: { data?: Array<{ price?: StripePrice; quantity?: number; plan?: { nickname?: string | null; amount?: number | null; interval?: string } }> }
}

/** Normalize any billing interval to monthly USD. */
function toMonthly(unitAmount: number, interval: string, intervalCount = 1, qty = 1): number {
  const perPeriod = (unitAmount / 100) * qty
  const months =
    interval === 'year' ? 12 * intervalCount : interval === 'week' ? (intervalCount * 7) / 30 : interval === 'day' ? intervalCount / 30 : intervalCount
  return months > 0 ? perPeriod / months : perPeriod
}

export function stripeSubscriptionsToRevenue(subs: StripeSubItem[]): RevenueRow[] {
  const byCustomer = new Map<string, { label: string; mrr: number; plan?: string }>()
  for (const s of subs) {
    if (s.status && !['active', 'trialing', 'past_due'].includes(s.status)) continue
    const custId = typeof s.customer === 'string' ? s.customer : s.customer?.id
    if (!custId) continue
    const label =
      typeof s.customer === 'object'
        ? s.customer?.name || s.customer?.email || s.customer?.description || custId
        : custId
    let mrr = 0
    let plan: string | undefined
    for (const it of s.items?.data ?? []) {
      const amount = it.price?.unit_amount ?? it.plan?.amount ?? 0
      const interval = it.price?.recurring?.interval ?? it.plan?.interval ?? 'month'
      const ic = it.price?.recurring?.interval_count ?? 1
      mrr += toMonthly(amount ?? 0, interval, ic, it.quantity ?? 1)
      plan = plan ?? it.price?.nickname ?? it.plan?.nickname ?? undefined
    }
    const cur = byCustomer.get(custId) ?? { label, mrr: 0, plan }
    cur.mrr += mrr
    if (!cur.plan && plan) cur.plan = plan
    byCustomer.set(custId, cur)
  }
  return [...byCustomer.entries()].map(([customerId, v]) => ({
    customerId,
    label: v.label,
    plan: v.plan,
    monthlyRevenue: Math.round(v.mrr),
    source: 'stripe' as const,
  }))
}

export async function fetchStripeRevenue(restrictedKey: string): Promise<RevenueRow[]> {
  const subs: StripeSubItem[] = []
  let startingAfter: string | undefined
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://api.stripe.com/v1/subscriptions')
    url.searchParams.set('status', 'active')
    url.searchParams.set('limit', '100')
    url.searchParams.append('expand[]', 'data.customer')
    if (startingAfter) url.searchParams.set('starting_after', startingAfter)
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${restrictedKey}`, 'Stripe-Version': '2024-06-20' },
    })
    if (res.status === 401) throw new ConnectorError('unauthorized', 'Stripe rejected that key. Use a restricted key with read access to Subscriptions & Customers.')
    if (res.status === 403) throw new ConnectorError('forbidden', 'That Stripe key lacks read access to Subscriptions.')
    if (res.status === 429) throw new ConnectorError('rate', 'Stripe rate-limited the request. Try again shortly.')
    if (!res.ok) throw new ConnectorError('error', `Stripe API error (${res.status}).`)
    const json = (await res.json()) as { data?: StripeSubItem[]; has_more?: boolean }
    const data = json.data ?? []
    subs.push(...data)
    if (!json.has_more || !data.length) break
    startingAfter = data[data.length - 1].id
  }
  const rows = stripeSubscriptionsToRevenue(subs)
  if (!rows.length) throw new ConnectorError('empty', 'No active subscriptions found on that Stripe account.')
  return rows
}
