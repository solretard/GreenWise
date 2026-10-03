import type { Debt, Goal, Transaction } from './types'

/**
 * Starting balance, goal "saved so far" and debt balances were all entered
 * as of the setup date (profile.balance_as_of). Anything dated before that
 * is already inside those numbers, so only later transactions move them.
 */
export const countsTowardBalances = (t: Transaction, asOf: string) => t.occurred_on >= asOf

export function goalSaved(goal: Goal, txs: Transaction[], asOf: string): number {
  return goal.starting_amount + txs
    .filter(t => t.type === 'savings' && t.goal_id === goal.id && countsTowardBalances(t, asOf))
    .reduce((s, t) => s + t.amount, 0)
}

export function debtRemaining(debt: Debt, txs: Transaction[], asOf: string): number {
  const paid = txs
    .filter(t => t.type === 'debt_repayment' && t.debt_id === debt.id && countsTowardBalances(t, asOf))
    .reduce((s, t) => s + t.amount, 0)
  return Math.max(debt.opening_balance - paid, 0)
}

/** How a transaction changes the money you have on hand. Transfers move money between your own accounts. */
export function cashEffect(t: Transaction): number {
  switch (t.type) {
    case 'income': return t.amount
    case 'transfer': return 0
    default: return -t.amount // expense, savings, debt_repayment
  }
}
