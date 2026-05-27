'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  FinoTransaction,
  FinoIncomeEvent,
  FinoGoal,
  FinoUserProfile,
  AffordabilityResponse,
  FinoSettings,
  StatementSource,
  CreateGoalRequest,
  UpdateGoalRequest,
  UpsertIncomeRequest,
  UpsertProfileRequest,
} from '../types'

// ─── Query keys ──────────────────────────────────────────────────────────────

const TRANSACTIONS_KEY = (month?: string) => ['fino-transactions', month ?? 'all']
const STATEMENT_SOURCES_KEY = ['fino-statement-sources']
const GOALS_KEY = ['fino-goals']
const INCOME_KEY = ['fino-income']
const PROFILE_KEY = ['fino-profile']
const SETTINGS_KEY = ['fino-settings']
const AFFORDABILITY_KEY = (cartTotal: number) => ['fino-affordability', cartTotal]

// ─── Transactions ─────────────────────────────────────────────────────────────

export function useFinoTransactions(month?: string) {
  return useQuery({
    queryKey: TRANSACTIONS_KEY(month),
    queryFn: async (): Promise<FinoTransaction[]> => {
      const url = month
        ? `/api/modules/fino/statements?month=${encodeURIComponent(month)}`
        : '/api/modules/fino/statements'
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to fetch transactions')
      }
      const data = await res.json()
      return data.transactions || []
    },
  })
}

export function useUploadFinoStatement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/modules/fino/statements', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Upload failed')
      }
      return res.json()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['fino-transactions'] })
      queryClient.invalidateQueries({ queryKey: STATEMENT_SOURCES_KEY })
      queryClient.invalidateQueries({ queryKey: ['fino-affordability'] })
    },
  })
}

export function useDeleteFinoTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`/api/modules/fino/statements/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to delete transaction')
      }
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: ['fino-transactions'] })
      const snapshots: Map<string, FinoTransaction[]> = new Map()
      queryClient.getQueriesData<FinoTransaction[]>({ queryKey: ['fino-transactions'] }).forEach(([key, data]) => {
        if (data) {
          snapshots.set(JSON.stringify(key), data)
          queryClient.setQueryData(key, data.filter((t) => t.id !== deletedId))
        }
      })
      return { snapshots }
    },
    onError: (_err, _id, context) => {
      context?.snapshots.forEach((data, key) => {
        queryClient.setQueryData(JSON.parse(key), data)
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['fino-transactions'] })
      queryClient.invalidateQueries({ queryKey: STATEMENT_SOURCES_KEY })
      queryClient.invalidateQueries({ queryKey: ['fino-affordability'] })
    },
  })
}

export function useFinoStatementSources() {
  return useQuery({
    queryKey: STATEMENT_SOURCES_KEY,
    queryFn: async (): Promise<StatementSource[]> => {
      const res = await fetch('/api/modules/fino/statements/sources')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to fetch statement sources')
      }
      const data = await res.json()
      return data.sources || []
    },
  })
}

export function useDeleteFinoStatementSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (statementSource: string): Promise<{ deleted: number }> => {
      const res = await fetch('/api/modules/fino/statements/sources', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement_source: statementSource }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to delete statement')
      }
      return res.json()
    },
    onMutate: async (statementSource) => {
      await queryClient.cancelQueries({ queryKey: STATEMENT_SOURCES_KEY })
      const prev = queryClient.getQueryData<StatementSource[]>(STATEMENT_SOURCES_KEY)
      queryClient.setQueryData<StatementSource[]>(STATEMENT_SOURCES_KEY, (old) =>
        (old ?? []).filter((s) => s.statement_source !== statementSource)
      )
      return { prev }
    },
    onError: (_err, _src, context) => {
      if (context?.prev) queryClient.setQueryData(STATEMENT_SOURCES_KEY, context.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: STATEMENT_SOURCES_KEY })
      queryClient.invalidateQueries({ queryKey: ['fino-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['fino-affordability'] })
    },
  })
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export function useFinoGoals() {
  return useQuery({
    queryKey: GOALS_KEY,
    queryFn: async (): Promise<FinoGoal[]> => {
      const res = await fetch('/api/modules/fino/goals')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to fetch goals')
      }
      const data = await res.json()
      return data.goals || []
    },
  })
}

export function useCreateFinoGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateGoalRequest): Promise<FinoGoal> => {
      const res = await fetch('/api/modules/fino/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const details = (err.details as Array<{message: string}>)?.map((d) => d.message).join(', ')
        throw new Error(details || err.error || 'Failed to create goal')
      }
      const data = await res.json()
      return data.goal
    },
    onMutate: async (newGoal) => {
      await queryClient.cancelQueries({ queryKey: GOALS_KEY })
      const previous = queryClient.getQueryData<FinoGoal[]>(GOALS_KEY)
      queryClient.setQueryData<FinoGoal[]>(GOALS_KEY, (old = []) => [
        ...old,
        {
          id: 'temp-' + Date.now(),
          user_id: '',
          name: newGoal.name,
          target_amount: newGoal.target_amount,
          target_date: newGoal.target_date ?? null,
          monthly_contribution: newGoal.monthly_contribution,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      return { previous }
    },
    onError: (_err, _goal, context) => {
      if (context?.previous) queryClient.setQueryData(GOALS_KEY, context.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: GOALS_KEY })
      queryClient.invalidateQueries({ queryKey: ['fino-affordability'] })
    },
  })
}

export function useUpdateFinoGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateGoalRequest & { id: string }): Promise<FinoGoal> => {
      const res = await fetch(`/api/modules/fino/goals/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const details = (err.details as Array<{message: string}>)?.map((d) => d.message).join(', ')
        throw new Error(details || err.error || 'Failed to update goal')
      }
      return (await res.json()).goal
    },
    onMutate: async ({ id, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: GOALS_KEY })
      const previous = queryClient.getQueryData<FinoGoal[]>(GOALS_KEY)
      queryClient.setQueryData<FinoGoal[]>(GOALS_KEY, (old = []) =>
        old.map((g) => g.id === id ? { ...g, ...updates } : g)
      )
      return { previous }
    },
    onError: (_err, _data, context) => {
      if (context?.previous) queryClient.setQueryData(GOALS_KEY, context.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: GOALS_KEY })
      queryClient.invalidateQueries({ queryKey: ['fino-affordability'] })
    },
  })
}

export function useDeleteFinoGoal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`/api/modules/fino/goals/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to delete goal')
      }
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: GOALS_KEY })
      const previous = queryClient.getQueryData<FinoGoal[]>(GOALS_KEY)
      queryClient.setQueryData<FinoGoal[]>(GOALS_KEY, (old = []) => old.filter((g) => g.id !== deletedId))
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(GOALS_KEY, context.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: GOALS_KEY })
      queryClient.invalidateQueries({ queryKey: ['fino-affordability'] })
    },
  })
}

// ─── Income ───────────────────────────────────────────────────────────────────

export function useFinoIncome() {
  return useQuery({
    queryKey: INCOME_KEY,
    queryFn: async (): Promise<FinoIncomeEvent | null> => {
      const res = await fetch('/api/modules/fino/income')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to fetch income')
      }
      return res.json()
    },
  })
}

export function useUpsertFinoIncome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpsertIncomeRequest): Promise<FinoIncomeEvent> => {
      const res = await fetch('/api/modules/fino/income', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const details = (err.details as Array<{message: string}>)?.map((d) => d.message).join(', ')
        throw new Error(details || err.error || 'Failed to save income')
      }
      return res.json()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: INCOME_KEY })
      queryClient.invalidateQueries({ queryKey: ['fino-affordability'] })
    },
  })
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export function useFinoProfile() {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: async (): Promise<FinoUserProfile | null> => {
      const res = await fetch('/api/modules/fino/profile')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to fetch profile')
      }
      return res.json()
    },
  })
}

export function useUpsertFinoProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpsertProfileRequest): Promise<FinoUserProfile> => {
      const res = await fetch('/api/modules/fino/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const details = (err.details as Array<{message: string}>)?.map((d) => d.message).join(', ')
        throw new Error(details || err.error || 'Failed to save profile')
      }
      return res.json()
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: PROFILE_KEY })
      const previous = queryClient.getQueryData<FinoUserProfile | null>(PROFILE_KEY)
      if (previous) {
        queryClient.setQueryData<FinoUserProfile>(PROFILE_KEY, { ...previous, ...updates } as FinoUserProfile)
      }
      return { previous }
    },
    onError: (_err, _data, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(PROFILE_KEY, context.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PROFILE_KEY })
      queryClient.invalidateQueries({ queryKey: ['fino-affordability'] })
    },
  })
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function useFinoSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async (): Promise<Partial<FinoSettings>> => {
      const res = await fetch('/api/modules/fino/settings')
      if (!res.ok) return {}
      return res.json()
    },
  })
}

export function useUpdateFinoSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (settings: Partial<FinoSettings>): Promise<void> => {
      const res = await fetch('/api/modules/fino/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save settings')
      }
    },
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY })
      const previous = queryClient.getQueryData<Partial<FinoSettings>>(SETTINGS_KEY)
      queryClient.setQueryData<Partial<FinoSettings>>(SETTINGS_KEY, (old = {}) => ({ ...old, ...newSettings }))
      return { previous }
    },
    onError: (_err, _data, context) => {
      if (context?.previous) queryClient.setQueryData(SETTINGS_KEY, context.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
    },
  })
}

// ─── Affordability ────────────────────────────────────────────────────────────

export function useFinoAffordability(cartTotal: number) {
  return useQuery({
    queryKey: AFFORDABILITY_KEY(cartTotal),
    queryFn: async (): Promise<AffordabilityResponse> => {
      const res = await fetch('/api/modules/fino/affordability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_total: cartTotal }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to check affordability')
      }
      return res.json()
    },
    enabled: cartTotal > 0,
  })
}
