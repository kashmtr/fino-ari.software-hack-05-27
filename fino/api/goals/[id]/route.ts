import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { validateRequestBody, createErrorResponse, toSnakeCase } from '@/lib/api-helpers'
import { UpdateGoalSchema, GoalSingleResponseSchema } from '@/modules/fino/lib/validation'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { finoGoals } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

registry.registerPath({
  method: 'put',
  path: '/api/modules/fino/goals/{id}',
  operationId: 'finoUpdateGoal',
  summary: 'Update a savings goal',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'application/json': { schema: UpdateGoalSchema } } } },
  responses: {
    200: { description: 'Updated goal', content: { 'application/json': { schema: GoalSingleResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

registry.registerPath({
  method: 'delete',
  path: '/api/modules/fino/goals/{id}',
  operationId: 'finoDeleteGoal',
  summary: 'Delete a savings goal',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } as any } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const validation = await validateRequestBody(request, UpdateGoalSchema)
    if (!validation.success) return validation.response

    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    // Fetch first to merge partial updates without clobbering unchanged fields
    const [existing] = await withRLS((db) =>
      db.select().from(finoGoals).where(and(eq(finoGoals.id, id), eq(finoGoals.userId, user.id))).limit(1)
    )
    if (!existing) return createErrorResponse('Goal not found', 404)

    const merged = {
      name: validation.data.name ?? existing.name,
      targetAmount: validation.data.target_amount !== undefined ? validation.data.target_amount.toString() : existing.targetAmount,
      targetDate: validation.data.target_date !== undefined ? (validation.data.target_date ?? null) : existing.targetDate,
      monthlyContribution: validation.data.monthly_contribution !== undefined ? validation.data.monthly_contribution.toString() : existing.monthlyContribution,
      updatedAt: new Date().toISOString(),
    }

    const [row] = await withRLS((db) =>
      db.update(finoGoals)
        .set(merged)
        .where(and(eq(finoGoals.id, id), eq(finoGoals.userId, user.id)))
        .returning()
    )

    if (!row) return createErrorResponse('Goal not found', 404)

    return NextResponse.json({ goal: normalizeGoal(row) })
  } catch (error) {
    console.error('PUT /api/modules/fino/goals/[id] error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const deleted = await withRLS((db) =>
      db.delete(finoGoals)
        .where(and(eq(finoGoals.id, id), eq(finoGoals.userId, user.id)))
        .returning({ id: finoGoals.id })
    )

    if (deleted.length === 0) return createErrorResponse('Goal not found', 404)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/modules/fino/goals/[id] error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
