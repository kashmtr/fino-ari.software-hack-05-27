'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TrendingUp, TrendingDown, Target, ArrowRight, Loader2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { AffordabilityResponse, FinoGoal } from '../types'

function VerdictChip({ verdict }: { verdict: string }) {
  const styles: Record<string, string> = {
    YES: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    MAYBE: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    NO: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${styles[verdict] ?? styles['MAYBE']}`}>
      {verdict}
    </span>
  )
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function FinoDashboardWidget() {
  const now = new Date()
  const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' })

  const { data: affordability, isLoading: affLoading } = useQuery({
    queryKey: ['fino-dashboard-affordability'],
    queryFn: async (): Promise<AffordabilityResponse | null> => {
      const res = await fetch('/api/modules/fino/affordability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_total: 0.01 }), // tiny amount to get current state
      })
      if (!res.ok) return null
      return res.json()
    },
    staleTime: 60_000,
  })

  const { data: goals = [] } = useQuery<FinoGoal[]>({
    queryKey: ['fino-goals'],
    queryFn: async () => {
      const res = await fetch('/api/modules/fino/goals')
      if (!res.ok) return []
      return (await res.json()).goals || []
    },
    staleTime: 60_000,
  })

  const totalCommitment = goals.reduce((s, g) => s + g.monthly_contribution, 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Image src="/fino-logo.png" alt="Fino" width={80} height={80} className="rounded-full object-contain" />
          Fino — {monthLabel}
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/fino" className="text-xs text-muted-foreground flex items-center gap-1">
            Manage <ArrowRight className="size-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {affLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !affordability ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No data yet —{' '}
            <Link href="/fino" className="underline">upload a statement</Link> to get started.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Projected balance */}
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Projected month-end</p>
                <p className={`text-2xl font-bold ${affordability.projected_month_end >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {formatCurrency(affordability.projected_month_end)}
                </p>
              </div>
              <VerdictChip verdict={affordability.verdict} />
            </div>

            {/* Income vs Spending */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-3.5 text-green-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Income</p>
                  <p className="font-medium">{formatCurrency(affordability.income_used)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingDown className="size-3.5 text-red-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Spent</p>
                  <p className="font-medium">{formatCurrency(affordability.current_month_spending)}</p>
                </div>
              </div>
            </div>

            {/* Income progress bar */}
            {affordability.income_used > 0 && (
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Spending</span>
                  <span>{Math.round((affordability.current_month_spending / affordability.income_used) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (affordability.current_month_spending / affordability.income_used) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Goals */}
            {goals.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-3">
                <Target className="size-3.5" />
                <span>{goals.length} active goal{goals.length !== 1 ? 's' : ''}</span>
                <span className="ml-auto">{formatCurrency(totalCommitment)}/mo committed</span>
              </div>
            )}

            {affordability.income_warning && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ Income estimated — upload a statement for accuracy
              </p>
            )}

            {affordability.explanation && (
              <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed">
                {affordability.explanation}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
