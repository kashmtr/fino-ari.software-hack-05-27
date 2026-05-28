import type { AffordabilityVerdict } from '../types'

export interface AffordabilityInput {
  cartTotal: number
  currentMonthSpending: number   // sum of expense transactions this month (positive value)
  currentMonthIncome: number     // income transactions this month (positive value)
  forecastIncome: number | null  // from fino_income_events for this month
  historicalAvgIncome: number    // 3-month avg of statement income
  hasStatementData: boolean
  goalsCommitment: number        // sum of all goals' monthly_contribution
  monthlySavingsTarget: number   // from profile
  savingsBuffer: number          // YES threshold from profile
  historicalDailyRate: number | null         // avg daily spend from historical statements; null if no history
  historicalSpendingAtThisDay: number | null // avg spend by day N across past months; null if no history
  daysElapsed: number                        // days into the current month (1-based, today counts)
  daysInMonth: number                        // total days in the current month
}

export interface AffordabilityResult {
  verdict: AffordabilityVerdict
  projectedMonthEnd: number
  projectedTotalSpending: number
  dailyRateUsed: number
  incomeUsed: number
  incomeSource: 'statement' | 'forecast' | 'historical_average' | 'none'
  incomeWarning: boolean
}

/**
 * Resolves which income figure to use based on the income decision matrix
 * from the PXPense design doc.
 *
 * Matrix:
 *   statement + forecast → use statement (actual beats forecast)
 *   statement + no forecast → use statement
 *   no statement + forecast → use forecast
 *   no statement + no forecast → use 3-month historical avg (with warning)
 */
function resolveIncome(input: AffordabilityInput): {
  incomeUsed: number
  incomeSource: AffordabilityResult['incomeSource']
  incomeWarning: boolean
} {
  if (input.hasStatementData && input.currentMonthIncome > 0) {
    return { incomeUsed: input.currentMonthIncome, incomeSource: 'statement', incomeWarning: false }
  }
  if (input.forecastIncome !== null && input.forecastIncome > 0) {
    return { incomeUsed: input.forecastIncome, incomeSource: 'forecast', incomeWarning: false }
  }
  if (input.historicalAvgIncome > 0) {
    return { incomeUsed: input.historicalAvgIncome, incomeSource: 'historical_average', incomeWarning: true }
  }
  return { incomeUsed: 0, incomeSource: 'none', incomeWarning: true }
}

export function calculateAffordability(input: AffordabilityInput): AffordabilityResult {
  const { incomeUsed, incomeSource, incomeWarning } = resolveIncome(input)

  // Project remaining spending using historical daily rate when available,
  // falling back to current month's rate if there's no history yet.
  const daysElapsed = Math.max(1, input.daysElapsed)
  const daysLeft = Math.max(0, input.daysInMonth - daysElapsed)
  const dailyRate = input.historicalDailyRate ?? (input.currentMonthSpending / daysElapsed)
  const projectedTotalSpending = input.currentMonthSpending + dailyRate * daysLeft

  const projectedMonthEnd =
    incomeUsed
    - projectedTotalSpending
    - input.cartTotal
    - input.goalsCommitment
    - input.monthlySavingsTarget

  let verdict: AffordabilityVerdict
  if (projectedMonthEnd > input.savingsBuffer) {
    verdict = 'YES'
  } else if (projectedMonthEnd > 0) {
    verdict = 'MAYBE'
  } else {
    verdict = 'NO'
  }

  return { verdict, projectedMonthEnd, projectedTotalSpending, dailyRateUsed: dailyRate, incomeUsed, incomeSource, incomeWarning }
}
