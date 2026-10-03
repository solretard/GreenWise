// Shapes of the rows GreenWise reads from the database.
// The financial engine works on these, never on how they were entered,
// so bank-imported rows (source = 'bank') will slot in unchanged later.

export type TxType = 'income' | 'expense' | 'savings' | 'transfer' | 'debt_repayment'

export type Transaction = {
  id: string
  type: TxType
  amount: number
  category_id: string | null
  description: string | null
  occurred_on: string // YYYY-MM-DD
  necessity: 'need' | 'want' | null
  is_planned: boolean | null
  payment_method: string | null
  source: 'manual' | 'bank'
  goal_id: string | null
  debt_id: string | null
  obligation_id: string | null
  income_source_id: string | null
  created_at: string
}

export type Category = { id: string; name: string; kind: 'expense' | 'income'; is_essential: boolean; archived: boolean }

export type Goal = {
  id: string; name: string; target_amount: number; starting_amount: number
  deadline: string | null; priority: number; status: 'active' | 'achieved' | 'paused' | 'cancelled'
  created_at?: string
}

export type Debt = {
  id: string; creditor: string; original_amount: number; opening_balance: number; interest_rate: number
  minimum_payment: number; repayment_frequency: 'weekly' | 'biweekly' | 'monthly' | 'one_off'
  next_due_date: string | null; start_date: string | null; custom_priority: number | null; status: 'active' | 'paid_off'
}

export type Obligation = {
  id: string; name: string; amount: number; category_id: string | null
  frequency: 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
  next_due_date: string; is_essential: boolean; active: boolean
}

export type IncomeSource = {
  id: string; name: string; income_type: string; frequency: 'weekly' | 'biweekly' | 'monthly' | 'irregular'
  expected_amount: number; minimum_amount: number; optimistic_amount: number | null
  next_pay_date: string | null; active: boolean
}

export type TxInput = Omit<Transaction, 'id' | 'created_at' | 'source'>

export const TX_TYPES: { value: TxType; label: string; hint: string }[] = [
  { value: 'expense', label: 'Expense', hint: 'Money you spent' },
  { value: 'income', label: 'Income', hint: 'Money that came in' },
  { value: 'savings', label: 'Savings', hint: 'Money put aside for a goal' },
  { value: 'debt_repayment', label: 'Repayment', hint: 'Paying back a debt' },
  { value: 'transfer', label: 'Transfer', hint: 'Moving money between your own accounts. Doesn’t change your total.' },
]

export const PAYMENT_METHODS = ['Cash', 'Bank transfer', 'Card', 'POS', 'USSD', 'Mobile wallet', 'Other']

export type Commitment = {
  id: string
  kind: 'spend_limit' | 'save_target' | 'no_unplanned'
  title: string
  category_id: string | null   // spend_limit: one category; null = all "want" spending
  goal_id: string | null       // save_target: optional goal
  amount: number | null
  start_date: string
  end_date: string
  status: 'active' | 'kept' | 'broken' | 'cancelled'
  created_at: string
}

export type PurchaseDecision = {
  id: string
  item: string
  price: number
  reason: string | null
  necessity: 'need' | 'want'
  needed_by: string | null
  category_id: string | null
  result: Record<string, unknown>
  outcome: 'pending' | 'bought' | 'postponed' | 'skipped'
  created_at: string
}

export type Priority = {
  id: string
  name: string
  amount: number
  due_date: string | null
  necessity: 'need' | 'want'
  urgency: number            // 1 (can wait) – 5 (urgent)
  delay_consequence: number  // 1 (nothing happens) – 5 (severe)
  manual_rank: number | null // set when the user reorders
  status: 'open' | 'done' | 'dropped'
  created_at: string
}
