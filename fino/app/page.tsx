'use client'

import { useState, useCallback, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useToast } from '@/hooks/use-toast'
import {
  Wallet, Upload, Target, TrendingUp, Settings, Trash2, Plus, Loader2,
  CheckCircle2, AlertCircle, Info, FileText, ArrowLeftRight,
} from 'lucide-react'
import {
  useFinoSettings, useUpdateFinoSettings,
  useFinoTransactions, useUploadFinoStatement, useDeleteFinoTransaction,
  useFinoStatementSources, useDeleteFinoStatementSource,
  useFinoGoals, useCreateFinoGoal, useUpdateFinoGoal, useDeleteFinoGoal,
  useFinoIncome, useUpsertFinoIncome,
  useFinoProfile, useUpsertFinoProfile,
  useFinoAffordability,
} from '../hooks/use-fino'
import type { CreateGoalRequest, FinoGoal } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
}

function currentMonthStart() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ─── Verdict chip ─────────────────────────────────────────────────────────────

function VerdictChip({ verdict }: { verdict: string }) {
  if (verdict === 'YES') return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"><CheckCircle2 className="size-3.5" /> Comfortable</span>
  if (verdict === 'MAYBE') return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"><AlertCircle className="size-3.5" /> Tight</span>
  return <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"><AlertCircle className="size-3.5" /> Risky</span>
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const [incomeAmount, setIncomeAmount] = useState('')
  const [savingsBuffer, setSavingsBuffer] = useState('500')
  const [monthlySavingsTarget, setMonthlySavingsTarget] = useState('200')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { toast } = useToast()

  const upsertIncome = useUpsertFinoIncome()
  const upsertProfile = useUpsertFinoProfile()
  const updateSettings = useUpdateFinoSettings()
  const uploadStatement = useUploadFinoStatement()
  const fileRef = useRef<HTMLInputElement>(null)

  const [uploadResult, setUploadResult] = useState<{ inserted: number; parse_warning: string | null } | null>(null)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await uploadStatement.mutateAsync(file)
      setUploadResult({ inserted: result.inserted, parse_warning: result.parse_warning })
    } catch (err) {
      toast({ variant: 'destructive', title: 'Upload failed', description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  async function handleFinish() {
    const errs: Record<string, string> = {}
    const income = parseFloat(incomeAmount)
    const buffer = parseFloat(savingsBuffer)
    const target = parseFloat(monthlySavingsTarget)

    if (step === 1) {
      if (isNaN(income) || income <= 0) errs.income = 'Enter a valid monthly income'
      setErrors(errs)
      if (Object.keys(errs).length > 0) return

      try {
        await upsertIncome.mutateAsync({ amount: income, period_start: currentMonthStart() })
        setStep(2)
        setErrors({})
      } catch (err) {
        toast({ variant: 'destructive', title: 'Error', description: err instanceof Error ? err.message : 'Failed to save' })
      }
      return
    }

    if (step === 2) {
      if (isNaN(buffer) || buffer < 0) errs.savingsBuffer = 'Enter a valid savings buffer (0 or more)'
      if (isNaN(target) || target < 0) errs.monthlySavingsTarget = 'Enter a valid monthly savings target (0 or more)'
      setErrors(errs)
      if (Object.keys(errs).length > 0) return

      try {
        await upsertProfile.mutateAsync({ savings_buffer: buffer, monthly_savings_target: target })
        await updateSettings.mutateAsync({ onboardingCompleted: true })
        onComplete()
      } catch (err) {
        toast({ variant: 'destructive', title: 'Error', description: err instanceof Error ? err.message : 'Failed to save' })
      }
    }
  }

  const steps = [
    { title: 'Upload a bank statement', desc: 'Import your transactions from a PDF bank statement. You can skip this and add data later.' },
    { title: 'Set your monthly income', desc: 'How much do you earn this month? Used to forecast your balance.' },
    { title: 'Configure your targets', desc: 'Set a savings buffer (the minimum balance you want to keep) and a monthly savings target.' },
  ]

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Welcome to Fino</CardTitle>
          <CardDescription>Step {step + 1} of 3 — {steps[step].title}</CardDescription>
          <p className="text-sm text-muted-foreground mt-1">{steps[step].desc}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
              <Button
                variant="outline"
                className="w-full h-24 flex flex-col gap-2 border-dashed"
                onClick={() => fileRef.current?.click()}
                disabled={uploadStatement.isPending}
              >
                {uploadStatement.isPending ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
                <span className="text-sm">{uploadStatement.isPending ? 'Parsing PDF…' : 'Click to upload PDF bank statement'}</span>
              </Button>
              {uploadResult && (
                <div className={`rounded-md p-3 text-sm ${uploadResult.parse_warning ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300' : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'}`}>
                  {uploadResult.parse_warning
                    ? `⚠ ${uploadResult.parse_warning}`
                    : `✓ Imported ${uploadResult.inserted} transaction${uploadResult.inserted !== 1 ? 's' : ''}`}
                </div>
              )}
              <Button className="w-full" onClick={() => setStep(1)}>
                {uploadResult ? 'Continue' : 'Skip for now'}
              </Button>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-1">
                <Label htmlFor="income">Monthly income ($)</Label>
                <Input
                  id="income"
                  type="number"
                  placeholder="e.g. 3000"
                  value={incomeAmount}
                  onChange={(e) => { setIncomeAmount(e.target.value); if (errors.income) setErrors((p) => { const n = { ...p }; delete n.income; return n }) }}
                  className={errors.income ? 'border-red-500 focus-visible:ring-red-500' : ''}
                />
                {errors.income && <p className="text-xs text-red-500">{errors.income}</p>}
              </div>
              <Button className="w-full" onClick={handleFinish} disabled={upsertIncome.isPending}>
                {upsertIncome.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Continue
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-1">
                <Label htmlFor="buffer">Savings buffer ($)</Label>
                <Input
                  id="buffer"
                  type="number"
                  value={savingsBuffer}
                  onChange={(e) => { setSavingsBuffer(e.target.value); if (errors.savingsBuffer) setErrors((p) => { const n = { ...p }; delete n.savingsBuffer; return n }) }}
                  className={errors.savingsBuffer ? 'border-red-500 focus-visible:ring-red-500' : ''}
                />
                <p className="text-xs text-muted-foreground">The minimum month-end balance for a "Comfortable" verdict</p>
                {errors.savingsBuffer && <p className="text-xs text-red-500">{errors.savingsBuffer}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="target">Monthly savings target ($)</Label>
                <Input
                  id="target"
                  type="number"
                  value={monthlySavingsTarget}
                  onChange={(e) => { setMonthlySavingsTarget(e.target.value); if (errors.monthlySavingsTarget) setErrors((p) => { const n = { ...p }; delete n.monthlySavingsTarget; return n }) }}
                  className={errors.monthlySavingsTarget ? 'border-red-500 focus-visible:ring-red-500' : ''}
                />
                <p className="text-xs text-muted-foreground">Reserved from income each month before anything else</p>
                {errors.monthlySavingsTarget && <p className="text-xs text-red-500">{errors.monthlySavingsTarget}</p>}
              </div>
              <Button className="w-full" onClick={handleFinish} disabled={upsertProfile.isPending || updateSettings.isPending}>
                {(upsertProfile.isPending || updateSettings.isPending) ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Get Started
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const [previewAmount, setPreviewAmount] = useState('')
  const cartTotal = parseFloat(previewAmount) || 0
  const { data: affordability, isLoading } = useFinoAffordability(cartTotal)
  const { data: goals = [] } = useFinoGoals()
  const { data: transactions = [] } = useFinoTransactions(currentMonth())
  const { data: income } = useFinoIncome()
  const { data: profile } = useFinoProfile()

  const spending = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)

  return (
    <div className="space-y-6">
      {/* Affordability checker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Affordability Check</CardTitle>
          <CardDescription>Enter a purchase amount to see if you can afford it</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                placeholder="0.00"
                value={previewAmount}
                onChange={(e) => setPreviewAmount(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>
          {cartTotal > 0 && (
            isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Calculating…
              </div>
            ) : affordability ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Verdict</span>
                  <VerdictChip verdict={affordability.verdict} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-muted/50 rounded-md p-3">
                    <p className="text-xs text-muted-foreground">Projected month-end</p>
                    <p className={`font-semibold ${affordability.projected_month_end >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {fmt(affordability.projected_month_end)}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-md p-3">
                    <p className="text-xs text-muted-foreground">After purchase</p>
                    <p className="font-semibold">{fmt(affordability.projected_month_end)}</p>
                  </div>
                </div>
                {affordability.income_warning && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Info className="size-3" /> Income estimated — upload a statement for accuracy
                  </p>
                )}
                {affordability.explanation && (
                  <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
                    {affordability.explanation}
                  </p>
                )}
              </div>
            ) : null
          )}
        </CardContent>
      </Card>

      {/* This month snapshot */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Income this month</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{fmt(income?.amount ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Spent this month</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400">{fmt(spending)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Active goals</p>
            <p className="text-xl font-bold">{goals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Savings buffer</p>
            <p className="text-xl font-bold">{fmt(profile?.savings_buffer ?? 500)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent transactions */}
      {transactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {transactions.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{t.description}</p>
                    <p className="text-xs text-muted-foreground">{t.date}</p>
                  </div>
                  <span className={`font-medium ml-4 ${t.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {t.amount >= 0 ? '+' : ''}{fmt(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Transactions tab ─────────────────────────────────────────────────────────

function formatDateRange(from: string, to: string) {
  const fmt = (d: string) => {
    const dt = new Date(d + 'T00:00:00')
    return dt.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  return `${fmt(from)} – ${fmt(to)}`
}

function cleanFilename(stored: string) {
  // Strip leading timestamp prefix added on upload (e.g. "1748393234-filename.pdf")
  return stored.replace(/^\d{10,13}-/, '')
}

function TransactionsTab() {
  const [month, setMonth] = useState(currentMonth())
  const { data: transactions = [], isLoading } = useFinoTransactions(month)
  const { data: statementSources = [] } = useFinoStatementSources()
  const uploadStatement = useUploadFinoStatement()
  const deleteTransaction = useDeleteFinoTransaction()
  const deleteSource = useDeleteFinoStatementSource()
  const fileRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const [uploadResult, setUploadResult] = useState<{ inserted: number; parse_warning: string | null } | null>(null)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await uploadStatement.mutateAsync(file)
      setUploadResult({ inserted: result.inserted, parse_warning: result.parse_warning })
      if (result.inserted > 0) {
        toast({ title: `Imported ${result.inserted} transaction${result.inserted !== 1 ? 's' : ''}` })
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Upload failed', description: err instanceof Error ? err.message : 'Unknown error' })
    }
    e.target.value = ''
  }

  async function handleDelete(id: string) {
    try {
      await deleteTransaction.mutateAsync(id)
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  const spending = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const income = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-40"
        />
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleUpload} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadStatement.isPending}>
          {uploadStatement.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Upload className="size-4 mr-2" />}
          Upload PDF Statement
        </Button>
      </div>

      {uploadResult?.parse_warning && (
        <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-md p-3 text-sm">
          ⚠ {uploadResult.parse_warning}
        </div>
      )}

      {statementSources.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Uploaded Statements</p>
          <div className="space-y-1">
            {statementSources.map((s) => (
              <div key={s.statement_source} className="flex items-center gap-3 py-2 px-3 rounded-md bg-muted/30 group">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{cleanFilename(s.statement_source)}</p>
                  <p className="text-xs text-muted-foreground">{formatDateRange(s.from_date, s.to_date)}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{s.transaction_count} tx</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  disabled={deleteSource.isPending}
                  onClick={async () => {
                    try {
                      const result = await deleteSource.mutateAsync(s.statement_source)
                      toast({ title: `Deleted ${result.deleted} transaction${result.deleted !== 1 ? 's' : ''}` })
                    } catch (err) {
                      toast({ variant: 'destructive', title: 'Delete failed', description: err instanceof Error ? err.message : 'Unknown error' })
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {transactions.length > 0 && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-md p-3">
            <p className="text-xs text-muted-foreground">Income</p>
            <p className="font-semibold text-green-700 dark:text-green-400">{fmt(income)}</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-md p-3">
            <p className="text-xs text-muted-foreground">Spending</p>
            <p className="font-semibold text-red-700 dark:text-red-400">{fmt(spending)}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="size-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No transactions for this month</p>
          <p className="text-xs mt-1">Upload a PDF bank statement to import them</p>
        </div>
      ) : (
        <div className="space-y-1">
          {transactions.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 group">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{t.description}</p>
                <p className="text-xs text-muted-foreground">{t.date}{t.statement_source ? ` · ${t.statement_source}` : ''}</p>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <span className={`text-sm font-medium ${t.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {t.amount >= 0 ? '+' : ''}{fmt(t.amount)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0 opacity-0 group-hover:opacity-100"
                  onClick={() => handleDelete(t.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Goals tab ────────────────────────────────────────────────────────────────

type GoalErrors = Record<string, string>

function GoalsTab() {
  const { data: goals = [], isLoading } = useFinoGoals()
  const createGoal = useCreateFinoGoal()
  const updateGoal = useUpdateFinoGoal()
  const deleteGoal = useDeleteFinoGoal()
  const { toast } = useToast()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editGoal, setEditGoal] = useState<FinoGoal | null>(null)
  const [form, setForm] = useState<CreateGoalRequest>({ name: '', target_amount: 0, monthly_contribution: 0, target_date: null })
  const [errors, setErrors] = useState<GoalErrors>({})

  function openCreate() {
    setEditGoal(null)
    setForm({ name: '', target_amount: 0, monthly_contribution: 0, target_date: null })
    setErrors({})
    setDialogOpen(true)
  }

  function openEdit(goal: FinoGoal) {
    setEditGoal(goal)
    setForm({ name: goal.name, target_amount: goal.target_amount, monthly_contribution: goal.monthly_contribution, target_date: goal.target_date })
    setErrors({})
    setDialogOpen(true)
  }

  function validateForm(): GoalErrors {
    const errs: GoalErrors = {}
    if (!form.name.trim()) errs.name = 'Goal name is required'
    if (form.name.length > 100) errs.name = 'Goal name must be 100 characters or fewer'
    if (!form.target_amount || form.target_amount <= 0) errs.target_amount = 'Target amount must be a positive number'
    if (form.monthly_contribution < 0) errs.monthly_contribution = 'Monthly contribution cannot be negative'
    return errs
  }

  function updateField<K extends keyof CreateGoalRequest>(key: K, value: CreateGoalRequest[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => { const next = { ...prev }; delete next[key]; return next })
  }

  function inputClass(field: string) {
    return errors[field] ? 'border-red-500 focus-visible:ring-red-500' : ''
  }

  function handleSave() {
    const fieldErrors = validateForm()
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return

    if (editGoal) {
      updateGoal.mutate(
        { id: editGoal.id, name: form.name, target_amount: form.target_amount, monthly_contribution: form.monthly_contribution, target_date: form.target_date },
        {
          onSuccess: () => setDialogOpen(false),
          onError: (err) => toast({ variant: 'destructive', title: 'Failed to update goal', description: err.message }),
        }
      )
    } else {
      createGoal.mutate(form, {
        onSuccess: () => setDialogOpen(false),
        onError: (err) => toast({ variant: 'destructive', title: 'Failed to create goal', description: err.message }),
      })
    }
  }

  const totalCommitment = goals.reduce((s, g) => s + g.monthly_contribution, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {goals.length > 0 && <span>Total monthly commitment: <strong>{fmt(totalCommitment)}</strong></span>}
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="size-4 mr-1" /> Add Goal</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : goals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="size-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No savings goals yet</p>
          <p className="text-xs mt-1">Add a goal to include monthly contributions in your affordability check</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((goal) => (
            <Card key={goal.id} className="relative group">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{goal.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Target: {fmt(goal.target_amount)}
                      {goal.target_date && ` · by ${goal.target_date}`}
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => openEdit(goal)}>
                      <Settings className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0"
                      onClick={() => deleteGoal.mutate(goal.id, {
                        onError: (err) => toast({ variant: 'destructive', title: 'Delete failed', description: err.message }),
                      })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm font-semibold mt-2 text-primary">{fmt(goal.monthly_contribution)}/mo</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editGoal ? 'Edit Goal' : 'New Goal'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="goal-name">Goal name</Label>
              <Input id="goal-name" maxLength={100} value={form.name} onChange={(e) => updateField('name', e.target.value)} className={inputClass('name')} />
              {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal-target">Target amount ($)</Label>
              <Input id="goal-target" type="number" min="0" value={form.target_amount || ''} onChange={(e) => updateField('target_amount', parseFloat(e.target.value) || 0)} className={inputClass('target_amount')} />
              {errors.target_amount && <p className="text-xs text-red-500">{errors.target_amount}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal-contribution">Monthly contribution ($)</Label>
              <Input id="goal-contribution" type="number" min="0" value={form.monthly_contribution || ''} onChange={(e) => updateField('monthly_contribution', parseFloat(e.target.value) || 0)} className={inputClass('monthly_contribution')} />
              {errors.monthly_contribution && <p className="text-xs text-red-500">{errors.monthly_contribution}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal-date">Target date (optional)</Label>
              <Input id="goal-date" type="date" value={form.target_date ?? ''} onChange={(e) => updateField('target_date', e.target.value || null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createGoal.isPending || updateGoal.isPending}>
              {(createGoal.isPending || updateGoal.isPending) ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {editGoal ? 'Save changes' : 'Create goal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Income tab ───────────────────────────────────────────────────────────────

function IncomeTab() {
  const { data: income, isLoading } = useFinoIncome()
  const upsertIncome = useUpsertFinoIncome()
  const { toast } = useToast()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const now = new Date()
  const periodStart = currentMonthStart()
  const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' })

  function handleSave() {
    const errs: Record<string, string> = {}
    const n = parseFloat(amount)
    if (isNaN(n) || n <= 0) errs.amount = 'Enter a valid positive income amount'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    upsertIncome.mutate(
      { amount: n, period_start: periodStart, note: note || null },
      {
        onSuccess: () => toast({ title: 'Income updated' }),
        onError: (err) => toast({ variant: 'destructive', title: 'Failed to save', description: err.message }),
      }
    )
  }

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>

  return (
    <div className="max-w-sm space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Set your forecasted income for <strong>{monthLabel}</strong>. This is used in the affordability calculation when you haven't uploaded statement data yet.
        </p>
        {income && (
          <p className="text-sm mt-2">Current: <strong>{fmt(income.amount)}</strong></p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="income-amount">Monthly income ($)</Label>
        <Input
          id="income-amount"
          type="number"
          placeholder={income ? income.amount.toString() : 'e.g. 3000'}
          value={amount}
          onChange={(e) => { setAmount(e.target.value); if (errors.amount) setErrors({}) }}
          className={errors.amount ? 'border-red-500 focus-visible:ring-red-500' : ''}
        />
        {errors.amount && <p className="text-xs text-red-500">{errors.amount}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="income-note">Note (optional)</Label>
        <Input id="income-note" maxLength={200} placeholder="e.g. Salary + freelance" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button onClick={handleSave} disabled={upsertIncome.isPending}>
        {upsertIncome.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
        Save income
      </Button>
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const { data: profile, isLoading } = useFinoProfile()
  const upsertProfile = useUpsertFinoProfile()
  const { toast } = useToast()
  const [savingsBuffer, setSavingsBuffer] = useState('')
  const [monthlySavingsTarget, setMonthlySavingsTarget] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const currentBuffer = savingsBuffer !== '' ? savingsBuffer : (profile?.savings_buffer?.toString() ?? '500')
  const currentTarget = monthlySavingsTarget !== '' ? monthlySavingsTarget : (profile?.monthly_savings_target?.toString() ?? '200')

  function handleSave() {
    const errs: Record<string, string> = {}
    const buf = parseFloat(currentBuffer)
    const tgt = parseFloat(currentTarget)
    if (isNaN(buf) || buf < 0) errs.savingsBuffer = 'Must be 0 or more'
    if (isNaN(tgt) || tgt < 0) errs.monthlySavingsTarget = 'Must be 0 or more'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    upsertProfile.mutate(
      { savings_buffer: buf, monthly_savings_target: tgt },
      {
        onSuccess: () => toast({ title: 'Settings saved' }),
        onError: (err) => toast({ variant: 'destructive', title: 'Failed to save', description: err.message }),
      }
    )
  }

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>

  return (
    <div className="max-w-sm space-y-4">
      <div className="space-y-1">
        <Label htmlFor="settings-buffer">Savings buffer ($)</Label>
        <Input
          id="settings-buffer"
          type="number"
          value={currentBuffer}
          onChange={(e) => { setSavingsBuffer(e.target.value); if (errors.savingsBuffer) setErrors((p) => { const n = { ...p }; delete n.savingsBuffer; return n }) }}
          className={errors.savingsBuffer ? 'border-red-500 focus-visible:ring-red-500' : ''}
        />
        <p className="text-xs text-muted-foreground">Month-end balance needed for a "Comfortable" (YES) verdict</p>
        {errors.savingsBuffer && <p className="text-xs text-red-500">{errors.savingsBuffer}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="settings-target">Monthly savings target ($)</Label>
        <Input
          id="settings-target"
          type="number"
          value={currentTarget}
          onChange={(e) => { setMonthlySavingsTarget(e.target.value); if (errors.monthlySavingsTarget) setErrors((p) => { const n = { ...p }; delete n.monthlySavingsTarget; return n }) }}
          className={errors.monthlySavingsTarget ? 'border-red-500 focus-visible:ring-red-500' : ''}
        />
        <p className="text-xs text-muted-foreground">Reserved from income before anything else each month</p>
        {errors.monthlySavingsTarget && <p className="text-xs text-red-500">{errors.monthlySavingsTarget}</p>}
      </div>
      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Chrome Extension</p>
        <p>Load the Fino Chrome extension from the <code>fino_extension/</code> folder and make sure you're logged into ARI in the same browser to enable live affordability checks while you shop.</p>
      </div>
      <Button onClick={handleSave} disabled={upsertProfile.isPending}>
        {upsertProfile.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
        Save settings
      </Button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FinoPage() {
  const { data: settings, isLoading: settingsLoading } = useFinoSettings()
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)

  // Sync local state with persisted settings once loaded
  if (!settingsLoading && onboardingDone === null) {
    setOnboardingDone(settings?.onboardingCompleted ?? false)
  }

  if (settingsLoading || onboardingDone === null) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!onboardingDone) {
    return <OnboardingScreen onComplete={() => setOnboardingDone(true)} />
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="size-6" /> Fino
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Affordability tracker — know before you buy</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
        <TabsContent value="transactions" className="mt-4"><TransactionsTab /></TabsContent>
        <TabsContent value="goals" className="mt-4"><GoalsTab /></TabsContent>
        <TabsContent value="income" className="mt-4"><IncomeTab /></TabsContent>
        <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  )
}
