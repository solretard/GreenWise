// Debt payoff projections and repayment strategy comparison.
import type { Debt } from '../lib/types'
import { addMonths, perMonth } from './dates'

export type DebtState = { debt: Debt; remaining: number }

export type Payoff = {
  months: number | null        // null = never, at this payment
  date: string | null
  totalInterest: number
  monthlyPayment: number
  neverReason?: string
}

const MAX_MONTHS = 600

/** Monthly-equivalent repayment for one debt. One-off debts are paid in a single go. */
export function monthlyPayment(d: Debt, remaining: number): number {
  if (d.repayment_frequency === 'one_off') return remaining
  return d.minimum_payment * perMonth(d.repayment_frequency)
}

/** How long one debt takes to clear at its current repayment, with monthly interest. */
export function projectPayoff(d: Debt, remaining: number, today: string): Payoff {
  const pay = monthlyPayment(d, remaining)
  if (remaining <= 0) return { months: 0, date: today, totalInterest: 0, monthlyPayment: 0 }
  if (pay <= 0) return { months: null, date: null, totalInterest: 0, monthlyPayment: 0, neverReason: 'No repayment amount is set.' }
  const rate = d.interest_rate / 100 / 12
  if (rate > 0 && pay <= remaining * rate) {
    return { months: null, date: null, totalInterest: 0, monthlyPayment: pay, neverReason: 'The repayment doesn’t cover the interest, so the balance never goes down.' }
  }
  let bal = remaining, interest = 0, m = 0
  while (bal > 0.5 && m < MAX_MONTHS) {
    const i = bal * rate
    interest += i
    bal = bal + i - pay
    m++
  }
  return { months: m, date: addMonths(today, m), totalInterest: Math.round(interest), monthlyPayment: Math.round(pay) }
}

export type Strategy = 'smallest' | 'interest' | 'custom'

export type StrategyResult = {
  strategy: Strategy
  months: number | null
  date: string | null
  totalInterest: number
  order: { creditor: string; month: number }[] // when each debt is cleared
  firstClearedMonth: number | null
}

/**
 * Pays every minimum each month; any extra (plus the minimums of debts already
 * cleared) goes to the target debt chosen by the strategy.
 */
export function simulateStrategy(states: DebtState[], strategy: Strategy, extraPerMonth: number, today: string): StrategyResult {
  const debts = states
    .filter(s => s.remaining > 0)
    .map(s => ({
      id: s.debt.id, creditor: s.debt.creditor, bal: s.remaining,
      rate: s.debt.interest_rate / 100 / 12, min: monthlyPayment(s.debt, s.remaining),
      custom: s.debt.custom_priority ?? 999, done: false,
    }))
  const budget = debts.reduce((a, d) => a + d.min, 0) + Math.max(extraPerMonth, 0)
  const rank = (a: typeof debts[number], b: typeof debts[number]) =>
    strategy === 'smallest' ? a.bal - b.bal || b.rate - a.rate
      : strategy === 'interest' ? b.rate - a.rate || a.bal - b.bal
        : a.custom - b.custom || a.bal - b.bal

  const order: StrategyResult['order'] = []
  let interest = 0, m = 0
  while (debts.some(d => d.bal > 0.5) && m < MAX_MONTHS) {
    m++
    for (const d of debts) if (d.bal > 0.5) { const i = d.bal * d.rate; interest += i; d.bal += i }
    let pot = budget
    // minimums first
    for (const d of debts) if (d.bal > 0.5) { const p = Math.min(d.min, d.bal, pot); d.bal -= p; pot -= p }
    // then everything left goes to targets in strategy order
    for (const d of [...debts].filter(x => x.bal > 0.5).sort(rank)) { if (pot <= 0) break; const p = Math.min(pot, d.bal); d.bal -= p; pot -= p }
    for (const d of debts) if (d.bal <= 0.5 && !d.done) { d.done = true; order.push({ creditor: d.creditor, month: m }) }
    if (budget <= 0) break
  }
  const finished = !debts.some(d => d.bal > 0.5)
  return {
    strategy,
    months: finished ? m : null,
    date: finished ? addMonths(today, m) : null,
    totalInterest: Math.round(interest),
    order,
    firstClearedMonth: order[0]?.month ?? null,
  }
}

export type BurdenLevel = 'none' | 'manageable' | 'heavy' | 'very_heavy'

export function repaymentBurden(totalMonthly: number, minimumMonthlyIncome: number): { pct: number | null; level: BurdenLevel } {
  if (totalMonthly <= 0) return { pct: 0, level: 'none' }
  if (minimumMonthlyIncome <= 0) return { pct: null, level: 'heavy' }
  const pct = totalMonthly / minimumMonthlyIncome
  return { pct, level: pct < 0.15 ? 'manageable' : pct < 0.35 ? 'heavy' : 'very_heavy' }
}

/** Plain-language comparison of the strategies. */
export function explainStrategies(r: Record<Strategy, StrategyResult>, money: (n: number) => string, anyInterest: boolean): string[] {
  const out: string[] = []
  const s = r.smallest, i = r.interest
  if (!anyInterest) {
    out.push('None of your debts charge interest, so the order doesn’t change the total you pay.')
    if (s.firstClearedMonth != null) out.push(`Smallest balance first clears your first debt in month ${s.firstClearedMonth}. That quick win is the main reason to pick it.`)
    return out
  }
  const saved = s.totalInterest - i.totalInterest
  if (saved > 0) out.push(`Highest interest first costs ${money(saved)} less in interest overall${i.months != null && s.months != null && i.months < s.months ? ` and finishes ${s.months - i.months} month${s.months - i.months === 1 ? '' : 's'} sooner` : ''}.`)
  else out.push('Both orders cost about the same in interest for your debts.')
  if (s.firstClearedMonth != null && i.firstClearedMonth != null && s.firstClearedMonth < i.firstClearedMonth) {
    out.push(`Smallest balance first clears a debt in month ${s.firstClearedMonth} instead of month ${i.firstClearedMonth}. If staying motivated is the hard part, that early win can be worth the extra cost.`)
  }
  out.push('Custom order lets you put first a debt that matters for other reasons, such as one owed to family or one with penalties for late payment.')
  return out
}
