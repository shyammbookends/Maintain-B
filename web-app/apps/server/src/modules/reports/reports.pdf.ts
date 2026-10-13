import type { ReportCell, ReportColumn, ReportKey, ReportResult } from '@maintainx/shared'

/*
 * PDF version of a report: the same columns and rows as the CSV, laid out as
 * a landscape A4 table with a header (title, organization, restaurant,
 * period, generation time), the headline numbers and page numbers.
 *
 * Uses PDF's built-in Helvetica, so nothing is embedded and the file stays
 * small. That font only covers Latin text: characters it can't draw (e.g.
 * Hindi or Gujarati names) are shown as "?" — the CSV keeps them intact.
 */

export interface PdfMeta {
  organization: string
  /** Restaurant name, or "All restaurants". */
  restaurant: string
  /** "2026-09-01 – 2026-09-30", or a snapshot note. */
  period: string
  timeZone: string
  currency: string
}

const ACRONYMS: Record<string, string> = {
  pm: 'PM',
  mttr: 'MTTR',
  mtbf: 'MTBF',
  po: 'PO',
  wo: 'WO',
  sla: 'SLA',
}

/** "work-order-summary" → "Work order summary"; "completedAt" → "Completed at". */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase())
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const reportTitle = (key: ReportKey) => humanize(key)

/** Columns whose values are enum codes (IN_PROGRESS → "In progress"). */
const ENUM_COLUMNS = new Set([
  'status',
  'priority',
  'category',
  'type',
  'currentStatus',
  'topCategory',
])

/** Keeps characters the standard PDF fonts (WinAnsi) can draw. */
function printable(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…€™]/g, '?')
}

function dateTimeIn(timeZone: string, iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

const numberFmt = (max: number, min = 0) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: max, minimumFractionDigits: min })

/** One cell as text (shared by the PDF and the email summary). */
export function formatCell(
  col: Pick<ReportColumn, 'key' | 'type'>,
  value: ReportCell,
  meta: Pick<PdfMeta, 'timeZone' | 'currency'>,
): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'string' && ENUM_COLUMNS.has(col.key) && /^[A-Z_]+$/.test(value))
    return humanize(value)
  if (col.key === 'onTime') return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : String(value)
  switch (col.type) {
    case 'money':
      return `${meta.currency} ${numberFmt(2, 2).format(Number(value))}`
    case 'percent':
      return `${numberFmt(1).format(Number(value))}%`
    case 'hours':
      return numberFmt(1).format(Number(value))
    case 'number':
      return numberFmt(3).format(Number(value))
    case 'datetime':
      return dateTimeIn(meta.timeZone, String(value))
    default:
      return String(value)
  }
}

const NUMERIC = new Set(['number', 'money', 'percent', 'hours'])

const PAGE = { margin: 36, rowHeight: 16, headerHeight: 20, fontSize: 8 }
const COLOR = { text: '#111827', muted: '#6b7280', rule: '#d1d5db', band: '#f3f4f6' }

export async function renderReportPdf(result: ReportResult, meta: PdfMeta): Promise<Buffer> {
  // Loaded on first use, so the API cold start (serverless) doesn't pay for it.
  const { default: PDFDocument } = await import('pdfkit')
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: `${reportTitle(result.key)} - ${meta.organization}`,
      Author: meta.organization,
      Creator: 'Bookends Maintenance',
    },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const left = PAGE.margin
  const width = doc.page.width - PAGE.margin * 2
  const bottom = () => doc.page.height - PAGE.margin - 14

  // ---- heading
  doc.fillColor(COLOR.text).font('Helvetica-Bold').fontSize(16)
  doc.text(printable(reportTitle(result.key)), left, PAGE.margin, { width })
  doc.font('Helvetica').fontSize(9).fillColor(COLOR.muted)
  doc.text(printable(`${meta.organization}  ·  ${meta.restaurant}  ·  ${meta.period}`), { width })
  doc.text(`Generated ${dateTimeIn(meta.timeZone, result.generatedAt)} (${meta.timeZone})`, {
    width,
  })
  if (result.summary.length) {
    doc.moveDown(0.4).fillColor(COLOR.text).fontSize(9)
    const line = result.summary
      .map(
        (s) => `${humanize(s.label)}: ${formatCell({ key: s.label, type: s.type }, s.value, meta)}`,
      )
      .join('     ')
    doc.text(printable(line), { width })
  }
  if (result.truncated) {
    doc.fillColor(COLOR.muted).text(`Showing the first ${result.rows.length} rows.`, { width })
  }
  doc.moveDown(0.6)

  // ---- table
  const cols = result.columns
  if (cols.length === 0 || result.rows.length === 0) {
    doc.fillColor(COLOR.muted).fontSize(10).text('No data for this period.', left, doc.y, { width })
  } else {
    doc.font('Helvetica').fontSize(PAGE.fontSize)
    const cells = result.rows.map((r) =>
      // A cell never shows more than ~60 characters: cap before measuring so a
      // long free-text field can't make every width search slow.
      cols.map((c) => printable(formatCell(c, r[c.key] ?? null, meta)).slice(0, 120)),
    )
    const headers = cols.map((c) => printable(humanize(c.key)))
    const pad = 4
    // Natural width per column (header vs. a sample of rows), then fit to the page.
    const natural = cols.map((_, i) => {
      doc.font('Helvetica-Bold')
      let w = doc.widthOfString(headers[i]!)
      doc.font('Helvetica')
      for (const row of cells.slice(0, 300)) w = Math.max(w, doc.widthOfString(row[i]!))
      return Math.min(Math.max(w + pad * 2, 36), 220)
    })
    const total = natural.reduce((a, b) => a + b, 0)
    const widths = natural.map((w) => (w / total) * width)

    const fit = (text: string, w: number) => {
      if (doc.widthOfString(text) <= w) return text
      let lo = 0
      let hi = text.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (doc.widthOfString(`${text.slice(0, mid)}...`) <= w) lo = mid
        else hi = mid - 1
      }
      return `${text.slice(0, lo)}...`
    }

    const drawRow = (values: string[], y: number, bold: boolean) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(PAGE.fontSize)
        .fillColor(COLOR.text)
      let x = left
      values.forEach((v, i) => {
        const w = widths[i]!
        const text = fit(v, w - pad * 2)
        doc.text(text, x + pad, y + 4, {
          width: w - pad * 2,
          align: NUMERIC.has(cols[i]!.type) ? 'right' : 'left',
          lineBreak: false,
        })
        x += w
      })
    }
    const drawHeader = (y: number) => {
      doc.rect(left, y, width, PAGE.headerHeight).fill(COLOR.band)
      drawRow(headers, y + 2, true)
      doc
        .moveTo(left, y + PAGE.headerHeight)
        .lineTo(left + width, y + PAGE.headerHeight)
        .lineWidth(0.6)
        .strokeColor(COLOR.rule)
        .stroke()
      return y + PAGE.headerHeight
    }

    let y = drawHeader(doc.y)
    cells.forEach((row, i) => {
      if (y + PAGE.rowHeight > bottom()) {
        doc.addPage()
        y = drawHeader(PAGE.margin)
      }
      if (i % 2 === 1) doc.rect(left, y, width, PAGE.rowHeight).fill('#fafafa')
      drawRow(row, y, false)
      y += PAGE.rowHeight
    })
  }

  // ---- footer on every page
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const bottomMargin = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted)
    const y = doc.page.height - PAGE.margin + 4
    doc.text(printable(meta.organization), left, y, { width: width / 2, lineBreak: false })
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + width / 2, y, {
      width: width / 2,
      align: 'right',
      lineBreak: false,
    })
    doc.page.margins.bottom = bottomMargin
  }

  doc.end()
  return done
}
