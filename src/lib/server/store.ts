import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { scan, scanUnlock } from '@/lib/db/schema'
import { genId } from '@/lib/id'

/**
 * Server-only mutations on the scan store. Kept out of client-imported server-fn
 * files so `better-sqlite3` never reaches the client bundle - only call these
 * inside server-fn / server-route handlers.
 */

/** Unlock one report (a ReportSlug) or 'bundle' (= all reports) for a scan. */
export async function unlockReport(scanId: string, target: string, checkoutId?: string): Promise<void> {
  db.insert(scanUnlock)
    .values({ id: genId('u_'), scanId, reportSlug: target, checkoutId: checkoutId ?? null })
    .onConflictDoNothing()
    .run()
  // Keep the legacy ai-cost-health mirror in sync.
  if (target === 'ai-cost-health' || target === 'bundle') {
    await db
      .update(scan)
      .set({ unlocked: true, ...(checkoutId ? { checkoutId } : {}) })
      .where(eq(scan.id, scanId))
  }
}

/** A report is unlocked iff a (scanId, slug) OR (scanId, 'bundle') row exists. */
export function isUnlocked(scanId: string, slug: string): boolean {
  const rows = db.select().from(scanUnlock).where(eq(scanUnlock.scanId, scanId)).all()
  return rows.some((r) => r.reportSlug === slug || r.reportSlug === 'bundle')
}

export function unlockedSlugs(scanId: string): Set<string> {
  const rows = db.select().from(scanUnlock).where(eq(scanUnlock.scanId, scanId)).all()
  return new Set(rows.map((r) => r.reportSlug))
}
