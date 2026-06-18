import { describe, it, expect } from 'vitest'
import { openAIUsageToRows, anthropicUsageToRows } from './connectors'

describe('openAIUsageToRows', () => {
  const usage = [
    {
      start_time: 1746662400, // 2025-05-08
      results: [
        { model: 'gpt-4o', input_tokens: 1_000_000, output_tokens: 200_000, num_model_requests: 500, project_id: 'p1' },
        { model: 'gpt-4o-mini', input_tokens: 500_000, output_tokens: 100_000, num_model_requests: 1000, project_id: 'p1' },
      ],
    },
  ]

  it('maps buckets to rows and estimates cost without a cost feed', () => {
    const rows = openAIUsageToRows(usage)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ provider: 'openai', model: 'gpt-4o', date: '2025-05-08', project: 'p1', requests: 500 })
    expect(rows.every((r) => r.costSource === 'estimated')).toBe(true)
    expect(rows[0].cost).toBeGreaterThan(0)
  })

  it('allocates ACTUAL cost across a day/project group by token weight', () => {
    const costs = [{ start_time: 1746662400, results: [{ amount: { value: 12 }, project_id: 'p1' }] }]
    const rows = openAIUsageToRows(usage, costs)
    expect(rows.every((r) => r.costSource === 'actual')).toBe(true)
    const sum = rows.reduce((a, r) => a + r.cost, 0)
    expect(sum).toBeCloseTo(12, 1) // allocation conserves the actual total
    // gpt-4o (pricier per token) should get the larger share
    expect(rows[0].cost).toBeGreaterThan(rows[1].cost)
  })

  it('leaves a group estimated when it has no matching cost row', () => {
    const costs = [{ start_time: 1746662400, results: [{ amount: { value: 5 }, project_id: 'other' }] }]
    const rows = openAIUsageToRows(usage, costs)
    expect(rows.every((r) => r.costSource === 'estimated')).toBe(true)
  })
})

describe('anthropicUsageToRows', () => {
  it('sums cache tokens into input and tags provider', () => {
    const data = [
      {
        starting_at: '2026-05-08T00:00:00Z',
        results: [
          { model: 'claude-3-5-sonnet', uncached_input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, output_tokens: 200, num_messages: 5, workspace_id: 'w1' },
        ],
      },
    ]
    const rows = anthropicUsageToRows(data)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ provider: 'anthropic', model: 'claude-3-5-sonnet', date: '2026-05-08', project: 'w1', inputTokens: 1600, outputTokens: 200, requests: 5, costSource: 'estimated' })
    expect(rows[0].cost).toBeGreaterThan(0)
  })

  it('skips rows without a model', () => {
    const rows = anthropicUsageToRows([{ starting_at: '2026-05-08T00:00:00Z', results: [{ output_tokens: 10 }] }])
    expect(rows).toHaveLength(0)
  })
})
