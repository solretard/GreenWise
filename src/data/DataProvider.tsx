import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  dismissAlert as saveDismissal, fetchBudgets, fetchCategories, fetchDebts, fetchDismissals, fetchGoals,
  fetchCommitments, fetchDecisions, fetchPriorities, fetchIncomeSources, fetchObligations, fetchTransactions,
} from '../lib/data'
import type { Category, Commitment, Debt, Goal, IncomeSource, Obligation, Priority, PurchaseDecision, Transaction } from '../lib/types'
import { computeSnapshot, type Budget, type Snapshot } from '../engine/engine'
import { localToday } from '../lib/format'
import { useAuth } from '../auth/AuthProvider'

type DataState = {
  transactions: Transaction[]
  categories: Category[]
  goals: Goal[]
  debts: Debt[]
  obligations: Obligation[]
  incomeSources: IncomeSource[]
  budgets: Budget[]
  commitments: Commitment[]
  decisions: PurchaseDecision[]
  priorities: Priority[]
  asOf: string           // the setup date: balances count from here
  currency: string
  snapshot: Snapshot | null
  dismissed: Set<string>
  loading: boolean
  error: string
  reload: () => Promise<void>
  setCategories: (c: Category[]) => void
  dismiss: (alertKey: string) => Promise<void>
}

const DataContext = createContext<DataState | null>(null)

/** Loads the signed-in user's own financial data. Row security means only their rows ever arrive. */
export function DataProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [decisions, setDecisions] = useState<PurchaseDecision[]>([])
  const [priorities, setPriorities] = useState<Priority[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [today, setToday] = useState(localToday())
  const uid = session?.user.id

  const reload = useCallback(async () => {
    if (!uid) return
    try {
      const [t, c, g, d, o, i, b, x, k, p, q] = await Promise.all([
        fetchTransactions(), fetchCategories(), fetchGoals(), fetchDebts(), fetchObligations(),
        fetchIncomeSources(), fetchBudgets(), fetchDismissals(), fetchCommitments(), fetchDecisions(), fetchPriorities(),
      ])
      setTransactions(t); setCategories(c); setGoals(g); setDebts(d); setObligations(o)
      setIncomeSources(i); setBudgets(b); setDismissed(new Set(x)); setCommitments(k); setDecisions(p); setPriorities(q)
      setToday(localToday())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your data')
    } finally {
      setLoading(false)
    }
  }, [uid])

  useEffect(() => {
    // a different person signed in: drop everything from the previous one first
    setTransactions([]); setCategories([]); setGoals([]); setDebts([]); setObligations([])
    setIncomeSources([]); setBudgets([]); setDismissed(new Set()); setCommitments([]); setDecisions([]); setPriorities([])
    setLoading(true)
    reload()
  }, [reload])

  // the app may stay open past midnight: refresh "today" when the tab comes back into view
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setToday(localToday()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const snapshot = useMemo(() => {
    if (!profile || loading) return null
    return computeSnapshot({
      today, currency: profile.currency,
      profile: {
        starting_balance: profile.starting_balance, emergency_buffer: profile.emergency_buffer,
        balance_as_of: profile.balance_as_of, focus_areas: profile.focus_areas ?? [],
        alert_settings: profile.alert_settings ?? { budget_warn_pct: 80, unplanned_per_week: 5, large_purchase_pct: 20 },
      },
      transactions, incomeSources, obligations, debts, goals, budgets, categories, commitments, dismissed,
    })
  }, [profile, loading, today, transactions, incomeSources, obligations, debts, goals, budgets, categories, commitments, dismissed])

  const dismiss = useCallback(async (key: string) => {
    setDismissed(s => new Set([...s, key])) // hide straight away
    try { await saveDismissal(key) } catch { /* it will simply show again next time */ }
  }, [])

  const value: DataState = {
    transactions, categories, goals, debts, obligations, incomeSources, budgets, commitments, decisions, priorities,
    asOf: profile?.balance_as_of ?? '1970-01-01',
    currency: profile?.currency ?? 'NGN',
    snapshot, dismissed, loading, error, reload, setCategories, dismiss,
  }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be inside DataProvider')
  return ctx
}
