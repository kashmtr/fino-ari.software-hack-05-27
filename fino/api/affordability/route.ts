import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { validateRequestBody, createErrorResponse } from '@/lib/api-helpers'
import {
  AffordabilityRequestSchema,
  AffordabilityResponseSchema,
} from '@/modules/fino/lib/validation'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { finoTransactions, finoIncomeEvents, finoGoals, finoUserProfile } from '@/lib/db/schema'
import { and, eq, gte, lte, lt, sql } from 'drizzle-orm'
import { calculateAffordability } from '@/modules/fino/lib/affordability'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function buildExplanation(opts: {
  daysElapsed: number
  daysLeft: number
  dailyRateUsed: number
  historicalDailyRate: number | null
  historicalSpendingAtThisDay: number | null
  currentMonthSpending: number
  projectedTotalSpending: number
  cartTotal: number
  goalsCommitment: number
  monthlySavingsTarget: number
  incomeUsed: number
  incomeSource: string
  projectedMonthEnd: number
}): string {
  const parts: string[] = []

  if (opts.historicalDailyRate !== null) {
    parts.push(`Your 3-month historical daily spending average is ${fmt(opts.historicalDailyRate)}/day.`)
  } else {
    parts.push(`Your spending rate so far this month is ${fmt(opts.dailyRateUsed)}/day (no historical data yet).`)
  }

  if (opts.historicalSpendingAtThisDay !== null) {
    const diff = opts.currentMonthSpending - opts.historicalSpendingAtThisDay
    const threshold = opts.historicalSpendingAtThisDay * 0.1
    const pace = diff > threshold ? 'ahead of' : diff < -threshold ? 'behind' : 'in line with'
    parts.push(
      `By day ${opts.daysElapsed} you had typically spent ${fmt(opts.historicalSpendingAtThisDay)} in past months — ` +
      `you've spent ${fmt(opts.currentMonthSpending)} so far, ${pace} your usual pace.`
    )
  } else {
    parts.push(`You've spent ${fmt(opts.currentMonthSpending)} over the first ${opts.daysElapsed} day${opts.daysElapsed !== 1 ? 's' : ''} of this month.`)
  }

  parts.push(
    `With ${opts.daysLeft} day${opts.daysLeft !== 1 ? 's' : ''} remaining, total projected spending is ${fmt(opts.projectedTotalSpending)}.`
  )

  const incomeLabel: Record<string, string> = {
    statement: 'your statement income',
    forecast: 'your forecasted income',
    historical_average: 'your 3-month average income (estimated — upload a statement for accuracy)',
    none: 'no confirmed income',
  }

  const deductions: string[] = []
  if (opts.cartTotal > 0.05) deductions.push(`this purchase (${fmt(opts.cartTotal)})`)
  if (opts.goalsCommitment > 0) deductions.push(`${fmt(opts.goalsCommitment)} in savings goals`)
  if (opts.monthlySavingsTarget > 0) deductions.push(`a ${fmt(opts.monthlySavingsTarget)} savings target`)

  const deductPart = deductions.length > 0 ? `, minus ${deductions.join(', ')}` : ''
  parts.push(
    `Against ${fmt(opts.incomeUsed)} from ${incomeLabel[opts.incomeSource] ?? 'your income'}${deductPart}, ` +
    `your projected month-end balance is ${fmt(opts.projectedMonthEnd)}.`
  )

  return parts.join(' ')
}

registry.registerPath({
  method: 'post',
  path: '/api/modules/fino/affordability',
  operationId: 'finoCheckAffordability',
  summary: 'Check if a cart total is affordable (YES / MAYBE / NO)',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'application/json': { schema: AffordabilityRequestSchema } } } },
  responses: {
    200: { description: 'Affordability verdict', content: { 'application/json': { schema: AffordabilityResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

export async function POST(request: NextRequest) {
  try {
    const validation = await validateRequestBody(request, AffordabilityRequestSchema)
    if (!validation.success) return validation.response

    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0]

    // Fetch all data in parallel via withRLS
    const [transactions, incomeEvent, goals, profileRows] = await Promise.all([
      withRLS((db) =>
        db.select()
          .from(finoTransactions)
          .where(and(eq(finoTransactions.userId, user.id), gte(finoTransactions.date, monthStart)))
      ),
      withRLS((db) =>
        db.select()
          .from(finoIncomeEvents)
          .where(and(eq(finoIncomeEvents.userId, user.id), eq(finoIncomeEvents.periodStart, monthStart)))
          .limit(1)
      ),
      withRLS((db) =>
        db.select().from(finoGoals).where(eq(finoGoals.userId, user.id))
      ),
      withRLS((db) =>
        db.select().from(finoUserProfile).where(eq(finoUserProfile.userId, user.id)).limit(1)
      ),
    ])

    // Separate income vs expense transactions this month
    const thisMonthSpending = transactions
      .filter((t) => Number(t.amount) < 0)
      .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0)
    const thisMonthIncome = transactions
      .filter((t) => Number(t.amount) > 0)
      .reduce((sum, t) => sum + Number(t.amount), 0)

    // 3-month historical income + expense rows (fetched in parallel)
    const [historicalIncomeRows, historicalExpenseRows] = await Promise.all([
      withRLS((db) =>
        db.select({ amount: finoTransactions.amount })
          .from(finoTransactions)
          .where(and(
            eq(finoTransactions.userId, user.id),
            gte(finoTransactions.date, threeMonthsAgo),
            lt(finoTransactions.date, monthStart),
            sql`${finoTransactions.amount} > 0`
          ))
      ),
      withRLS((db) =>
        db.select({ amount: finoTransactions.amount, date: finoTransactions.date })
          .from(finoTransactions)
          .where(and(
            eq(finoTransactions.userId, user.id),
            gte(finoTransactions.date, threeMonthsAgo),
            lt(finoTransactions.date, monthStart),
            sql`${finoTransactions.amount} < 0`
          ))
      ),
    ])

    const historicalTotal = historicalIncomeRows.reduce((s, r) => s + Number(r.amount), 0)
    const historicalAvg = historicalIncomeRows.length > 0 ? historicalTotal / 3 : 0

    // Historical daily spending rate: total expenses over the exact number of days in the period
    const threeMonthsAgoDate = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    const historicalPeriodDays = Math.round(
      (new Date(monthStart).getTime() - threeMonthsAgoDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    const historicalExpenseTotal = historicalExpenseRows.reduce((s, r) => s + Math.abs(Number(r.amount)), 0)
    const historicalDailyRate = historicalExpenseRows.length > 0
      ? historicalExpenseTotal / historicalPeriodDays
      : null

    // Average spending by day N of the month across the past 3 months
    const daysElapsed = now.getDate()
    const spendByMonth = new Map<string, number>()
    for (const row of historicalExpenseRows) {
      const d = new Date(row.date)
      if (d.getDate() <= daysElapsed) {
        const key = `${d.getFullYear()}-${d.getMonth()}`
        spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + Math.abs(Number(row.amount)))
      }
    }
    const monthTotals = Array.from(spendByMonth.values())
    const historicalSpendingAtThisDay = monthTotals.length > 0
      ? monthTotals.reduce((a, b) => a + b, 0) / monthTotals.length
      : null

    const profile = profileRows[0]
    const savingsBuffer = profile ? Number(profile.savingsBuffer) : 500
    const monthlySavingsTarget = profile ? Number(profile.monthlySavingsTarget) : 200
    const goalsCommitment = goals.reduce((s, g) => s + Number(g.monthlyContribution), 0)

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysLeft = daysInMonth - daysElapsed

    const result = calculateAffordability({
      cartTotal: validation.data.cart_total,
      currentMonthSpending: thisMonthSpending,
      currentMonthIncome: thisMonthIncome,
      forecastIncome: incomeEvent[0] ? Number(incomeEvent[0].amount) : null,
      historicalAvgIncome: historicalAvg,
      historicalDailyRate,
      historicalSpendingAtThisDay,
      hasStatementData: transactions.length > 0,
      goalsCommitment,
      monthlySavingsTarget,
      savingsBuffer,
      daysElapsed,
      daysInMonth,
    })

    const explanation = buildExplanation({
      daysElapsed,
      daysLeft,
      dailyRateUsed: result.dailyRateUsed,
      historicalDailyRate,
      historicalSpendingAtThisDay,
      currentMonthSpending: thisMonthSpending,
      projectedTotalSpending: result.projectedTotalSpending,
      cartTotal: validation.data.cart_total,
      goalsCommitment,
      monthlySavingsTarget,
      incomeUsed: result.incomeUsed,
      incomeSource: result.incomeSource,
      projectedMonthEnd: result.projectedMonthEnd,
    })

    return NextResponse.json({
      verdict: result.verdict,
      projected_month_end: result.projectedMonthEnd,
      projected_total_spending: result.projectedTotalSpending,
      historical_daily_rate: historicalDailyRate,
      historical_spending_at_this_day: historicalSpendingAtThisDay,
      income_used: result.incomeUsed,
      income_source: result.incomeSource,
      income_warning: result.incomeWarning,
      current_month_spending: thisMonthSpending,
      goals_commitment: goalsCommitment,
      savings_target: monthlySavingsTarget,
      savings_buffer: savingsBuffer,
      cart_total: validation.data.cart_total,
      explanation,
    })
  } catch (error) {
    console.error('POST /api/modules/fino/affordability error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
