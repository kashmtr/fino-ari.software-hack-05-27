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
}

export interface AffordabilityResult {
  verdict: AffordabilityVerdict
  projectedMonthEnd: number
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

  const projectedMonthEnd =
    incomeUsed
    - input.currentMonthSpending
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

  return { verdict, projectedMonthEnd, incomeUsed, incomeSource, incomeWarning }
}
