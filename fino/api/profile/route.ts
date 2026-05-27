import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { validateRequestBody, createErrorResponse, toSnakeCase } from '@/lib/api-helpers'
import { UpsertProfileSchema, UserProfileSchema } from '@/modules/fino/lib/validation'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { finoUserProfile } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

const ProfileResponseSchema = UserProfileSchema.nullable()

registry.registerPath({
  method: 'get',
  path: '/api/modules/fino/profile',
  operationId: 'finoGetProfile',
  summary: 'Get user affordability profile (savings buffer + monthly target)',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  responses: {
    200: { description: 'Profile or null if not set', content: { 'application/json': { schema: ProfileResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

registry.registerPath({
  method: 'put',
  path: '/api/modules/fino/profile',
  operationId: 'finoUpsertProfile',
  summary: 'Upsert user affordability profile',
  tags: ['fino'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'application/json': { schema: UpsertProfileSchema } } } },
  responses: {
    200: { description: 'Upserted profile', content: { 'application/json': { schema: UserProfileSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

function normalizeProfile(row: typeof finoUserProfile.$inferSelect) {
  return {
    ...toSnakeCase(row),
    savings_buffer: Number(row.savingsBuffer),
    monthly_savings_target: Number(row.monthlySavingsTarget),
  }
}

export async function GET(_request: NextRequest) {
  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const [row] = await withRLS((db) =>
      db.select().from(finoUserProfile).where(eq(finoUserProfile.userId, user.id)).limit(1)
    )

    return NextResponse.json(row ? normalizeProfile(row) : null)
  } catch (error) {
    console.error('GET /api/modules/fino/profile error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const validation = await validateRequestBody(request, UpsertProfileSchema)
    if (!validation.success) return validation.response

    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) return createErrorResponse('Unauthorized', 401)

    const savingsBuffer = (validation.data.savings_buffer ?? 500).toString()
    const monthlySavingsTarget = (validation.data.monthly_savings_target ?? 200).toString()

    // Fetch existing profile to merge partial updates
    const [existing] = await withRLS((db) =>
      db.select().from(finoUserProfile).where(eq(finoUserProfile.userId, user.id)).limit(1)
    )

    const mergedBuffer = validation.data.savings_buffer !== undefined
      ? savingsBuffer
      : (existing?.savingsBuffer ?? '500')
    const mergedTarget = validation.data.monthly_savings_target !== undefined
      ? monthlySavingsTarget
      : (existing?.monthlySavingsTarget ?? '200')

    const [row] = await withRLS((db) =>
      db.insert(finoUserProfile)
        .values({ userId: user.id, savingsBuffer: mergedBuffer, monthlySavingsTarget: mergedTarget })
        .onConflictDoUpdate({
          target: finoUserProfile.userId,
          set: { savingsBuffer: mergedBuffer, monthlySavingsTarget: mergedTarget, updatedAt: sql`timezone('utc'::text, now())` },
        })
        .returning()
    )

    return NextResponse.json(normalizeProfile(row))
  } catch (error) {
    console.error('PUT /api/modules/fino/profile error:', error instanceof Error ? error.message : error)
    return createErrorResponse('Internal server error', 500)
  }
}
