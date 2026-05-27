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
  summary: 'Upload a PDF bank statement — parses text and bulk-inserts transactions',
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

// ─── PDF parsing helpers ───────────────────────────────────────────────────

interface ParsedRow {
  date: string
  amount: number
  description: string
}

const MONTH_MAP: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
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
const INLINE_AMOUNT_RE = /[-−]?\s*[£$€]?\s*([\d,]+\.?\d{0,2})\b/g

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
    const raw = match[0].replace(/,/g, '').replace(/[£$€\s]/g, '').replace('−', '-')
    const n = parseFloat(raw)
    if (!isNaN(n) && Math.abs(n) > 0) amounts.push(n)
  }
  if (amounts.length === 0) return null

  const amount = amounts[amounts.length - 1]
  const desc = trimmed
    .replace(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/gi, '')
    .replace(/[-−]?\s*[£$€]?\s*[\d,]+\.?\d{0,2}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!desc || desc.length < 2) return null
  return { date, amount, description: desc.slice(0, 200) }
}

// ─── RBC Chequing / bank statement parser ─────────────────────────────────
// Format: 5 columns (Date, Description, Withdrawals, Deposits, Balance)
// pdf-parse concatenates all columns onto each line with no separators.
// Date lines start with "D MMM" or "DD MMM" (no year).
// Lines with 2 trailing decimal amounts: first = tx amount, last = running balance.
// Lines with 1 trailing decimal amount: just the tx amount (balance not extracted).
// Continuation lines (no date) are extra description text for the previous tx date.

const CHEQ_DATE_RE = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*/i
// Two decimal amounts at end of line (commas allowed for thousands)
const TWO_AMT_RE = /([\d,]+\.\d{2})([\d,]+\.\d{2})$/
// One decimal amount at end of line
const ONE_AMT_RE = /([\d,]+\.\d{2})$/
// Keywords that identify deposit (income) transactions
const DEPOSIT_KEYWORDS_RE = /payroll deposit|deposit|e-transfer received|received|credit|salary|income|refund/i

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
    const m = line.match(/opening balance[^$\d]*([\d,.]+)/i)
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

    const twoAmt = body.match(TWO_AMT_RE)
    if (twoAmt) {
      const txAmt = parseFloat(twoAmt[1].replace(/,/g, ''))
      const newBalance = parseFloat(twoAmt[2].replace(/,/g, ''))
      if (txAmt === 0) continue

      // Sign from balance delta; fallback to keywords
      let amount: number
      if (prevBalance !== null) {
        const delta = newBalance - prevBalance
        amount = Math.abs(delta) < 1 ? txAmt : (delta > 0 ? txAmt : -txAmt)
      } else {
        amount = DEPOSIT_KEYWORDS_RE.test(body) ? txAmt : -txAmt
      }

      const desc = body.slice(0, body.length - twoAmt[0].length).trim().replace(/\s+/g, ' ')
      prevBalance = newBalance
      if (desc.length >= 2) results.push({ date: currentDate, amount, description: desc.slice(0, 200) })
      continue
    }

    const oneAmt = body.match(ONE_AMT_RE)
    if (oneAmt) {
      const txAmt = parseFloat(oneAmt[1].replace(/,/g, ''))
      if (txAmt === 0) continue

      const isDeposit = DEPOSIT_KEYWORDS_RE.test(body)
      const amount = isDeposit ? txAmt : -txAmt
      const desc = body.slice(0, body.length - oneAmt[0].length).trim().replace(/\s+/g, ' ')

      if (prevBalance !== null) prevBalance += amount
      if (desc.length >= 2) results.push({ date: currentDate, amount, description: desc.slice(0, 200) })
    }
  }

  return results
}

function parseTransactions(lines: string[]): ParsedRow[] {
  // Try chequing format first (RBC bank statement with 5 columns)
  const chequingResults = parseChequingFormat(lines)
  if (chequingResults.length > 0) return chequingResults
  // Try multi-line format (RBC credit card)
  const multiResults = parseMultiLine(lines)
  if (multiResults.length > 0) return multiResults
  // Fall back to classic single-line format
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

    // Store the PDF for audit trail
    let storedFilename = file.name
    try {
      const provider = getStorageProvider(readStorageConfig())
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      storedFilename = `${Date.now()}-${file.name}`
      await provider.upload(user.id, 'fino', storedFilename, buffer, 'application/pdf')
    } catch (_storageErr) {
      // Storage failure is non-fatal — we still parse and return results
    }

    // Parse PDF text — pdf-parse is a CJS module listed in serverExternalPackages
    let text = ''
    let parseWarning: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>
      const arrayBuffer = await file.arrayBuffer()
      const result = await pdfParse(Buffer.from(arrayBuffer))
      text = result.text
    } catch (parseErr) {
      console.error('PDF parse error:', parseErr instanceof Error ? parseErr.message : parseErr)
      parseWarning = 'Could not extract text from this PDF. The file may be scanned (image-based) rather than text-based. Try entering transactions manually.'
    }

    const rows: ParsedRow[] = []
    if (text) {
      const lines = text.split('\n')
      rows.push(...parseTransactions(lines))
      if (rows.length === 0) {
        parseWarning = 'No transactions could be extracted from this PDF. The format may not be supported — try a different bank statement export.'
      }
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
