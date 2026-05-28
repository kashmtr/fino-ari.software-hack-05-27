import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { validateRequestBody, createErrorResponse, toSnakeCase } from '@/lib/api-helpers'
import {
  CreateGoalSchema,
  GoalListResponseSchema,
  GoalSingleResponseSchema,
} from '@/modules/fino/lib/validation'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { finoGoals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

registry.registerPath({
  method: 'get',
  path: '/api/modules/fino/goals',
  operationId: 'finoListGoals',
  summary: 'List all savings goals',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  responses: {
    200: { description: 'Goals list', content: { 'application/json': { schema: GoalListResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/modules/fino/goals',
  operationId: 'finoCreateGoal',
  summary: 'Create a new savings goal',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'application/json': { schema: CreateGoalSchema } } } },
  responses: {
    201: { description: 'Created goal', content: { 'application/json': { schema: GoalSingleResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

function normalizeGoal(row: typeof finoGoals.$inferSelect) {
  return {
    ...toSnakeCase(row),
    target_amount: Number(row.targetAmount),
    monthly_contribution: Number(row.monthlyContribution),
  }
}

export async function GET(_request: NextRequest) {
  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const rows = await withRLS((db) =>
      db.select().from(finoGoals).where(eq(finoGoals.userId, user.id))
    )

    return NextResponse.json({ goals: rows.map(normalizeGoal) })
  } catch (error) {
    console.error('GET /api/modules/fino/goals error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const validation = await validateRequestBody(request, CreateGoalSchema)
    if (!validation.success) return validation.response

    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const { name, target_amount, target_date, monthly_contribution } = validation.data

    const [row] = await withRLS((db) =>
      db.insert(finoGoals).values({
        userId: user.id,
        name,
        targetAmount: target_amount.toString(),
        targetDate: target_date ?? null,
        monthlyContribution: monthly_contribution.toString(),
      }).returning()
    )

    return NextResponse.json({ goal: normalizeGoal(row) }, { status: 201 })
  } catch (error) {
    console.error('POST /api/modules/fino/goals error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
