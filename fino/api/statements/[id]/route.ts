import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { createErrorResponse } from '@/lib/api-helpers'
import { IdParamSchema } from '@/modules/fino/lib/validation'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { finoTransactions } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

registry.registerPath({
  method: 'delete',
  path: '/api/modules/fino/statements/{id}',
  operationId: 'finoDeleteTransaction',
  summary: 'Delete a single transaction by ID',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { params: IdParamSchema },
  responses: {
    200: { description: 'Transaction deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } as any } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) return createErrorResponse('Transaction ID is required', 400)

    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const deleted = await withRLS((db) =>
      db.delete(finoTransactions)
        .where(and(eq(finoTransactions.id, id), eq(finoTransactions.userId, user.id)))
        .returning({ id: finoTransactions.id })
    )

    if (deleted.length === 0) return createErrorResponse('Transaction not found', 404)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/modules/fino/statements/[id] error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
