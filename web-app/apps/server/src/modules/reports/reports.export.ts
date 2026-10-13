import {
  SNAPSHOT_REPORTS,
  toCsv,
  type ReportFormat,
  type ReportKey,
  type ReportQuery,
  type ReportResult,
} from '@maintainx/shared'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'
import { renderReportPdf, type PdfMeta } from './reports.pdf.js'
import { runReport } from './reports.service.js'

/*
 * A report as a downloadable file (CSV or PDF), used by the export endpoints
 * and the scheduled email reports. Both run the report as `auth`, so the
 * restaurant scope is the same as on screen.
 */

export interface ReportFile {
  result: ReportResult
  body: Buffer
  contentType: string
  fileName: string
}

export async function reportMeta(
  auth: AuthContext,
  key: ReportKey,
  q: Pick<ReportQuery, 'from' | 'to' | 'restaurantId'>,
): Promise<PdfMeta> {
  const [org, restaurant] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      select: { name: true, timezone: true, currency: true },
    }),
    q.restaurantId
      ? prisma.restaurant.findFirst({
          where: { id: q.restaurantId, organizationId: auth.organizationId },
          select: { name: true },
        })
      : null,
  ])
  const today = dateKeyInZone(org.timezone, new Date())
  return {
    organization: org.name,
    restaurant: restaurant?.name ?? 'All restaurants',
    period: SNAPSHOT_REPORTS.includes(key) ? `As of ${today}` : `${q.from} – ${q.to}`,
    timeZone: org.timezone,
    currency: org.currency,
  }
}

export async function buildReportFile(
  auth: AuthContext,
  key: ReportKey,
  q: ReportQuery,
  format: ReportFormat,
): Promise<ReportFile> {
  const result = await runReport(auth, key, q)
  const base = `${key}_${q.from}_${q.to}`
  if (format === 'PDF') {
    const body = await renderReportPdf(result, await reportMeta(auth, key, q))
    return { result, body, contentType: 'application/pdf', fileName: `${base}.pdf` }
  }
  // Column keys as headers (the app translates them on screen).
  const csv = toCsv(
    result.columns.map((c) => c.key),
    result.rows.map((r) => result.columns.map((c) => r[c.key])),
  )
  return {
    result,
    body: Buffer.from(csv, 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    fileName: `${base}.csv`,
  }
}
