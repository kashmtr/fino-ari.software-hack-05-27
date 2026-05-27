// ─── Database row types ──────────────────────────────────────────────────

export interface FinoTransaction {
  id: string
  user_id: string
  date: string            // ISO date string (YYYY-MM-DD)
  amount: number          // negative = expense, positive = income
  description: string
  statement_source: string | null
  created_at: string
}

export interface FinoIncomeEvent {
  id: string
  user_id: string
  amount: number
  period_start: string    // YYYY-MM-DD (first day of month)
  period_end: string      // YYYY-MM-DD (last day of month)
  note: string | null
  created_at: string
  updated_at: string
}

export interface FinoGoal {
  id: string
  user_id: string
  name: string
  target_amount: number
  target_date: string | null   // YYYY-MM-DD
  monthly_contribution: number
  created_at: string
  updated_at: string
}

export interface FinoUserProfile {
  id: string
  user_id: string
  savings_buffer: number
  monthly_savings_target: number
  created_at: string
  updated_at: string
}

// ─── Request types ───────────────────────────────────────────────────────

export interface CreateGoalRequest {
  name: string
  target_amount: number
  target_date?: string | null
  monthly_contribution: number
}

export interface UpdateGoalRequest {
  name?: string
  target_amount?: number
  target_date?: string | null
  monthly_contribution?: number
}

export interface UpsertIncomeRequest {
  amount: number
  period_start: string   // YYYY-MM-DD, first day of the target month
  note?: string | null
}

export interface UpsertProfileRequest {
  savings_buffer?: number
  monthly_savings_target?: number
}

export interface AffordabilityRequest {
  cart_total: number
}

// ─── Response types ──────────────────────────────────────────────────────

export type AffordabilityVerdict = 'YES' | 'MAYBE' | 'NO'

export interface AffordabilityResponse {
  verdict: AffordabilityVerdict
  projected_month_end: number
  income_used: number
  income_source: 'statement' | 'forecast' | 'historical_average' | 'none'
  income_warning: boolean
  current_month_spending: number
  goals_commitment: number
  savings_target: number
  savings_buffer: number
  cart_total: number
}

export interface StatementSource {
  statement_source: string  // stored filename (may have timestamp prefix)
  from_date: string         // YYYY-MM-DD
  to_date: string           // YYYY-MM-DD
  transaction_count: number
}

export interface StatementSourcesResponse {
  sources: StatementSource[]
}

export interface StatementUploadResponse {
  inserted: number
  skipped: number
  preview: FinoTransaction[]
  parse_warning: string | null
  filename: string
}

export interface TransactionListResponse {
  transactions: FinoTransaction[]
  count: number
}

export interface GoalListResponse {
  goals: FinoGoal[]
}

export interface ApiErrorResponse {
  error: string
  details?: unknown
}

// ─── Settings (onboarding) ───────────────────────────────────────────────

export interface FinoSettings {
  onboardingCompleted: boolean
}
