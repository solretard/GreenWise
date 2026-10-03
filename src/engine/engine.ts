// GreenWise financial engine.
// Pure functions: data in, numbers and plain-language explanations out.
// It never knows whether a transaction was typed in or came from a bank.

import type { Category, Commitment, Debt, Goal, IncomeSource, Obligation, Transaction } from '../lib/types'
import { trackCommitments, type CommitmentStatus } from './commitments'
import { formatMoney } from '../lib/format'
import { addDays, daysBetween, monthEnd, monthStart, occurrence, perMonth, weekStart, type Freq } from './dates'

// ---------- inputs ----------
export type Budget = { id: string; category_id: string; monthly_limit: number }

export type EngineProfile = {
  starting_balance: number
  emergency_buffer: number
  balance_as_of: string
  focus_areas: string[]
  alert_settings: { budget_warn_pct: number; unplanned_per_week: number; large_purchase_pct: number }
}

export type EngineInput = {
  today: string
  currency: string
  profile: EngineProfile
  transactions: Transaction[]
  incomeSources: IncomeSource[]
  obligations: Obligation[]
  debts: Debt[]
  goals: (Goal & { created_at?: string })[]
  budgets: Budget[]
  categories: Category[]
  commitments?: Commitment[]
  dismissed?: Set<string>
}

// ---------- outputs ----------
export type DuePayment = {
  key: string
  kind: 'obligation' | 'debt'
  refId: string
  name: string
  due: string
  amount: number     // still unpaid for this occurrence
  essential: boolean
  overdue: boolean
}

export type BreakdownLine = { label: string; amount: number; detail?: string }

export type Alert = {
  key: string
  severity: 'high' | 'medium' | 'low'
  title: string
  body: string
  focus?: string
  link?: string
}

export type GoalStatus = {
  goal: Goal
  saved: number
  pct: number
  remaining: number
  suggestedMonthly: number | null // to hit the deadline
  onTrack: boolean | null
}

export type DebtStatus = { debt: Debt; remaining: number; paid: number; pct: number }

export type BudgetStatus = {
  budget: Budget
  category: string
  spent: number
  pct: number
  remaining: number
  projected: number
}

export type Snapshot = {
  today: string
  available: number
  safeToSpend: number
  shortfall: number
  perDay: number
  windowEnd: string        // exclusive: next payday, or 30 days out
  windowDays: number
  hasPayday: boolean
  breakdown: BreakdownLine[]
  reserved: { overdue: number; obligations: number; debts: number; savings: number; buffer: number }
  dueInWindow: DuePayment[]
  upcoming: DuePayment[]   // next 30 days, for the Home list
  income: { expectedMonthly: number; minimumMonthly: number; optimisticMonthly: number; irregular: boolean }
  month: {
    start: string; end: string; daysLeft: number; dayFraction: number
    income: number; spent: number; saved: number; repaid: number
    needs: number; wants: number; unplannedCount: number; unplannedAmount: number
  }
  week: { unplannedCount: number; unplannedAmount: number }
  goals: GoalStatus[]
  debts: { totalRemaining: number; totalOpening: number; items: DebtStatus[] }
  budgets: BudgetStatus[]
  commitments: CommitmentStatus[]
  alerts: Alert[]
  nextStep: string
}

const round = (n: number) => Math.round(n)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** Splits money already paid across a schedule, oldest occurrence first, and returns what is still owed. */
function unpaidSchedule(opts: {
  anchor: string; freq: Freq; amount: number; paid: number; until: string; maxTotal?: number; oldestOverdue: string
}): { due: string; amount: number }[] {
  const out: { due: string; amount: number }[] = []
  let paidLeft = opts.paid
  let scheduled = 0
  for (let k = 0; k < 500; k++) {
    const due = occurrence(opts.anchor, opts.freq, k)
    if (!due || due >= opts.until) break
    let amount = opts.amount
    if (opts.maxTotal != null) {
      amount = Math.min(amount, opts.maxTotal - scheduled)
      if (amount <= 0) break
    }
    scheduled += amount
    const covered = Math.min(paidLeft, amount)
    paidLeft -= covered
    const left = amount - covered
    // very old unpaid items are more likely unrecorded than unpaid; don't let them pile up
    if (left > 0.005 && due >= opts.oldestOverdue) out.push({ due, amount: left })
  }
  return out
}

function nextPayday(src: IncomeSource, today: string, paidToday: boolean): string | null {
  if (src.frequency === 'irregular' || !src.next_pay_date || !src.active) return null
  for (let k = 0; k < 500; k++) {
    const d = occurrence(src.next_pay_date, src.frequency, k)!
    if (d > today || (d === today && !paidToday)) return d
  }
  return null
}

export function computeSnapshot(input: EngineInput): Snapshot {
  const { today, profile } = input
  const asOf = profile.balance_as_of
  const settings = profile.alert_settings
  const dismissed = input.dismissed ?? new Set<string>()
  const catName = new Map(input.categories.map(c => [c.id, c.name]))

  // only transactions from setup day up to today move balances
  const live = input.transactions.filter(t => t.occurred_on >= asOf && t.occurred_on <= today)

  // ---------- money on hand ----------
  const cash = (t: Transaction) => (t.type === 'income' ? t.amount : t.type === 'transfer' ? 0 : -t.amount)
  const available = profile.starting_balance + sum(live.map(cash))

  // ---------- planning window: until next payday ----------
  const incomeToday = live.some(t => t.type === 'income' && t.occurred_on === today)
  const paydays = input.incomeSources.map(s => nextPayday(s, today, incomeToday)).filter((d): d is string => !!d).sort()
  const hasPayday = paydays.length > 0 && daysBetween(today, paydays[0]) <= 45
  const windowEnd = hasPayday ? paydays[0] : addDays(today, 30)
  const windowDays = Math.max(daysBetween(today, windowEnd), 1)
  const oldestOverdue = addDays(today, -60)
  const upcomingEnd = addDays(today, 31)
  const scheduleUntil = windowEnd > upcomingEnd ? windowEnd : upcomingEnd

  // ---------- scheduled payments ----------
  const allDue: DuePayment[] = []
  for (const o of input.obligations.filter(x => x.active)) {
    const paid = sum(live.filter(t => t.obligation_id === o.id).map(t => t.amount))
    for (const d of unpaidSchedule({ anchor: o.next_due_date, freq: o.frequency, amount: o.amount, paid, until: scheduleUntil, oldestOverdue })) {
      allDue.push({ key: `ob:${o.id}:${d.due}`, kind: 'obligation', refId: o.id, name: o.name, due: d.due, amount: d.amount, essential: o.is_essential, overdue: d.due < today })
    }
  }

  const debtItems: DebtStatus[] = []
  for (const debt of input.debts) {
    const paid = sum(live.filter(t => t.type === 'debt_repayment' && t.debt_id === debt.id).map(t => t.amount))
    const remaining = Math.max(debt.opening_balance - paid, 0)
    const pct = debt.original_amount > 0 ? Math.min(1, (debt.original_amount - remaining) / debt.original_amount) : 1
    debtItems.push({ debt, remaining, paid, pct })
    if (debt.status !== 'active' || remaining <= 0 || !debt.next_due_date) continue
    const per = debt.minimum_payment > 0 ? debt.minimum_payment : debt.repayment_frequency === 'one_off' ? debt.opening_balance : 0
    if (per <= 0) continue
    for (const d of unpaidSchedule({ anchor: debt.next_due_date, freq: debt.repayment_frequency, amount: per, paid, until: scheduleUntil, maxTotal: debt.opening_balance, oldestOverdue })) {
      allDue.push({ key: `debt:${debt.id}:${d.due}`, kind: 'debt', refId: debt.id, name: `Repay ${debt.creditor}`, due: d.due, amount: d.amount, essential: true, overdue: d.due < today })
    }
  }
  allDue.sort((a, b) => a.due.localeCompare(b.due))
  const dueInWindow = allDue.filter(d => d.due < windowEnd)
  const upcoming = allDue.filter(d => d.due < upcomingEnd)

  // ---------- income pattern ----------
  const activeIncome = input.incomeSources.filter(s => s.active)
  const income = {
    expectedMonthly: round(sum(activeIncome.map(s => s.expected_amount * perMonth(s.frequency)))),
    minimumMonthly: round(sum(activeIncome.map(s => s.minimum_amount * perMonth(s.frequency)))),
    optimisticMonthly: round(sum(activeIncome.map(s => (s.optimistic_amount ?? s.expected_amount) * perMonth(s.frequency)))),
    irregular: activeIncome.some(s => s.frequency === 'irregular' || s.minimum_amount < s.expected_amount),
  }

  // ---------- this month ----------
  const mStart = monthStart(today)
  const mEnd = monthEnd(today)
  const daysInMonth = daysBetween(mStart, mEnd) + 1
  const dayOfMonth = daysBetween(mStart, today) + 1
  const monthTx = input.transactions.filter(t => t.occurred_on >= mStart && t.occurred_on <= today)
  const expenses = monthTx.filter(t => t.type === 'expense')
  const wStart = weekStart(today)
  const weekUnplanned = input.transactions.filter(t => t.type === 'expense' && t.is_planned === false && t.occurred_on >= wStart && t.occurred_on <= today)
  const month = {
    start: mStart, end: mEnd, daysLeft: daysInMonth - dayOfMonth, dayFraction: dayOfMonth / daysInMonth,
    income: sum(monthTx.filter(t => t.type === 'income').map(t => t.amount)),
    spent: sum(expenses.map(t => t.amount)),
    saved: sum(monthTx.filter(t => t.type === 'savings').map(t => t.amount)),
    repaid: sum(monthTx.filter(t => t.type === 'debt_repayment').map(t => t.amount)),
    needs: sum(expenses.filter(t => t.necessity === 'need').map(t => t.amount)),
    wants: sum(expenses.filter(t => t.necessity === 'want').map(t => t.amount)),
    unplannedCount: expenses.filter(t => t.is_planned === false).length,
    unplannedAmount: sum(expenses.filter(t => t.is_planned === false).map(t => t.amount)),
  }
  const week = { unplannedCount: weekUnplanned.length, unplannedAmount: sum(weekUnplanned.map(t => t.amount)) }

  // ---------- goals ----------
  const goals: GoalStatus[] = input.goals.filter(g => g.status === 'active').map(g => {
    const saved = g.starting_amount + sum(live.filter(t => t.type === 'savings' && t.goal_id === g.id).map(t => t.amount))
    const remaining = Math.max(g.target_amount - saved, 0)
    let suggestedMonthly: number | null = null
    let onTrack: boolean | null = null
    if (g.deadline && remaining > 0) {
      const monthsLeft = Math.max(daysBetween(today, g.deadline) / 30.44, 1)
      suggestedMonthly = round(remaining / monthsLeft)
      const start = (g.created_at ?? asOf).slice(0, 10)
      const total = Math.max(daysBetween(start, g.deadline), 1)
      const elapsed = Math.min(Math.max(daysBetween(start, today), 0), total)
      if (elapsed >= 14) {
        const expected = g.starting_amount + (g.target_amount - g.starting_amount) * (elapsed / total)
        onTrack = saved >= expected - g.target_amount * 0.05
      }
    } else if (remaining <= 0) onTrack = true
    return { goal: g, saved, pct: Math.min(saved / g.target_amount, 1), remaining, suggestedMonthly, onTrack }
  })

  // savings to set aside this month: each dated goal's monthly need, worked out from where it stood
  // on the 1st, minus what has gone into it since. Unlinked savings count against the total.
  const savedThisMonth = (goalId: string | null) =>
    sum(monthTx.filter(t => t.type === 'savings' && t.goal_id === goalId && t.occurred_on >= asOf).map(t => t.amount))
  const perGoalReserve = goals.map(g => {
    if (!g.goal.deadline) return 0
    const thisMonth = savedThisMonth(g.goal.id)
    const remainingAtStart = Math.max(g.goal.target_amount - (g.saved - thisMonth), 0)
    const monthsLeft = Math.max(daysBetween(mStart > asOf ? mStart : asOf, g.goal.deadline) / 30.44, 1)
    return Math.max(remainingAtStart / monthsLeft - thisMonth, 0)
  })
  const savingsReserve = round(Math.max(sum(perGoalReserve) - savedThisMonth(null), 0))

  // ---------- budgets ----------
  const budgets: BudgetStatus[] = input.budgets.map(b => {
    const spent = sum(expenses.filter(t => t.category_id === b.category_id).map(t => t.amount))
    return {
      budget: b, category: catName.get(b.category_id) ?? 'Category', spent,
      pct: spent / b.monthly_limit, remaining: b.monthly_limit - spent,
      projected: round((spent / dayOfMonth) * daysInMonth),
    }
  }).sort((a, b) => b.pct - a.pct)

  // ---------- safe to spend ----------
  const overdue = sum(dueInWindow.filter(d => d.overdue).map(d => d.amount))
  const obligationsDue = sum(dueInWindow.filter(d => !d.overdue && d.kind === 'obligation').map(d => d.amount))
  const debtsDue = sum(dueInWindow.filter(d => !d.overdue && d.kind === 'debt').map(d => d.amount))
  const buffer = profile.emergency_buffer
  const raw = available - overdue - obligationsDue - debtsDue - savingsReserve - buffer
  const safeToSpend = Math.max(round(raw), 0)
  const shortfall = raw < 0 ? round(-raw) : 0
  const perDay = round(safeToSpend / windowDays)
  const until = hasPayday ? 'before payday' : 'in the next 30 days'
  const count = (k: 'obligation' | 'debt') => dueInWindow.filter(d => !d.overdue && d.kind === k).length

  const breakdown: BreakdownLine[] = [{ label: 'Money you have now', amount: round(available), detail: 'Your starting balance plus everything recorded since' }]
  if (overdue) breakdown.push({ label: 'Overdue payments', amount: -round(overdue) })
  if (obligationsDue) breakdown.push({ label: `Bills due ${until}`, amount: -round(obligationsDue), detail: `${count('obligation')} payment${count('obligation') === 1 ? '' : 's'}` })
  if (debtsDue) breakdown.push({ label: `Debt repayments due ${until}`, amount: -round(debtsDue) })
  if (savingsReserve) breakdown.push({ label: 'Savings still planned this month', amount: -round(savingsReserve), detail: 'What your goals need to stay on schedule' })
  if (buffer) breakdown.push({ label: 'Emergency buffer', amount: -round(buffer), detail: 'Never counted as spendable' })

  // ---------- alerts ----------
  const alerts: Alert[] = []
  const fmtDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }
  const money = (n: number) => formatMoney(round(n), input.currency)
  const monthKey = mStart.slice(0, 7)

  if (shortfall > 0) {
    alerts.push({
      key: `shortfall:${today}`, severity: 'high',
      title: `You're ${money(shortfall)} short ${until}`,
      body: `What's committed (bills, repayments${savingsReserve ? ', planned savings' : ''}${buffer ? ', your buffer' : ''}) adds up to more than the ${money(available)} you have. Hold off on anything non-essential${hasPayday ? ` until ${fmtDay(windowEnd)}` : ''}.`,
    })
  }

  for (const d of dueInWindow.filter(x => x.overdue)) {
    alerts.push({
      key: `overdue:${d.key}`, severity: 'high',
      title: `${d.name} was due ${fmtDay(d.due)}`,
      body: `${money(d.amount)} is still unpaid. If you've already paid it, record it and pick “${d.kind === 'debt' ? 'Repayment' : d.name}” so GreenWise stops counting it.`,
      focus: d.kind === 'debt' ? 'debt' : undefined,
    })
  }

  for (const b of budgets) {
    const label = b.category.toLowerCase()
    if (b.pct >= 1) {
      alerts.push({
        key: `budget-over:${b.budget.id}:${monthKey}`, severity: 'high',
        title: `${b.category} is over its limit`,
        body: `You've spent ${money(b.spent)} on ${label} this month, ${money(-b.remaining)} over your ${money(b.budget.monthly_limit)} limit.`,
        focus: 'overspending', link: '/plan',
      })
    } else if (b.pct * 100 >= settings.budget_warn_pct) {
      alerts.push({
        key: `budget-warn:${b.budget.id}:${monthKey}`, severity: 'medium',
        title: `${b.category} spending alert`,
        body: `You've used ${round(b.pct * 100)}% of your ${label} budget with ${month.daysLeft} day${month.daysLeft === 1 ? '' : 's'} left. ${money(b.remaining)} remaining.`,
        focus: 'overspending', link: '/plan',
      })
    } else if (dayOfMonth >= 7 && b.projected > b.budget.monthly_limit * 1.05) {
      alerts.push({
        key: `budget-pace:${b.budget.id}:${monthKey}`, severity: 'low',
        title: `${b.category} is running fast`,
        body: `At this pace you'll spend about ${money(b.projected)} on ${label} this month, ${money(b.projected - b.budget.monthly_limit)} over your limit.`,
        focus: 'overspending', link: '/plan',
      })
    }
  }

  const unplannedLimit = profile.focus_areas.includes('impulse') ? Math.min(settings.unplanned_per_week, 3) : settings.unplanned_per_week
  if (week.unplannedCount >= unplannedLimit) {
    alerts.push({
      key: `unplanned:${wStart}:${week.unplannedCount >= unplannedLimit * 2 ? 2 : 1}`, severity: 'medium',
      title: 'Spending pattern detected',
      body: `You've made ${week.unplannedCount} unplanned purchases this week, ${money(week.unplannedAmount)} in total.`,
      focus: 'impulse', link: '/transactions',
    })
  }

  for (const g of goals.filter(x => x.onTrack === false)) {
    const start = (g.goal.created_at ?? asOf).slice(0, 10)
    const months = Math.max(daysBetween(start > asOf ? start : asOf, today) / 30.44, 0.5)
    const rate = (g.saved - g.goal.starting_amount) / months
    const monthsToDeadline = Math.max(daysBetween(today, g.goal.deadline!) / 30.44, 0)
    const projected = g.saved + rate * monthsToDeadline
    alerts.push({
      key: `goal-behind:${g.goal.id}:${monthKey}`, severity: 'medium',
      title: `${g.goal.name} is behind schedule`,
      body: rate > 0
        ? `At your current rate of about ${money(rate)} a month you'd have ${money(projected)} by ${fmtDay(g.goal.deadline!)}, ${money(g.goal.target_amount - projected)} short of ${money(g.goal.target_amount)}. Saving ${money(g.suggestedMonthly ?? 0)} a month gets you there.`
        : `Nothing has gone into it since you set it up. Saving ${money(g.suggestedMonthly ?? 0)} a month gets you to ${money(g.goal.target_amount)} by ${fmtDay(g.goal.deadline!)}.`,
      focus: 'save_more', link: '/plan',
    })
  }

  if (income.minimumMonthly > 0 && month.spent > income.minimumMonthly * 0.3 && month.spent / income.minimumMonthly > month.dayFraction + 0.15) {
    alerts.push({
      key: `pace:${monthKey}:${round((month.spent / income.minimumMonthly) * 10)}`, severity: 'medium',
      title: 'Spending is ahead of the month',
      body: `You've spent ${round((month.spent / income.minimumMonthly) * 100)}% of your ${income.irregular ? 'minimum ' : ''}monthly income, and ${round(month.dayFraction * 100)}% of the month has passed.`,
      focus: 'overspending',
    })
  }

  const commitments = trackCommitments(input.commitments ?? [], input.transactions, today, money, id => (id ? catName.get(id) ?? 'Category' : 'Wants'))
  for (const c of commitments) {
    if (c.state === 'at_risk') {
      alerts.push({ key: `commit-risk:${c.commitment.id}:${today}`, severity: 'medium', title: `“${c.commitment.title}” is at risk`, body: c.message, focus: c.commitment.kind === 'save_target' ? 'save_more' : 'overspending', link: '/decisions' })
    } else if (c.state === 'broken' && !c.finished) {
      alerts.push({ key: `commit-broken:${c.commitment.id}`, severity: 'high', title: `You've gone past “${c.commitment.title}”`, body: c.message, focus: c.commitment.kind === 'no_unplanned' ? 'impulse' : 'overspending', link: '/decisions' })
    } else if (c.finished) {
      alerts.push({ key: `commit-done:${c.commitment.id}`, severity: 'low', title: `“${c.commitment.title}” has ended`, body: `${c.message} Close it in Decisions to record the result.`, link: '/decisions' })
    }
  }

  const rank = { high: 0, medium: 1, low: 2 }
  const focusSet = new Set(profile.focus_areas)
  const visibleAlerts = alerts
    .filter(a => !dismissed.has(a.key))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || Number(focusSet.has(b.focus ?? '')) - Number(focusSet.has(a.focus ?? '')))

  // ---------- one clear next step ----------
  let nextStep: string
  const behind = goals.find(g => g.onTrack === false)
  const topGoal = [...goals].filter(g => g.remaining > 0).sort((a, b) => a.goal.priority - b.goal.priority)[0]
  if (shortfall > 0) nextStep = `Cover what's due first. You need ${money(shortfall)} more ${until}, so keep spending to essentials only.`
  else if (overdue > 0) nextStep = `Pay or record your overdue ${dueInWindow.find(d => d.overdue)!.name.toLowerCase()} payment.`
  else if (behind && behind.suggestedMonthly) nextStep = `Move ${money(Math.min(behind.suggestedMonthly, safeToSpend))} into ${behind.goal.name} to get it back on track.`
  else if (savingsReserve > 0 && topGoal) nextStep = `Put this month's ${money(savingsReserve)} towards ${topGoal.goal.name} now, before it gets spent.`
  else if (safeToSpend > 0) nextStep = `You can spend about ${money(perDay)} a day ${hasPayday ? `until ${fmtDay(windowEnd)}` : 'for the next 30 days'} and stay on plan.`
  else nextStep = 'Everything you have is already committed. Log any income as soon as it lands.'

  const debtTotal = sum(debtItems.filter(d => d.debt.status === 'active').map(d => d.remaining))
  const debtOpening = sum(debtItems.filter(d => d.debt.status === 'active').map(d => d.debt.original_amount))

  return {
    today, available: round(available), safeToSpend, shortfall, perDay, windowEnd, windowDays, hasPayday,
    breakdown,
    reserved: { overdue: round(overdue), obligations: round(obligationsDue), debts: round(debtsDue), savings: round(savingsReserve), buffer: round(buffer) },
    dueInWindow, upcoming, income, month, week, goals,
    debts: { totalRemaining: round(debtTotal), totalOpening: round(debtOpening), items: debtItems },
    budgets, commitments, alerts: visibleAlerts, nextStep,
  }
}
