// Behavioural insights. Each one must point to a decision the person can make;
// patterns that don't change anything are left out on purpose.
import type { Category, Debt, Obligation, Transaction } from '../lib/types'
import type { Snapshot } from './engine'
import { addDays, addMonths, daysBetween, monthStart, perMonth } from './dates'

export type Insight = {
  key: string
  kind: 'small_purchases' | 'large_purchase' | 'rising_category' | 'recurring' | 'subscriptions' | 'unplanned' | 'spike' | 'month_change' | 'vs_income' | 'vs_goals'
  title: string
  body: string
  action: string
  link?: string
  weight: number      // higher = more worth showing
  focus?: string
}

export type InsightInput = {
  snapshot: Snapshot
  transactions: Transaction[]
  categories: Category[]
  obligations: Obligation[]
  debts: Debt[]
  focus: string[]
  largePurchasePct: number
  money: (n: number) => string
}

const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

export function computeInsights(i: InsightInput): { insights: Insight[]; enoughData: boolean } {
  const { snapshot: s, money } = i
  const today = s.today
  const out: Insight[] = []
  const cat = new Map(i.categories.map(c => [c.id, c]))
  const expenses = i.transactions.filter(t => t.type === 'expense' && t.occurred_on <= today)
  const last30 = expenses.filter(t => t.occurred_on > addDays(today, -30))
  const enoughData = expenses.length >= 5
  if (!enoughData) return { insights: [], enoughData }

  const minIncome = s.income.minimumMonthly
  const topGoal = [...s.goals].filter(g => g.remaining > 0).sort((a, b) => a.goal.priority - b.goal.priority)[0]

  // ---------- 1. frequent small purchases ----------
  const smallLimit = Math.max(Math.round((minIncome || 100000) * 0.012 / 500) * 500, 1000)
  const small = last30.filter(t => t.amount <= smallLimit && !t.obligation_id)
  const smallTotal = small.reduce((a, t) => a + t.amount, 0)
  if (small.length >= 8) {
    out.push({
      key: 'small', kind: 'small_purchases', weight: 60 + small.length,
      title: `${small.length} small purchases in 30 days`,
      body: `Each was ${money(smallLimit)} or less, but together they add up to ${money(smallTotal)}${minIncome ? `, ${Math.round((smallTotal / minIncome) * 100)}% of a month's ${s.income.irregular ? 'minimum ' : ''}income` : ''}.`,
      action: topGoal ? `Cutting them by half would put about ${money(smallTotal / 2)} a month towards ${topGoal.goal.name}.` : 'Try a weekly cap for small spending, then see what’s left at the end of the week.',
      link: '/transactions', focus: 'impulse',
    })
  }

  // ---------- 2. large purchases ----------
  if (minIncome > 0) {
    const big = last30.filter(t => !t.obligation_id && t.amount >= minIncome * (i.largePurchasePct / 100)).sort((a, b) => b.amount - a.amount)
    if (big.length) {
      const b = big[0]
      out.push({
        key: `large:${b.id}`, kind: 'large_purchase', weight: 45,
        title: big.length === 1 ? 'One large purchase this month' : `${big.length} large purchases in 30 days`,
        body: `${b.description || cat.get(b.category_id ?? '')?.name || 'A purchase'} cost ${money(b.amount)}, ${Math.round((b.amount / minIncome) * 100)}% of your ${s.income.irregular ? 'minimum ' : ''}monthly income${big.length > 1 ? `. Together they come to ${money(big.reduce((a, t) => a + t.amount, 0))}` : ''}.`,
        action: 'Next time, run it through “Should I buy it?” first so you can see what it pushes back.',
        link: '/decisions',
      })
    }
  }

  // ---------- 3. rising category spending ----------
  const mStart = monthStart(today)
  const dayOfMonth = daysBetween(mStart, today) + 1
  if (dayOfMonth >= 7) {
    const thisMonth = new Map<string, number>()
    const prev = new Map<string, number>()
    const prevStart = addMonths(mStart, -3)
    let prevMonths = 0
    for (let k = 1; k <= 3; k++) if (expenses.some(t => t.occurred_on >= addMonths(mStart, -k) && t.occurred_on < addMonths(mStart, -k + 1))) prevMonths++
    for (const t of expenses) {
      if (!t.category_id || t.obligation_id) continue
      if (t.occurred_on >= mStart) thisMonth.set(t.category_id, (thisMonth.get(t.category_id) ?? 0) + t.amount)
      else if (t.occurred_on >= prevStart) prev.set(t.category_id, (prev.get(t.category_id) ?? 0) + t.amount)
    }
    if (prevMonths > 0) {
      const daysInMonth = daysBetween(mStart, addDays(addMonths(mStart, 1), -1)) + 1
      const rising = [...thisMonth.entries()].map(([id, spent]) => {
        const projected = (spent / dayOfMonth) * daysInMonth
        const avg = (prev.get(id) ?? 0) / prevMonths
        return { id, spent, projected, avg }
      }).filter(r => r.avg > 0 && r.projected > r.avg * 1.3 && r.projected - r.avg > Math.max(minIncome * 0.02, 2000))
        .sort((a, b) => (b.projected - b.avg) - (a.projected - a.avg))
      for (const r of rising.slice(0, 2)) {
        const name = cat.get(r.id)?.name ?? 'A category'
        out.push({
          key: `rising:${r.id}:${mStart}`, kind: 'rising_category', weight: 55,
          title: `${name} spending is climbing`,
          body: `You're on pace for about ${money(r.projected)} on ${name.toLowerCase()} this month, up from an average of ${money(r.avg)}.`,
          action: s.budgets.some(b => b.budget.category_id === r.id) ? `Check your ${name.toLowerCase()} budget in Plan.` : `Set a ${name.toLowerCase()} budget around ${money(Math.round(r.avg / 1000) * 1000 || r.avg)} so you get a warning before it runs away.`,
          link: '/plan', focus: 'overspending',
        })
      }
    }
  }

  // ---------- 4. recurring expenses not planned for ----------
  const groups = new Map<string, Transaction[]>()
  for (const t of expenses) {
    if (t.obligation_id) continue
    const k = norm(t.description)
    if (k.length < 3) continue
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  const known = new Set(i.obligations.map(o => norm(o.name)))
  for (const [k, list] of groups) {
    const months = new Set(list.map(t => t.occurred_on.slice(0, 7)))
    if (months.size < 2 || known.has(k)) continue
    const amounts = list.map(t => t.amount)
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length
    if (amounts.some(a => Math.abs(a - avg) > avg * 0.25)) continue // not a steady amount
    out.push({
      key: `recurring:${k}`, kind: 'recurring', weight: 50,
      title: `“${list[0].description}” looks like a regular payment`,
      body: `It shows up in ${months.size} different months, about ${money(avg)} each time.`,
      action: 'Add it to Regular payments so GreenWise sets the money aside before telling you what’s safe to spend.',
      link: '/plan?tab=bills',
    })
  }

  // ---------- 5. subscription leakage ----------
  const subCat = i.categories.find(c => c.name === 'Subscriptions' && c.kind === 'expense')
  const subOblig = i.obligations.filter(o => o.active && (o.category_id === subCat?.id || /subscri|netflix|spotify|showmax|dstv|gotv|apple|youtube|icloud|prime/i.test(o.name)))
  const subMonthly = subOblig.reduce((a, o) => a + o.amount * perMonth(o.frequency), 0)
    + (subCat ? last30.filter(t => t.category_id === subCat.id && !t.obligation_id).reduce((a, t) => a + t.amount, 0) : 0)
  if (subMonthly > 0 && (subOblig.length >= 3 || (minIncome > 0 && subMonthly > minIncome * 0.05))) {
    out.push({
      key: `subs:${mStart}`, kind: 'subscriptions', weight: 40,
      title: `Subscriptions cost about ${money(subMonthly)} a month`,
      body: `That's ${money(subMonthly * 12)} a year${minIncome ? `, ${Math.round((subMonthly / minIncome) * 100)}% of your monthly income` : ''}.`,
      action: 'Go through them and cancel any you haven’t used in the last month.',
      link: '/plan?tab=bills',
    })
  }

  // ---------- 6. unplanned purchases ----------
  const spent30 = last30.reduce((a, t) => a + t.amount, 0)
  const unplanned = last30.filter(t => t.is_planned === false)
  const unplannedTotal = unplanned.reduce((a, t) => a + t.amount, 0)
  if (spent30 > 0 && unplanned.length >= 3 && unplannedTotal / spent30 > 0.2) {
    out.push({
      key: `unplanned:${mStart}`, kind: 'unplanned', weight: 58 + Math.round((unplannedTotal / spent30) * 20),
      title: `${Math.round((unplannedTotal / spent30) * 100)}% of your spending was unplanned`,
      body: `${unplanned.length} unplanned purchases in the last 30 days came to ${money(unplannedTotal)}.`,
      action: 'Try a “no unplanned purchases” commitment for one week and see how much it frees up.',
      link: '/decisions?tab=commitments', focus: 'impulse',
    })
  }

  // ---------- 7. spending spikes ----------
  const byDay = new Map<string, number>()
  for (const t of last30) if (!t.obligation_id) byDay.set(t.occurred_on, (byDay.get(t.occurred_on) ?? 0) + t.amount)
  const days = [...byDay.values()]
  if (days.length >= 5) {
    const avg = days.reduce((a, b) => a + b, 0) / 30
    const [spikeDay, spikeAmt] = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]
    if (spikeAmt > avg * 4 && spikeAmt > Math.max(minIncome * 0.05, 5000) && daysBetween(spikeDay, today) <= 14) {
      const [y, m, d] = spikeDay.split('-').map(Number)
      out.push({
        key: `spike:${spikeDay}`, kind: 'spike', weight: 35,
        title: 'A spending spike',
        body: `You spent ${money(spikeAmt)} on ${new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}, about ${Math.round(spikeAmt / avg)} times a normal day.`,
        action: 'If something set it off (a night out, a sale, payday), plan for it next time instead of letting it surprise you.',
        link: '/transactions',
      })
    }
  }

  // ---------- 8. month-to-month change ----------
  const lastMonthStart = addMonths(mStart, -1)
  const lastMonthSpent = expenses.filter(t => t.occurred_on >= lastMonthStart && t.occurred_on < mStart).reduce((a, t) => a + t.amount, 0)
  const daysInMonth = daysBetween(mStart, addDays(addMonths(mStart, 1), -1)) + 1
  const projectedMonth = dayOfMonth >= 7 ? (s.month.spent / dayOfMonth) * daysInMonth : 0
  if (lastMonthSpent > 0 && projectedMonth > 0) {
    const change = (projectedMonth - lastMonthSpent) / lastMonthSpent
    if (Math.abs(change) >= 0.2) {
      out.push({
        key: `mom:${mStart}`, kind: 'month_change', weight: change > 0 ? 48 : 30,
        title: change > 0 ? 'Spending more than last month' : 'Spending less than last month',
        body: `On your current pace you'll spend about ${money(projectedMonth)} this month, ${Math.round(Math.abs(change) * 100)}% ${change > 0 ? 'more' : 'less'} than the ${money(lastMonthSpent)} you spent last month.`,
        action: change > 0 ? 'Look at which categories grew in Transactions, and decide which one to rein in.' : topGoal ? `Move the difference, about ${money(lastMonthSpent - projectedMonth)}, into ${topGoal.goal.name} before it gets spent.` : 'Decide now where the difference should go, before it gets spent.',
        link: change > 0 ? '/transactions' : '/plan?tab=goals', focus: change > 0 ? 'overspending' : 'save_more',
      })
    }
  }

  // ---------- 9 & 10. spending vs income, and vs goals ----------
  if (dayOfMonth >= 5 && minIncome > 0) {
    const incomeBase = Math.max(s.month.income, s.income.irregular ? s.income.minimumMonthly : s.income.expectedMonthly)
    const discretionary = expenses.filter(t => t.occurred_on >= mStart && !t.obligation_id).reduce((a, t) => a + t.amount, 0)
    const projectedDiscretionary = (discretionary / dayOfMonth) * daysInMonth
    const fixed = i.obligations.filter(o => o.active && o.frequency !== 'once').reduce((a, o) => a + o.amount * perMonth(o.frequency), 0)
      + i.debts.filter(d => d.status === 'active').reduce((a, d) => a + d.minimum_payment * perMonth(d.repayment_frequency), 0)
    const projectedSaving = Math.round(incomeBase - projectedDiscretionary - fixed)
    const savingsTarget = s.goals.reduce((a, g) => a + (g.suggestedMonthly ?? 0), 0)
    if (savingsTarget > 0 && projectedSaving < savingsTarget) {
      out.push({
        key: `vsgoals:${mStart}`, kind: 'vs_goals', weight: 70,
        title: 'On course to miss this month’s savings',
        body: `At your current spending rate, you're projected to save approximately ${money(Math.max(projectedSaving, 0))} this month, which is ${money(savingsTarget - Math.max(projectedSaving, 0))} below your ${money(savingsTarget)} target.`,
        action: `To close the gap, spend about ${money(Math.ceil((savingsTarget - projectedSaving) / Math.max(daysInMonth - dayOfMonth + 1, 1) / 100) * 100)} a day less for the rest of the month.`,
        link: '/plan?tab=goals', focus: 'save_more',
      })
    } else if (projectedDiscretionary + fixed > incomeBase) {
      out.push({
        key: `vsincome:${mStart}`, kind: 'vs_income', weight: 72,
        title: 'Spending more than you earn',
        body: `At this pace you'll spend about ${money(projectedDiscretionary + fixed)} this month, including bills and repayments, against ${money(incomeBase)} of ${s.income.irregular ? 'dependable ' : ''}income.`,
        action: 'Something has to give before the month ends. Start with the wants in Transactions.',
        link: '/transactions', focus: 'overspending',
      })
    } else if (savingsTarget > 0) {
      out.push({
        key: `vsgoals-ok:${mStart}`, kind: 'vs_goals', weight: 20,
        title: 'On course for this month’s savings',
        body: `At your current pace you could save about ${money(projectedSaving)} this month, above your ${money(savingsTarget)} target.`,
        action: `Move ${money(savingsTarget)} into your goals now, so the plan doesn't depend on willpower later.`,
        link: '/plan?tab=goals', focus: 'save_more',
      })
    }
  }

  const focus = new Set(i.focus)
  out.sort((a, b) => (b.weight + (focus.has(b.focus ?? '') ? 15 : 0)) - (a.weight + (focus.has(a.focus ?? '') ? 15 : 0)))
  return { insights: out, enoughData }
}
