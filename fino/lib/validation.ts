import { z } from 'zod'
import '@/lib/openapi/registry'

const uuidSchema = z.string().uuid('Invalid ID format')

// ISO date (YYYY-MM-DD)
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')

// ─── Affordability ────────────────────────────────────────────────────────

export const AffordabilityRequestSchema = z.object({
  cart_total: z.number().positive('Cart total must be a positive number'),
}).openapi('FinoAffordabilityRequest')

export const AffordabilityResponseSchema = z.object({
  verdict: z.enum(['YES', 'MAYBE', 'NO']),
  projected_month_end: z.number(),
  income_used: z.number(),
  income_source: z.enum(['statement', 'forecast', 'historical_average', 'none']),
  income_warning: z.boolean(),
  current_month_spending: z.number(),
  goals_commitment: z.number(),
  savings_target: z.number(),
  savings_buffer: z.number(),
  cart_total: z.number(),
}).openapi('FinoAffordabilityResponse')

// ─── Transactions ─────────────────────────────────────────────────────────

export const TransactionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  date: z.string(),
  amount: z.number(),
  description: z.string(),
  statement_source: z.string().nullable(),
  created_at: z.string(),
}).openapi('FinoTransaction')

export const TransactionListResponseSchema = z.object({
  transactions: z.array(TransactionSchema),
  count: z.number().int().nonnegative(),
}).openapi('FinoTransactionListResponse')

export const ListTransactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format').optional(),
})

// Multipart PDF upload
export const UploadStatementFormSchema = z.object({
  file: z.any().openapi({ type: 'string', format: 'binary' }),
}).openapi('FinoUploadStatementForm')

export const UploadStatementResponseSchema = z.object({
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  preview: z.array(TransactionSchema),
  parse_warning: z.string().nullable(),
  filename: z.string(),
}).openapi('FinoUploadStatementResponse')

// ─── Goals ────────────────────────────────────────────────────────────────

export const GoalSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  name: z.string(),
  target_amount: z.number(),
  target_date: z.string().nullable(),
  monthly_contribution: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi('FinoGoal')

export const GoalListResponseSchema = z.object({
  goals: z.array(GoalSchema),
}).openapi('FinoGoalListResponse')

export const GoalSingleResponseSchema = z.object({
  goal: GoalSchema,
}).openapi('FinoGoalSingleResponse')

export const CreateGoalSchema = z.object({
  name: z.string().min(1, 'Goal name is required').max(100, 'Goal name must be 100 characters or fewer'),
  target_amount: z.number().positive('Target amount must be a positive number'),
  target_date: dateSchema.nullable().optional(),
  monthly_contribution: z.number().min(0, 'Monthly contribution cannot be negative'),
}).openapi('FinoCreateGoalBody')

export const UpdateGoalSchema = z.object({
  name: z.string().min(1, 'Goal name is required').max(100, 'Goal name must be 100 characters or fewer').optional(),
  target_amount: z.number().positive('Target amount must be a positive number').optional(),
  target_date: dateSchema.nullable().optional(),
  monthly_contribution: z.number().min(0, 'Monthly contribution cannot be negative').optional(),
}).openapi('FinoUpdateGoalBody')

// ─── Income ───────────────────────────────────────────────────────────────

export const IncomeEventSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  amount: z.number(),
  period_start: z.string(),
  period_end: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi('FinoIncomeEvent')

export const UpsertIncomeSchema = z.object({
  amount: z.number().positive('Income amount must be a positive number'),
  period_start: dateSchema,
  note: z.string().max(200, 'Note must be 200 characters or fewer').nullable().optional(),
}).openapi('FinoUpsertIncomeBody')

// ─── Profile ──────────────────────────────────────────────────────────────

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  savings_buffer: z.number(),
  monthly_savings_target: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi('FinoUserProfile')

export const UpsertProfileSchema = z.object({
  savings_buffer: z.number().min(0, 'Savings buffer cannot be negative').optional(),
  monthly_savings_target: z.number().min(0, 'Monthly savings target cannot be negative').optional(),
}).openapi('FinoUpsertProfileBody')

// ─── Settings ─────────────────────────────────────────────────────────────

export const FinoSettingsSchema = z.object({
  onboardingCompleted: z.boolean().optional(),
}).strict().openapi('FinoSettings')

export const SettingsSavedSchema = z.object({
  success: z.literal(true),
}).openapi('FinoSettingsSaved')

// ─── Shared ───────────────────────────────────────────────────────────────

export const DeleteQuerySchema = z.object({
  id: uuidSchema,
})
