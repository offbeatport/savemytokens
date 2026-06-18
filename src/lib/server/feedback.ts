import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { desc } from 'drizzle-orm'
import MailChecker from 'mailchecker'
import { db } from '@/lib/db'
import { featureRequest } from '@/lib/db/schema'
import { genId } from '@/lib/id'
import { requireAdmin } from './guards'

/** Capture a free-form "I want X" request from the feedback modal. */
export const submitFeedback = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({
        message: z.string().min(1).max(2000),
        email: z.string().max(254).optional(),
        path: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const message = data.message.trim()
    if (message.length < 3) return { ok: false, error: 'Please add a little more detail.' }
    const email = data.email?.trim().toLowerCase() || undefined
    if (email && !MailChecker.isValid(email)) {
      return { ok: false, error: 'That email looks invalid - leave it blank or fix it.' }
    }
    db.insert(featureRequest)
      .values({ id: genId('f_'), message, email: email ?? null, path: data.path ?? null })
      .run()
    return { ok: true }
  })

/** Admin: recent feature requests. */
export const listFeedback = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()
  const rows = db.select().from(featureRequest).orderBy(desc(featureRequest.createdAt)).limit(200).all()
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    email: r.email,
    path: r.path,
    createdAt: (r.createdAt as unknown as Date)?.getTime?.() ?? 0,
  }))
})
