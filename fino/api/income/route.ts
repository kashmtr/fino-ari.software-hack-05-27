import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { validateRequestBody, createErrorResponse, toSnakeCase } from '@/lib/api-helpers'
import { UpsertIncomeSchema, IncomeEventSchema } from '@/modules/fino/lib/validation'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { finoIncomeEvents } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'

const IncomeResponseSchema = IncomeEventSchema.nullable()

registry.registerPath({
  method: 'get',
  path: '/api/modules/fino/income',
  operationId: 'finoGetIncome',
  summary: "Get the current month's income forecast (null if not set)",
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  responses: {
    200: { description: 'Income event or null', content: { 'application/json': { schema: IncomeResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

registry.registerPath({
  method: 'put',
  path: '/api/modules/fino/income',
  operationId: 'finoUpsertIncome',
  summary: 'Set (upsert) income forecast for a given month',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'application/json': { schema: UpsertIncomeSchema } } } },
  responses: {
    200: { description: 'Upserted income event', content: { 'application/json': { schema: IncomeEventSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

function normalizeIncome(row: typeof finoIncomeEvents.$inferSelect) {
  return { ...toSnakeCase(row), amount: Number(row.amount) }
}

export async function GET(_request: NextRequest) {
  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

    const [row] = await withRLS((db) =>
      db.select()
        .from(finoIncomeEvents)
        .where(and(eq(finoIncomeEvents.userId, user.id), eq(finoIncomeEvents.periodStart, monthStart)))
        .limit(1)
    )

    return NextResponse.json(row ? normalizeIncome(row) : null)
  } catch (error) {
    console.error('GET /api/modules/fino/income error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const validation = await validateRequestBody(request, UpsertIncomeSchema)
    if (!validation.success) return validation.response

    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const { amount, period_start, note } = validation.data
    const periodDate = new Date(period_start)
    const periodEnd = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0).toISOString().split('T')[0]

    const [row] = await withRLS((db) =>
      db.insert(finoIncomeEvents)
        .values({
          userId: user.id,
          amount: amount.toString(),
          periodStart: period_start,
          periodEnd,
          note: note ?? null,
        })
        .onConflictDoUpdate({
          target: [finoIncomeEvents.userId, finoIncomeEvents.periodStart],
          set: {
            amount: amount.toString(),
            note: note ?? null,
            updatedAt: sql`timezone('utc'::text, now())`,
          },
        })
        .returning()
    )

    return NextResponse.json(normalizeIncome(row))
  } catch (error) {
    console.error('PUT /api/modules/fino/income error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
