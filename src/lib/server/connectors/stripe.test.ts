import { describe, it, expect } from 'vitest'
import { stripeSubscriptionsToRevenue } from './stripe'

describe('stripeSubscriptionsToRevenue', () => {
  const subs = [
    { id: 'sub1', status: 'active', customer: { id: 'cus_a', name: 'Acme Corp' }, items: { data: [{ price: { unit_amount: 49900, recurring: { interval: 'month' } } }] } },
    { id: 'sub2', status: 'active', customer: { id: 'cus_b', name: 'Globex' }, items: { data: [{ price: { unit_amount: 2880000, recurring: { interval: 'year' } } }] } }, // $28,800/yr → $2,400/mo
    { id: 'sub3', status: 'canceled', customer: 'cus_c', items: { data: [{ price: { unit_amount: 9900, recurring: { interval: 'month' } } }] } }, // excluded
    { id: 'sub4', status: 'active', customer: { id: 'cus_a', name: 'Acme Corp' }, items: { data: [{ price: { unit_amount: 10000, recurring: { interval: 'month' } } }] } }, // 2nd sub on acme
  ]

  it('normalizes to monthly USD, sums per customer, excludes inactive', () => {
    const rows = stripeSubscriptionsToRevenue(subs)
    expect(rows.length).toBe(2)
    const acme = rows.find((r) => r.customerId === 'cus_a')!
    expect(acme.monthlyRevenue).toBe(599) // 499 + 100
    expect(acme.label).toBe('Acme Corp')
    expect(acme.source).toBe('stripe')
    expect(rows.find((r) => r.customerId === 'cus_b')!.monthlyRevenue).toBe(2400)
    expect(rows.find((r) => r.customerId === 'cus_c')).toBeUndefined()
  })

  it('falls back to id when customer has no name + handles string customer refs', () => {
    const rows = stripeSubscriptionsToRevenue([
      { id: 's', status: 'active', customer: 'cus_x', items: { data: [{ price: { unit_amount: 5000, recurring: { interval: 'month' } } }] } },
    ])
    expect(rows[0].label).toBe('cus_x')
    expect(rows[0].monthlyRevenue).toBe(50)
  })
})
