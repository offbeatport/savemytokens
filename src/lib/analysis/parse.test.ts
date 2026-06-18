import { describe, it, expect } from 'vitest'
import { parseUsage, parseUsageCsv, parseUsageJson } from './parse'

describe('CSV parsing', () => {
  it('parses our canonical schema', () => {
    const csv = [
      'provider,model,date,project,input_tokens,output_tokens,requests,total_cost,errors',
      'openai,gpt-4o,2026-05-08,checkout,1000000,200000,500,12.50,3',
      'anthropic,claude-3-5-sonnet,2026-05-09,docs,2000000,300000,400,18.00,0',
    ].join('\n')
    const { rows } = parseUsageCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ provider: 'openai', model: 'gpt-4o', requests: 500, cost: 12.5, errors: 3 })
    expect(rows[1].provider).toBe('anthropic')
  })

  it('aliases OpenAI-style headers (prompt_tokens / completion_tokens / api_key)', () => {
    const csv = [
      'model,day,api_key,prompt_tokens,completion_tokens,calls',
      'gpt-4o-mini,2026-05-08,proj_abc,500000,100000,2000',
    ].join('\n')
    const { rows } = parseUsageCsv(csv)
    expect(rows[0]).toMatchObject({ model: 'gpt-4o-mini', project: 'proj_abc', inputTokens: 500000, outputTokens: 100000, requests: 2000 })
    expect(rows[0].provider).toBe('openai') // inferred from model
    expect(rows[0].cost).toBeGreaterThan(0) // estimated from tokens
  })
})

describe('JSON parsing - OpenAI Usage API shape', () => {
  const json = JSON.stringify({
    object: 'page',
    data: [
      {
        object: 'bucket',
        start_time: 1746662400, // 2025-05-08
        end_time: 1746748800,
        results: [
          { object: 'organization.usage.completions.result', input_tokens: 1_000_000, output_tokens: 200_000, num_model_requests: 500, model: 'gpt-4o', project_id: 'proj_checkout' },
          { input_tokens: 300_000, output_tokens: 50_000, num_model_requests: 1200, model: 'gpt-4o-mini', project_id: 'proj_batch' },
        ],
      },
    ],
    next_page: null,
  })

  it('flattens buckets → rows with estimated cost', () => {
    const { rows } = parseUsageJson(json)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ provider: 'openai', model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 200_000, requests: 500, project: 'proj_checkout' })
    expect(rows[0].date).toBe('2025-05-08')
    expect(rows[0].cost).toBeGreaterThan(0)
  })

  it('parseUsage dispatches JSON vs CSV by content', () => {
    expect(parseUsage(json).rows).toHaveLength(2)
    expect(parseUsage('model,requests\ngpt-4o,10').rows).toHaveLength(1)
  })
})

describe('JSON parsing - Anthropic-style cache token breakdown', () => {
  it('sums uncached + cache tokens into input', () => {
    const json = JSON.stringify({
      data: [
        {
          starting_at: '2026-05-08T00:00:00Z',
          results: [
            { model: 'claude-3-5-sonnet', uncached_input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, output_tokens: 200 },
          ],
        },
      ],
    })
    const { rows } = parseUsageJson(json)
    expect(rows).toHaveLength(1)
    expect(rows[0].inputTokens).toBe(1600) // 1000 + 500 + 100
    expect(rows[0].provider).toBe('anthropic')
    expect(rows[0].date).toBe('2026-05-08')
  })
})

describe('failure modes never fabricate rows', () => {
  it('invalid JSON → no rows + warning', () => {
    const r = parseUsageJson('{ not json')
    expect(r.rows).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
  it('empty CSV → no rows', () => {
    expect(parseUsageCsv('').rows).toHaveLength(0)
  })
  it('rows without a model are skipped', () => {
    const { rows } = parseUsageJson(JSON.stringify([{ input_tokens: 100, output_tokens: 10 }]))
    expect(rows).toHaveLength(0)
  })
})
