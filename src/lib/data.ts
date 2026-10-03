import { supabase } from './supabase'
import type { Category, Commitment, Debt, Goal, IncomeSource, Obligation, Priority, PurchaseDecision, Transaction, TxInput } from './types'
import type { Budget } from '../engine/engine'

const PAGE = 1000 // Supabase returns at most 1000 rows per request

// Numbers come back from Postgres numeric columns as strings in some cases; normalise them.
const num = (v: unknown) => (v == null ? v : Number(v))

function normTx(r: Record<string, unknown>): Transaction {
  return { ...(r as Transaction), amount: num(r.amount) as number }
}

export async function fetchTransactions(): Promise<Transaction[]> {
  const all: Transaction[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data ?? []).map(normTx))
    if (!data || data.length < PAGE) return all
  }
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('id, name, kind, is_essential, archived').order('name')
  if (error) throw error
  return data as Category[]
}

export async function fetchGoals(): Promise<Goal[]> {
  const { data, error } = await supabase.from('goals').select('*').order('priority').order('created_at')
  if (error) throw error
  return (data ?? []).map(g => ({ ...g, target_amount: Number(g.target_amount), starting_amount: Number(g.starting_amount) })) as Goal[]
}

export async function fetchDebts(): Promise<Debt[]> {
  const { data, error } = await supabase.from('debts').select('*').order('created_at')
  if (error) throw error
  return (data ?? []).map(d => ({
    ...d, original_amount: Number(d.original_amount), opening_balance: Number(d.opening_balance),
    interest_rate: Number(d.interest_rate), minimum_payment: Number(d.minimum_payment),
  })) as Debt[]
}

export async function fetchObligations(): Promise<Obligation[]> {
  const { data, error } = await supabase.from('obligations').select('*').order('next_due_date')
  if (error) throw error
  return (data ?? []).map(o => ({ ...o, amount: Number(o.amount) })) as Obligation[]
}

export async function fetchIncomeSources(): Promise<IncomeSource[]> {
  const { data, error } = await supabase.from('income_sources').select('*').order('created_at')
  if (error) throw error
  return (data ?? []).map(i => ({
    ...i, expected_amount: Number(i.expected_amount), minimum_amount: Number(i.minimum_amount),
    optimistic_amount: i.optimistic_amount == null ? null : Number(i.optimistic_amount),
  })) as IncomeSource[]
}

export async function insertTransaction(input: TxInput) {
  // source is always 'manual' from the app; only a future bank sync writes 'bank'
  const { error } = await supabase.from('transactions').insert({ ...input, source: 'manual' })
  if (error) throw error
}

export async function updateTransaction(id: string, input: Partial<TxInput>) {
  const { error } = await supabase.from('transactions').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteTransaction(id: string) {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}

export async function insertCategory(name: string, kind: 'expense' | 'income', is_essential: boolean): Promise<Category> {
  const { data, error } = await supabase.from('categories')
    .insert({ name, kind, is_essential })
    .select('id, name, kind, is_essential, archived').single()
  if (error) throw error
  return data as Category
}

export async function fetchBudgets(): Promise<Budget[]> {
  const { data, error } = await supabase.from('budgets').select('id, category_id, monthly_limit')
  if (error) throw error
  return (data ?? []).map(b => ({ ...b, monthly_limit: Number(b.monthly_limit) })) as Budget[]
}

export async function fetchDismissals(): Promise<string[]> {
  const { data, error } = await supabase.from('alert_dismissals').select('alert_key')
  if (error) throw error
  return (data ?? []).map(d => d.alert_key as string)
}

export async function dismissAlert(key: string) {
  const { error } = await supabase.from('alert_dismissals').upsert({ alert_key: key.slice(0, 200) }, { onConflict: 'user_id,alert_key', ignoreDuplicates: true })
  if (error) throw error
}

// ---------- plan: budgets, goals, regular payments ----------
export async function saveBudget(categoryId: string, monthlyLimit: number) {
  const { error } = await supabase.from('budgets')
    .upsert({ category_id: categoryId, monthly_limit: monthlyLimit }, { onConflict: 'user_id,category_id' })
  if (error) throw error
}

export async function deleteBudget(id: string) {
  const { error } = await supabase.from('budgets').delete().eq('id', id)
  if (error) throw error
}

export type GoalInput = Pick<Goal, 'name' | 'target_amount' | 'starting_amount' | 'deadline' | 'priority' | 'status'>

export async function insertGoal(g: GoalInput) {
  const { error } = await supabase.from('goals').insert(g)
  if (error) throw error
}

export async function updateGoal(id: string, g: Partial<GoalInput>) {
  const { error } = await supabase.from('goals').update(g).eq('id', id)
  if (error) throw error
}

export async function deleteGoal(id: string) {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw error
}

export type ObligationInput = Pick<Obligation, 'name' | 'amount' | 'category_id' | 'frequency' | 'next_due_date' | 'is_essential' | 'active'>

export async function insertObligation(o: ObligationInput) {
  const { error } = await supabase.from('obligations').insert(o)
  if (error) throw error
}

export async function updateObligation(id: string, o: Partial<ObligationInput>) {
  const { error } = await supabase.from('obligations').update(o).eq('id', id)
  if (error) throw error
}

export async function deleteObligation(id: string) {
  const { error } = await supabase.from('obligations').delete().eq('id', id)
  if (error) throw error
}

// ---------- decisions & commitments ----------
export async function fetchCommitments(): Promise<Commitment[]> {
  const { data, error } = await supabase.from('commitments').select('*').order('end_date')
  if (error) throw error
  return (data ?? []).map(c => ({ ...c, amount: c.amount == null ? null : Number(c.amount) })) as Commitment[]
}

export type CommitmentInput = Pick<Commitment, 'kind' | 'title' | 'category_id' | 'goal_id' | 'amount' | 'start_date' | 'end_date'>

export async function insertCommitment(c: CommitmentInput) {
  const { error } = await supabase.from('commitments').insert(c)
  if (error) throw error
}

export async function updateCommitmentStatus(id: string, status: Commitment['status']) {
  const { error } = await supabase.from('commitments').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteCommitment(id: string) {
  const { error } = await supabase.from('commitments').delete().eq('id', id)
  if (error) throw error
}

export async function fetchDecisions(): Promise<PurchaseDecision[]> {
  const { data, error } = await supabase.from('purchase_decisions').select('*').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return (data ?? []).map(d => ({ ...d, price: Number(d.price) })) as PurchaseDecision[]
}

export type DecisionInsert = Pick<PurchaseDecision, 'item' | 'price' | 'reason' | 'necessity' | 'needed_by' | 'category_id' | 'result' | 'outcome'>

export async function insertDecision(d: DecisionInsert) {
  const { error } = await supabase.from('purchase_decisions').insert(d)
  if (error) throw error
}

export async function updateDecisionOutcome(id: string, outcome: PurchaseDecision['outcome']) {
  const { error } = await supabase.from('purchase_decisions').update({ outcome }).eq('id', id)
  if (error) throw error
}

export async function deleteDecision(id: string) {
  const { error } = await supabase.from('purchase_decisions').delete().eq('id', id)
  if (error) throw error
}

// ---------- debts ----------
export type DebtInput = Pick<Debt, 'creditor' | 'original_amount' | 'opening_balance' | 'interest_rate' | 'minimum_payment' | 'repayment_frequency' | 'next_due_date' | 'start_date' | 'status'>

export async function insertDebt(d: DebtInput) {
  const { error } = await supabase.from('debts').insert(d)
  if (error) throw error
}

export async function updateDebt(id: string, d: Partial<DebtInput> & { custom_priority?: number | null }) {
  const { error } = await supabase.from('debts').update(d).eq('id', id)
  if (error) throw error
}

export async function deleteDebt(id: string) {
  const { error } = await supabase.from('debts').delete().eq('id', id)
  if (error) throw error
}

// ---------- priorities (scale of preference) ----------
export async function fetchPriorities(): Promise<Priority[]> {
  const { data, error } = await supabase.from('priorities').select('*').order('created_at')
  if (error) throw error
  return (data ?? []).map(p => ({ ...p, amount: Number(p.amount) })) as Priority[]
}

export type PriorityInput = Pick<Priority, 'name' | 'amount' | 'due_date' | 'necessity' | 'urgency' | 'delay_consequence'>

export async function insertPriority(p: PriorityInput) {
  const { error } = await supabase.from('priorities').insert(p)
  if (error) throw error
}

export async function updatePriority(id: string, p: Partial<PriorityInput> & { manual_rank?: number | null; status?: Priority['status'] }) {
  const { error } = await supabase.from('priorities').update(p).eq('id', id)
  if (error) throw error
}

export async function deletePriority(id: string) {
  const { error } = await supabase.from('priorities').delete().eq('id', id)
  if (error) throw error
}

// ---------- income sources & money on hand ----------
export type IncomeInput = Pick<IncomeSource, 'name' | 'income_type' | 'frequency' | 'expected_amount' | 'minimum_amount' | 'optimistic_amount' | 'next_pay_date' | 'active'>

export async function insertIncomeSource(i: IncomeInput) {
  const { error } = await supabase.from('income_sources').insert(i)
  if (error) throw error
}

export async function updateIncomeSource(id: string, i: Partial<IncomeInput>) {
  const { error } = await supabase.from('income_sources').update(i).eq('id', id)
  if (error) throw error
}

export async function deleteIncomeSource(id: string) {
  const { error } = await supabase.from('income_sources').delete().eq('id', id)
  if (error) throw error
}

export async function updateMoneySettings(userId: string, patch: { emergency_buffer?: number; starting_balance?: number }) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
  if (error) throw error
}
