import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { validateQueryParams, createErrorResponse, toSnakeCase } from '@/lib/api-helpers'
import {
  ListTransactionsQuerySchema,
  TransactionListResponseSchema,
  UploadStatementFormSchema,
  UploadStatementResponseSchema,
} from '@/modules/fino/lib/validation'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { finoTransactions } from '@/lib/db/schema'
import { and, eq, gte, lte, desc, sql } from 'drizzle-orm'
import { getStorageProvider, readStorageConfig } from '@/lib/storage'

registry.registerPath({
  method: 'get',
  path: '/api/modules/fino/statements',
  operationId: 'finoListTransactions',
  summary: 'List transactions (paginated, optional month filter)',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { query: ListTransactionsQuerySchema },
  responses: {
    200: { description: 'Transaction list', content: { 'application/json': { schema: TransactionListResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/modules/fino/statements',
  operationId: 'finoUploadStatement',
  summary: 'Upload a PDF bank statement - parses text and bulk-inserts transactions',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'multipart/form-data': { schema: UploadStatementFormSchema } } } },
  responses: {
    200: { description: 'Parse + insert result with preview', content: { 'application/json': { schema: UploadStatementResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const queryValidation = validateQueryParams(searchParams, ListTransactionsQuerySchema)
    if (!queryValidation.success) return queryValidation.response

    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const limit = queryValidation.data.limit ?? 200
    const offset = queryValidation.data.offset ?? 0
    const month = queryValidation.data.month

    const conditions = [eq(finoTransactions.userId, user.id)]
    if (month) {
      const [year, mon] = month.split('-').map(Number)
      const start = new Date(year, mon - 1, 1).toISOString().split('T')[0]
      const end = new Date(year, mon, 0).toISOString().split('T')[0]
      conditions.push(gte(finoTransactions.date, start))
      conditions.push(lte(finoTransactions.date, end))
    }

    const rows = await withRLS((db) =>
      db.select()
        .from(finoTransactions)
        .where(and(...conditions))
        .orderBy(desc(finoTransactions.date))
        .limit(limit)
        .offset(offset)
    )

    const normalized = rows.map((r) => ({ ...r, amount: Number(r.amount) }))
    return NextResponse.json({ transactions: toSnakeCase(normalized), count: normalized.length })
  } catch (error) {
    console.error('GET /api/modules/fino/statements error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}

// --- PDF parsing helpers ---------------------------------------------------

interface ParsedRow {
  date: string
  amount: number
  description: string
}

const MONTH_MAP: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
}
const MONTH_NAME_MAP: Record<string, string> = {
  january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
  july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
}
const MONTH_ALT = Object.keys(MONTH_MAP).map(m => m.toUpperCase()).join('|')

// RBC/Canadian bank: "MMM DD MMM DD DESCRIPTION" (transaction + posting dates concatenated, no year)
// Amount appears on its own line 1-5 lines later: "$3.73" or "-$600.00"
const RBC_LINE_RE = new RegExp(
  `^(${MONTH_ALT})\\s+(\\d{1,2})(${MONTH_ALT})\\s+(\\d{1,2})\\s*(.+)`, 'i'
)
// Standalone amount line: optional minus, dollar sign, digits
const AMOUNT_ONLY_RE = /^-?\$[\d,]+\.?\d{0,2}$/

// Classic single-line formats: date + description + amount on the same line
const SINGLE_LINE_DATE_PATTERNS = [
  { re: /\b(\d{2})\/(\d{2})\/(\d{4})\b/, fn: (m: RegExpMatchArray) => `${m[3]}-${m[2]}-${m[1]}` },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, fn: (m: RegExpMatchArray) => `${m[1]}-${m[2]}-${m[3]}` },
  { re: /\b(\d{2})-(\d{2})-(\d{4})\b/, fn: (m: RegExpMatchArray) => `${m[3]}-${m[2]}-${m[1]}` },
  {
    re: /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i,
    fn: (m: RegExpMatchArray) => `${m[3]}-${MONTH_MAP[m[2].toLowerCase()]}-${m[1].padStart(2,'0')}`,
  },
]
const _MINUS = String.fromCharCode(0x2212)
const _POUND = String.fromCharCode(0x00a3)
const _EURO  = String.fromCharCode(0x20ac)
const INLINE_AMOUNT_RE = new RegExp(
  '[-' + _MINUS + ']?\\s*[' + _POUND + '$' + _EURO + ']?\\s*([\\d,]+\\.?\\d{0,2})\\b', 'g'
)

function extractYear(lines: string[]): number {
  // Look for a 4-digit year in the document (statement period header, etc.)
  for (const line of lines) {
    const m = line.match(/\b(20\d{2})\b/)
    if (m) return parseInt(m[1])
  }
  return new Date().getFullYear()
}

// Multi-line parser: handles RBC/Canadian credit card statements where the
// amount is on a separate line a few lines after the date+description line.
function parseMultiLine(lines: string[]): ParsedRow[] {
  const year = extractYear(lines)
  const results: ParsedRow[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const m = line.match(RBC_LINE_RE)
    if (!m) continue

    const [, txMonth, txDay, , , rest] = m
    const month = MONTH_MAP[txMonth.toLowerCase()]
    const day = parseInt(txDay)

    // Some lines have the amount inline at the end (e.g. interest charges)
    const inlineAmt = rest.match(/-?\$[\d,]+\.?\d{0,2}$/)
    if (inlineAmt) {
      const amount = parseFloat(inlineAmt[0].replace('$', '').replace(',', ''))
      const desc = rest.slice(0, rest.lastIndexOf(inlineAmt[0])).trim().replace(/\s+/g, ' ')
      if (desc.length >= 2 && !isNaN(amount) && Math.abs(amount) > 0) {
        results.push({ date: `${year}-${month}-${String(day).padStart(2,'0')}`, amount, description: desc.slice(0, 200) })
      }
      continue
    }

    // Look ahead up to 5 lines for a standalone amount line
    let amount: number | null = null
    let skipTo = i
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const ahead = lines[j].trim()
      if (AMOUNT_ONLY_RE.test(ahead)) {
        amount = parseFloat(ahead.replace('$', '').replace(',', ''))
        skipTo = j
        break
      }
      if (RBC_LINE_RE.test(ahead)) break // next transaction started
    }

    if (amount === null || isNaN(amount) || Math.abs(amount) === 0) continue

    const desc = rest.trim().replace(/\s+/g, ' ')
    if (!desc || desc.length < 2) continue

    results.push({ date: `${year}-${month}-${String(day).padStart(2,'0')}`, amount, description: desc.slice(0, 200) })
    i = skipTo
  }

  return results
}

// Single-line parser: handles statements where date + description + amount are on one line.
function parseSingleLine(line: string): ParsedRow | null {
  const trimmed = line.trim()
  if (trimmed.length < 5) return null

  let date: string | null = null
  for (const { re, fn } of SINGLE_LINE_DATE_PATTERNS) {
    const m = trimmed.match(re)
    if (m) { date = fn(m); break }
  }
  if (!date) return null

  const parsed = new Date(date)
  if (isNaN(parsed.getTime()) || parsed.getFullYear() < 2000 || parsed.getFullYear() > 2100) return null

  const amounts: number[] = []
  let match: RegExpExecArray | null
  INLINE_AMOUNT_RE.lastIndex = 0
  while ((match = INLINE_AMOUNT_RE.exec(trimmed)) !== null) {
    const raw = match[0].replace(/,/g, ' ').replace(new RegExp('[' + _POUND + '$' + _EURO + '\\s]', 'g'), ' ').replace(_MINUS, '-')
    const n = parseFloat(raw)
    if (!isNaN(n) && Math.abs(n) > 0) amounts.push(n)
  }
  if (amounts.length === 0) return null

  const amount = amounts[amounts.length - 1]
  const desc = trimmed
    .replace(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/gi, '')
    .replace(new RegExp('[-' + _MINUS + ']?\\s*[' + _POUND + '$' + _EURO + ']?\\s*[\\d,]+\\.?\\d{0,2}', 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!desc || desc.length < 2) return null
  return { date, amount, description: desc.slice(0, 200) }
}

// --- RBC Chequing / bank statement parser ----------------------------------
// Format: 5 columns (Date, Description, Withdrawals, Deposits, Balance)
// pdf-parse concatenates all columns onto each line with no separators.
// Date lines start with "D MMM" or "DD MMM" (no year).
// Lines with 2 trailing decimal amounts: first = tx amount, last = running balance.
// Lines with 1 trailing decimal amount: just the tx amount (balance not extracted).
// Continuation lines (no date) are extra description text for the previous tx date.

const CHEQ_DATE_RE = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*/i
// Two concatenated decimal numbers at line end: (tx_amount)(running_balance)
// Group 2 is the authoritative balance; delta from prevBalance = tx amount
const TWO_DECIMALS_RE = /(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})$/
// Single decimal with proper comma-formatting (e.g. 150.00 or 1,406.12)
// Limits to 1-3 leading digits to avoid swallowing reference-code digit prefixes
const ONE_DECIMAL_RE = /(\d{1,3}(?:,\d{3})*\.\d{2})$/
// Specific deposit keywords only - avoids false positives like "Deposit Account"
const DEPOSIT_KEYWORDS_RE = /\bpayroll deposit\b|\be-transfer received\b|\bsalary\b|\bincome\b|\brefund\b/i

// Strip trailing number chain + trailing punctuation/whitespace from a description string
function stripTrailingNumbers(s: string): string {
  return s.replace(/[\d,.]+$/, '').replace(/[\s\-,.:()|]+$/, '').trim().replace(/\s+/g, ' ')
}

function parseChequingFormat(lines: string[]): ParsedRow[] {
  // Detect format: look for the chequing column header
  const hasHeader = lines.some(l => /DateDescription.*Withdrawals.*Deposits.*Balance/i.test(l))
  if (!hasHeader) return []

  // Extract statement year range: "From MMM DD, YYYY to MMM DD, YYYY"
  let startYear = new Date().getFullYear()
  let endYear = startYear
  let endMonth = 12
  for (const line of lines) {
    const m = line.match(/From\s+\w+\s+\d+,?\s+(\d{4})\s+to\s+\w+\s+\d+,?\s+(\d{4})/i)
      ?? line.match(/From\s+\w+\s+\d+\s+to\s+\w+\s+\d+,\s+(\d{4})/i)
    if (m) {
      startYear = parseInt(m[1])
      endYear = parseInt(m[m.length - 1])
      // Find end month from statement header line
      const em = line.match(/to\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/i)
      if (em) endMonth = parseInt(MONTH_MAP[em[1].toLowerCase()])
      break
    }
  }

  // Opening balance from header
  let prevBalance: number | null = null
  for (const line of lines) {
    // Anchor to start-of-line "Opening Balance" to avoid matching "opening balance on December 18..."
    const m = line.trim().match(/^Opening Balance\s*([\d,.]+)/i)
    if (m) { prevBalance = parseFloat(m[1].replace(/,/g, '')); break }
  }

  const results: ParsedRow[] = []
  let inSection = false
  let currentDate: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Enter transaction section after header
    if (/DateDescription.*Withdrawals.*Deposits.*Balance/i.test(line)) { inSection = true; continue }
    if (!inSection) continue

    // Skip summary / footer lines
    if (/Opening Balance|Closing Balance|Total deposits|Total withdrawals|Please (check|retain)|Important information/i.test(line)) continue
    if (line.length < 3) continue

    // Detect date at start of line
    const dateMatch = line.match(CHEQ_DATE_RE)
    if (dateMatch) {
      const day = parseInt(dateMatch[1])
      const mon = dateMatch[2].toLowerCase()
      const monthNum = parseInt(MONTH_MAP[mon])
      // Assign year: months after the statement end month belong to the prior year
      const year = monthNum > endMonth ? startYear : endYear
      currentDate = `${year}-${MONTH_MAP[mon]}-${String(day).padStart(2, '0')}`
    }

    if (!currentDate) continue

    // Strip leading date token before parsing amounts
    const body = line.replace(CHEQ_DATE_RE, '').trim()
    if (body.length < 2) continue

    const twoMatch = body.match(TWO_DECIMALS_RE)
    if (twoMatch) {
      // Balance-delta approach: second group is the authoritative running balance
      const newBalance = parseFloat(twoMatch[2].replace(/,/g, ''))
      if (prevBalance === null) { prevBalance = newBalance; continue }
      const delta = Math.round((newBalance - prevBalance) * 100) / 100
      if (Math.abs(delta) < 0.005) continue
      const desc = stripTrailingNumbers(body)
      prevBalance = newBalance
      if (desc.length >= 2) results.push({ date: currentDate, amount: delta, description: desc.slice(0, 200) })
      continue
    }

    const oneMatch = body.match(ONE_DECIMAL_RE)
    if (oneMatch) {
      const txAmt = parseFloat(oneMatch[1].replace(/,/g, ''))
      if (txAmt < 0.005) continue
      const isDeposit = DEPOSIT_KEYWORDS_RE.test(body)
      const amount = isDeposit ? txAmt : -txAmt
      const desc = stripTrailingNumbers(body)
      if (prevBalance !== null) prevBalance += amount
      if (desc.length >= 2) results.push({ date: currentDate, amount, description: desc.slice(0, 200) })
    }
  }

  return results
}

// --- Coordinate-aware chequing parser (pdfjs-dist) -------------------------
// Reads each text item's x/y position so it knows which column (Withdrawals,
// Deposits, Balance) each number belongs to — no keyword guessing needed.
// Column boundaries are detected from the header row of the specific PDF, so
// the parser works regardless of margin or layout differences between periods.

async function parseChequingWithCoords(pdfBuffer: Buffer): Promise<ParsedRow[]> {
  // Suppress harmless canvas polyfill warnings pdfjs-dist emits in Node.js
  const origWarn = console.warn
  console.warn = () => {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfDoc: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js')
    pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise
  } finally {
    console.warn = origWarn
  }

  interface PdfItem { x: number; y: number; width: number; text: string }
  const allItems: PdfItem[] = []
  let pageYOffset = 0

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const pageHeight = (viewport as { height: number }).height

    for (const raw of content.items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = raw as any
      if (!item.str?.trim() || !Array.isArray(item.transform)) continue
      const x: number = item.transform[4]
      const yTopDown = pageHeight - item.transform[5]
      const w: number = item.width ?? 0
      allItems.push({ x, y: pageYOffset + yTopDown, width: w, text: item.str.trim() })
    }

    pageYOffset += pageHeight + 50
  }

  if (allItems.length === 0) return []

  // --- Year + end-month from statement header text -------------------------
  const fullText = allItems.map(i => i.text).join(' ')
  let startYear = new Date().getFullYear()
  let endYear = startYear
  let endMonth = 12

  const fromMatch = fullText.match(/From.*?(\d{4}).*?to.*?(\d{4})/i)
  if (fromMatch) {
    startYear = parseInt(fromMatch[1])
    endYear   = parseInt(fromMatch[2])
  }
  const endMonthMatch = fullText.match(
    /to\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i
  )
  if (endMonthMatch) {
    const key = endMonthMatch[1].toLowerCase()
    endMonth = parseInt(MONTH_MAP[key] ?? MONTH_NAME_MAP[key] ?? '12')
  }

  // --- Group items into rows by y-coordinate (4-unit tolerance for jitter) ---
  const rowMap = new Map<number, PdfItem[]>()
  for (const item of allItems) {
    const key = Math.round(item.y / 4) * 4
    if (!rowMap.has(key)) rowMap.set(key, [])
    rowMap.get(key)!.push(item)
  }
  const rows = Array.from(rowMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, items]) => items.sort((a, b) => a.x - b.x))

  // --- Find header row (contains "Withdrawals" AND "Deposits") -------------
  let headerIdx = -1
  let withdrawalLeft = 0
  let withdrawalRight = 0
  let depositRight = 0
  let balanceRight = 0

  for (let i = 0; i < rows.length; i++) {
    const rowText = rows[i].map(it => it.text).join(' ').toLowerCase()
    if (!rowText.includes('withdrawal') || !rowText.includes('deposit')) continue

    const wItem = rows[i].find(it => it.text.toLowerCase().includes('withdrawal'))
    const dItem = rows[i].find(it => it.text.toLowerCase().includes('deposit') && !it.text.toLowerCase().includes('withdrawal'))
    const bItem = rows[i].find(it => it.text.toLowerCase().includes('balance'))
    if (!wItem || !dItem || !bItem) continue

    headerIdx = i
    withdrawalLeft  = wItem.x
    withdrawalRight = wItem.x + (wItem.width > 0 ? wItem.width : wItem.text.length * 6)
    depositRight    = dItem.x + (dItem.width > 0 ? dItem.width : dItem.text.length * 6)
    balanceRight    = bItem.x + (bItem.width > 0 ? bItem.width : bItem.text.length * 6)
    break
  }

  if (headerIdx < 0) return []

  // --- Parse data rows below header ----------------------------------------
  // Numbers are right-aligned: classify by which column's right edge they're closest to.
  const NUMBER_RE = /^[\d,]+\.\d{2}$/
  const results: ParsedRow[] = []
  let currentDate: string | null = null

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const rowText = row.map(it => it.text).join(' ')

    if (/opening balance|closing balance|total deposits|total withdrawals|please (check|retain)|important information/i.test(rowText)) continue

    // Items left of withdrawal column = date + description band
    const descItems   = row.filter(it => it.x < withdrawalLeft)
    const amountItems = row.filter(it => it.x >= withdrawalLeft && NUMBER_RE.test(it.text))

    // Date detection from description band
    const descText = descItems.map(it => it.text).join(' ')
    const dateMatch = descText.match(/(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)
    if (dateMatch) {
      const day = parseInt(dateMatch[1])
      const mon = dateMatch[2].toLowerCase()
      const monthNum = parseInt(MONTH_MAP[mon])
      const year = monthNum > endMonth ? startYear : endYear
      currentDate = `${year}-${MONTH_MAP[mon]}-${String(day).padStart(2, '0')}`
    }

    if (!currentDate) continue

    const description = descText
      .replace(/\d{1,2}\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)

    if (!description || description.length < 2) continue
    if (amountItems.length === 0) continue

    // Classify each number by right-edge proximity to the column header right edges
    let withdrawal: number | null = null
    let deposit: number | null = null

    for (const item of amountItems) {
      const rightEdge = item.x + (item.width > 0 ? item.width : item.text.length * 6)
      const wDist = Math.abs(rightEdge - withdrawalRight)
      const dDist = Math.abs(rightEdge - depositRight)
      const bDist = Math.abs(rightEdge - balanceRight)

      if (bDist <= wDist && bDist <= dDist) continue // balance column → skip

      const val = parseFloat(item.text.replace(/,/g, ''))
      if (dDist < wDist) {
        deposit = val
      } else {
        withdrawal = val
      }
    }

    let amount: number | null = null
    if (withdrawal !== null && deposit === null) amount = -withdrawal
    else if (deposit !== null && withdrawal === null) amount = deposit
    else if (withdrawal !== null && deposit !== null) {
      amount = deposit > withdrawal ? deposit : -withdrawal
    }

    if (amount === null || Math.abs(amount) < 0.005) continue

    results.push({ date: currentDate, amount, description })
  }

  return results
}

async function parseTransactions(lines: string[], pdfBuffer?: Buffer): Promise<ParsedRow[]> {
  // Coordinate-aware parser first — most reliable for chequing statements
  if (pdfBuffer) {
    try {
      const coordResults = await parseChequingWithCoords(pdfBuffer)
      if (coordResults.length > 0) return coordResults
    } catch (e) {
      console.warn('parseChequingWithCoords failed, falling back:', e instanceof Error ? e.message : e)
    }
  }
  // Fallback: regex-based parsers for non-chequing or unsupported formats
  const chequingResults = parseChequingFormat(lines)
  if (chequingResults.length > 0) return chequingResults
  const multiResults = parseMultiLine(lines)
  if (multiResults.length > 0) return multiResults
  return lines.map(parseSingleLine).filter((r): r is ParsedRow => r !== null)
}

export async function POST(request: NextRequest) {
  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return createErrorResponse('No file uploaded', 400)

    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      return createErrorResponse('Only PDF files are accepted', 400)
    }
    if (file.size > 10 * 1024 * 1024) {
      return createErrorResponse('File must be 10 MB or smaller', 400)
    }

    // Read PDF bytes once — reused for storage, text extraction, and coordinate parser
    const pdfArrayBuffer = await file.arrayBuffer()
    const pdfBuffer = Buffer.from(pdfArrayBuffer)

    // Store the PDF for audit trail
    let storedFilename = file.name
    try {
      const provider = getStorageProvider(readStorageConfig())
      storedFilename = `${Date.now()}-${file.name}`
      await provider.upload(user.id, 'fino', storedFilename, pdfBuffer, 'application/pdf')
    } catch (_storageErr) {
      // Storage failure is non-fatal - we still parse and return results
    }

    // Parse PDF text with pdf-parse (used by fallback text-based parsers)
    let text = ''
    let parseWarning: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>
      const result = await pdfParse(pdfBuffer)
      text = result.text
    } catch (parseErr) {
      console.error('PDF parse error:', parseErr instanceof Error ? parseErr.message : parseErr)
      parseWarning = 'Could not extract text from this PDF. The file may be scanned (image-based) rather than text-based. Try entering transactions manually.'
    }

    const rows: ParsedRow[] = []
    const lines = text ? text.split('\n') : []
    rows.push(...await parseTransactions(lines, pdfBuffer))
    if (rows.length === 0) {
      parseWarning = parseWarning ?? 'No transactions could be extracted from this PDF. The format may not be supported - try a different bank statement export.'
    }

    if (rows.length === 0) {
      return NextResponse.json({
        inserted: 0,
        skipped: 0,
        preview: [],
        parse_warning: parseWarning,
        filename: storedFilename,
      })
    }

    // Bulk insert valid rows
    const insertValues = rows.map((r) => ({
      userId: user.id,
      date: r.date,
      amount: r.amount.toString(),
      description: r.description,
      statementSource: storedFilename,
    }))

    const inserted = await withRLS((db) =>
      db.insert(finoTransactions).values(insertValues).returning()
    )

    const preview = inserted.slice(0, 10).map((r) => ({
      ...toSnakeCase(r),
      amount: Number(r.amount),
    }))

    return NextResponse.json({
      inserted: inserted.length,
      skipped: rows.length - inserted.length,
      preview,
      parse_warning: parseWarning,
      filename: storedFilename,
    })
  } catch (error) {
    console.error('POST /api/modules/fino/statements error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
