import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { scan } from '@/lib/db/schema'
import { env, isLlmConfigured } from '@/lib/env'
import type { Report } from '@/lib/analysis/types'

/**
 * Founder-ready memo. Returns the deterministic memo by default; if an
 * OpenRouter key is configured, rewrites it in a tighter exec voice.
 * Only aggregate numbers are sent to the model - never prompts/responses.
 */
export const getFounderMemo = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ scanId: z.string() }).parse(d))
  .handler(async ({ data }): Promise<{ memo: string; fromLlm: boolean }> => {
    const row = db.select().from(scan).where(eq(scan.id, data.scanId)).get()
    if (!row) return { memo: '', fromLlm: false }
    const report = JSON.parse(row.reportJson) as Report

    if (!isLlmConfigured()) return { memo: report.founderMemo, fromLlm: false }

    const facts = {
      spendAnalyzed: report.spendAnalyzed,
      healthScore: report.healthScore,
      band: report.bandLabel,
      healthy: report.healthy,
      estMonthlyImpact: [report.estMonthlyImpactLow, report.estMonthlyImpactHigh],
      topFindings: report.findings.slice(0, 4).map((f) => ({
        title: f.title,
        est: [f.estMonthlyLow, f.estMonthlyHigh],
        confidence: f.confidence,
        fix: f.fix,
      })),
    }
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are a pragmatic FinOps advisor. Write a concise, founder-ready memo (markdown, <200 words) about an LLM spend diagnosis. Lead with the verdict, then the biggest lever and the ask. No fluff, no preamble. Use the exact dollar figures provided.',
            },
            { role: 'user', content: JSON.stringify(facts) },
          ],
          temperature: 0.4,
          max_tokens: 500,
        }),
      })
      if (!res.ok) return { memo: report.founderMemo, fromLlm: false }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const memo = json.choices?.[0]?.message?.content?.trim()
      return memo ? { memo, fromLlm: true } : { memo: report.founderMemo, fromLlm: false }
    } catch {
      return { memo: report.founderMemo, fromLlm: false }
    }
  })
