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

    // 3-month historical average income from statement
    const historicalRows = await withRLS((db) =>
      db.select({ amount: finoTransactions.amount })
        .from(finoTransactions)
        .where(and(
          eq(finoTransactions.userId, user.id),
          gte(finoTransactions.date, threeMonthsAgo),
          lt(finoTransactions.date, monthStart),
          sql`${finoTransactions.amount} > 0`
        ))
    )
    const historicalTotal = historicalRows.reduce((s, r) => s + Number(r.amount), 0)
    const historicalAvg = historicalRows.length > 0 ? historicalTotal / 3 : 0

    const profile = profileRows[0]
    const savingsBuffer = profile ? Number(profile.savingsBuffer) : 500
    const monthlySavingsTarget = profile ? Number(profile.monthlySavingsTarget) : 200
    const goalsCommitment = goals.reduce((s, g) => s + Number(g.monthlyContribution), 0)

    const result = calculateAffordability({
      cartTotal: validation.data.cart_total,
      currentMonthSpending: thisMonthSpending,
      currentMonthIncome: thisMonthIncome,
      forecastIncome: incomeEvent[0] ? Number(incomeEvent[0].amount) : null,
      historicalAvgIncome: historicalAvg,
      hasStatementData: transactions.length > 0,
      goalsCommitment,
      monthlySavingsTarget,
      savingsBuffer,
    })

    return NextResponse.json({
      verdict: result.verdict,
      projected_month_end: result.projectedMonthEnd,
      income_used: result.incomeUsed,
      income_source: result.incomeSource,
      income_warning: result.incomeWarning,
      current_month_spending: thisMonthSpending,
      goals_commitment: goalsCommitment,
      savings_target: monthlySavingsTarget,
      savings_buffer: savingsBuffer,
      cart_total: validation.data.cart_total,
    })
  } catch (error) {
    console.error('POST /api/modules/fino/affordability error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
