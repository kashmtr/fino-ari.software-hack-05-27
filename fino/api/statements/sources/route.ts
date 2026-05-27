import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { createErrorResponse } from '@/lib/api-helpers'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { finoTransactions } from '@/lib/db/schema'
import { and, eq, isNotNull, desc, sql } from 'drizzle-orm'
import { z } from 'zod'

const DeleteSourceSchema = z.object({
  statement_source: z.string().min(1, 'statement_source is required'),
})

const StatementSourcesResponseSchema = z.object({
  sources: z.array(z.object({
    statement_source: z.string(),
    from_date: z.string(),
    to_date: z.string(),
    transaction_count: z.number().int(),
  })),
}).openapi('StatementSourcesResponse')

registry.registerPath({
  method: 'delete',
  path: '/api/modules/fino/statements/sources',
  operationId: 'finoDeleteStatementSource',
  summary: 'Delete all transactions belonging to a statement source',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'application/json': { schema: z.object({ statement_source: z.string() }) } } } },
  responses: {
    200: { description: 'Deleted count', content: { 'application/json': { schema: z.object({ deleted: z.number().int() }) } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/modules/fino/statements/sources',
  operationId: 'finoListStatementSources',
  summary: 'List uploaded PDF statement sources with date ranges',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  responses: {
    200: { description: 'Statement sources', content: { 'application/json': { schema: StatementSourcesResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

export async function GET(_request: NextRequest) {
  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const sources = await withRLS((db) =>
      db
        .select({
          statementSource: finoTransactions.statementSource,
          fromDate: sql<string>`min(${finoTransactions.date})`,
          toDate: sql<string>`max(${finoTransactions.date})`,
          transactionCount: sql<number>`count(*)::int`,
        })
        .from(finoTransactions)
        .where(and(
          eq(finoTransactions.userId, user.id),
          isNotNull(finoTransactions.statementSource),
        ))
        .groupBy(finoTransactions.statementSource)
        .orderBy(desc(sql`max(${finoTransactions.date})`))
    )

    return NextResponse.json({
      sources: sources.map((s) => ({
        statement_source: s.statementSource ?? '',
        from_date: s.fromDate,
        to_date: s.toDate,
        transaction_count: Number(s.transactionCount),
      })),
    })
  } catch (error) {
    console.error('GET /api/modules/fino/statements/sources error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const body = await request.json().catch(() => null)
    const parsed = DeleteSourceSchema.safeParse(body)
    if (!parsed.success) return createErrorResponse('statement_source is required', 400)

    const { statement_source } = parsed.data

    const deleted = await withRLS((db) =>
      db
        .delete(finoTransactions)
        .where(and(
          eq(finoTransactions.userId, user.id),
          eq(finoTransactions.statementSource, statement_source),
        ))
        .returning({ id: finoTransactions.id })
    )

    return NextResponse.json({ deleted: deleted.length })
  } catch (error) {
    console.error('DELETE /api/modules/fino/statements/sources error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
