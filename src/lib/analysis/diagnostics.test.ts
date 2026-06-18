import { describe, it, expect } from 'vitest'
import { buildContext, buildDiagnostics } from './engine'
import type { UsageRow, DiagnosticMetric } from './types'

function row(p: Partial<UsageRow>): UsageRow {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    date: '2026-06-01',
    project: 'checkout',
    inputTokens: 1000,
    outputTokens: 500,
    requests: 10,
    cost: 5,
    costSource: 'actual',
    ...p,
  }
}
const diag = (rows: UsageRow[]): DiagnosticMetric[] => buildDiagnostics(buildContext(rows))
const get = (rows: UsageRow[], id: string) => diag(rows).find((d) => d.id === id)

describe('diagnostics: reasoning tokens', () => {
  it('quantifies reasoning $ when the column is present', () => {
    const d = get([row({ model: 'o3', reasoningTokens: 800_000, outputTokens: 1_000_000, cost: 60 })], 'reasoning-tokens')
    expect(d?.available).toBe(true)
    expect(d?.value).toMatch(/\$/)
  })
  it('flags reasoning models honestly when the column is absent', () => {
    const d = get([row({ model: 'o3', cost: 60 })], 'reasoning-tokens')
    expect(d?.available).toBe(false)
    expect(d?.status).toBe('info')
  })
  it('says nothing about reasoning when no reasoning models are used', () => {
    expect(get([row({ model: 'gpt-4o' })], 'reasoning-tokens')).toBeUndefined()
  })
})

describe('diagnostics: unattributed spend', () => {
  it('is always present and benchmarked', () => {
    const d = get([row({ project: 'a', cost: 100 }), row({ project: 'b', cost: 100 })], 'unattributed-spend')
    expect(d?.available).toBe(true)
    expect(d?.benchmark).toMatch(/5%/)
  })
  it('is healthy when every project is tagged', () => {
    const d = get([row({ project: 'a', cost: 100 }), row({ project: 'b', cost: 100 })], 'unattributed-spend')
    expect(d?.status).toBe('good')
  })
  it('is at risk when everything rolls up to one/default label', () => {
    const d = get([row({ project: 'default', cost: 100 }), row({ project: 'default', model: 'gpt-4o-mini', cost: 40 })], 'unattributed-spend')
    expect(d?.status).toBe('risk')
  })
  it('warns when a chunk is untagged', () => {
    const d = get([row({ project: 'default', cost: 30 }), row({ project: 'real', cost: 70 })], 'unattributed-spend')
    expect(d?.status).toBe('watch')
  })
})

describe('diagnostics: cache health', () => {
  it('reports hit rate when cache tokens are present', () => {
    const d = get([row({ cacheReadTokens: 5000, inputTokens: 10_000 })], 'cache-health')
    expect(d?.available).toBe(true)
    expect(d?.status).toBe('good')
  })
  it('flags a barely-hitting cache as a possible net loss', () => {
    const d = get([row({ cacheReadTokens: 100, inputTokens: 100_000 })], 'cache-health')
    expect(d?.status).toBe('risk')
  })
  it('flags missing cache data as a limit (not a guess) when prompts are large+repeated', () => {
    const d = get([row({ project: 'big', inputTokens: 3000 * 300, outputTokens: 50 * 300, requests: 300, cost: 200 })], 'cache-health')
    expect(d?.available).toBe(false)
    expect(d?.status).toBe('info')
  })
})
