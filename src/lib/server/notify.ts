import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { desc } from 'drizzle-orm'
import MailChecker from 'mailchecker'
import { db } from '@/lib/db'
import { notifySignup } from '@/lib/db/schema'
import { reportBySlug } from '@/lib/reports/catalog'
import { genId } from '@/lib/id'
import { requireAdmin } from './guards'

/** Capture an email for a coming-soon report. Validated with mailchecker. */
export const subscribeNotify = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().min(3).max(254), reportSlug: z.string() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const email = data.email.trim().toLowerCase()
    if (!MailChecker.isValid(email)) {
      return { ok: false, error: 'Please enter a valid, non-disposable email.' }
    }
    if (!reportBySlug(data.reportSlug)) {
      return { ok: false, error: 'Unknown report.' }
    }
    db.insert(notifySignup).values({ id: genId('n_'), email, reportSlug: data.reportSlug }).run()
    return { ok: true }
  })

/** Admin: recent notify signups. */
export const listNotify = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()
  const rows = db.select().from(notifySignup).orderBy(desc(notifySignup.createdAt)).limit(200).all()
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    reportSlug: r.reportSlug,
    createdAt: (r.createdAt as unknown as Date)?.getTime?.() ?? 0,
  }))
})
