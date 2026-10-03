// "Can I afford it?" and "Should I buy it?" are two separate questions.
// Affordability is about money already committed. Whether to buy weighs need,
// timing, budgets, goals, commitments and recent behaviour.

import type { Snapshot } from './engine'
import type { CommitmentStatus } from './commitments'
import type { Transaction } from '../lib/types'
import { daysBetween, monthStart } from './dates'

export type DecisionInput = {
  item: string
  price: number
  necessity: 'need' | 'want'
  neededBy: string | null
  categoryId: string | null
  categoryName: string | null
}

export type Level = 'high' | 'medium' | 'low'

export type DecisionResult = {
  canAfford: boolean
  affordability: Level | 'none'
  impact: Level
  priority: Level
  verdict: 'go_ahead' | 'go_ahead_carefully' | 'wait' | 'skip'
  headline: string          // the "can I afford it" answer
  advice: string            // the "should I buy it" answer
  reasons: string[]         // the evidence, in plain sentences
  after: { safeToSpend: number; perDay: number }
  goalDelayDays: number | null
  goalName: string | null
}

export function decide(
  d: DecisionInput, s: Snapshot, transactions: Transaction[], commitments: CommitmentStatus[],
  money: (n: number) => string, fmtDay: (iso: string) => string,
): DecisionResult {
  const reasons: string[] = []
  const price = d.price
  const today = s.today
  const until = s.hasPayday ? `until payday on ${fmtDay(s.windowEnd)}` : 'over the next 30 days'

  // ---------- can I afford it? ----------
  // What could be freed up if you really had to: the savings plan and your buffer.
  const softReserve = s.reserved.savings + s.reserved.buffer
  const canAfford = price <= s.safeToSpend
  let affordability: DecisionResult['affordability']
  if (price <= s.safeToSpend * 0.5) affordability = 'high'
  else if (canAfford) affordability = 'medium'
  else if (price <= s.safeToSpend + softReserve) affordability = 'low'
  else affordability = 'none'

  const afterSafe = Math.max(s.safeToSpend - price, 0)
  const afterPerDay = Math.round(afterSafe / s.windowDays)

  let headline: string
  if (affordability === 'high') headline = `You can afford this ${money(price)} purchase.`
  else if (affordability === 'medium') headline = `You can afford it, but it uses most of what's safe to spend.`
  else if (affordability === 'low') headline = `You can only afford this by dipping into your savings plan or buffer.`
  else headline = price > s.available
    ? `You don't have enough money for this right now.`
    : `You can't afford this without missing something you've committed to.`

  if (canAfford) reasons.push(`Safe to spend goes from ${money(s.safeToSpend)} to ${money(afterSafe)}, about ${money(afterPerDay)} a day ${until}.`)
  else if (affordability === 'low') reasons.push(`It's ${money(price - s.safeToSpend)} more than your ${money(s.safeToSpend)} safe to spend. The rest would come out of money set aside for ${s.reserved.savings ? 'your goals' : ''}${s.reserved.savings && s.reserved.buffer ? ' and ' : ''}${s.reserved.buffer ? 'your emergency buffer' : ''}.`)
  else reasons.push(`Bills, repayments and savings already claim most of your ${money(s.available)}. Only ${money(s.safeToSpend)} is free ${until}.`)

  // ---------- urgency & need ----------
  const daysToNeed = d.neededBy ? daysBetween(today, d.neededBy) : null
  const urgent = daysToNeed != null && daysToNeed <= 7
  const canWaitForPayday = s.hasPayday && (daysToNeed == null || d.neededBy! >= s.windowEnd)
  let priority: Level = d.necessity === 'need' ? (urgent ? 'high' : 'medium') : (urgent ? 'medium' : 'low')
  if (d.necessity === 'need' && urgent) reasons.push(`It's a need, and you need it ${daysToNeed! <= 0 ? 'now' : `within ${daysToNeed} day${daysToNeed === 1 ? '' : 's'}`}.`)
  else if (d.necessity === 'need') reasons.push(`It's a need${daysToNeed != null ? `, needed by ${fmtDay(d.neededBy!)}` : ''}.`)
  else reasons.push(`It's a want${urgent ? ' with a deadline' : ', so timing is up to you'}.`)

  // ---------- budget for that category ----------
  let impactScore = 0
  const budget = d.categoryId ? s.budgets.find(b => b.budget.category_id === d.categoryId) : undefined
  if (budget) {
    const left = budget.remaining - price
    if (left < 0) {
      impactScore += 2
      reasons.push(`It would take your ${budget.category.toLowerCase()} budget ${money(-left)} over its ${money(budget.budget.monthly_limit)} limit.`)
    } else {
      if (left < budget.budget.monthly_limit * 0.2) impactScore += 1
      reasons.push(`You'd have ${money(left)} left in your ${budget.category.toLowerCase()} budget for the rest of the month.`)
    }
  } else if (d.categoryId && d.categoryName) {
    const mStart = monthStart(today)
    const spentHere = transactions.filter(t => t.type === 'expense' && t.category_id === d.categoryId && t.occurred_on >= mStart && t.occurred_on <= today).reduce((a, t) => a + t.amount, 0)
    if (spentHere > 0) reasons.push(`You've already spent ${money(spentHere)} on ${d.categoryName.toLowerCase()} this month.`)
  }

  // ---------- goals ----------
  const goal = [...s.goals].filter(g => g.remaining > 0).sort((a, b) => a.goal.priority - b.goal.priority)[0]
  let goalDelayDays: number | null = null
  if (goal) {
    // daily savings rate: the goal's suggested pace, or what you've actually been putting in
    const sinceStart = Math.max(daysBetween(goal.goal.created_at?.slice(0, 10) ?? today, today), 0)
    const actualDaily = sinceStart >= 14 ? (goal.saved - goal.goal.starting_amount) / sinceStart : 0
    const daily = goal.suggestedMonthly ? goal.suggestedMonthly / 30.44 : actualDaily
    if (daily > 0) {
      goalDelayDays = Math.round(price / daily)
      if (goalDelayDays >= 1) {
        reasons.push(`It could push your ${goal.goal.name} goal about ${goalDelayDays} day${goalDelayDays === 1 ? '' : 's'} further away at your ${goal.suggestedMonthly ? 'planned' : 'current'} savings rate.`)
        if (goalDelayDays >= 14) impactScore += 2
        else if (goalDelayDays >= 5) impactScore += 1
      }
    }
  }

  // ---------- size of the hit ----------
  const share = s.safeToSpend > 0 ? price / s.safeToSpend : Infinity
  if (share > 0.5) impactScore += 1
  if (!canAfford) impactScore += 2

  // ---------- commitments ----------
  for (const c of commitments.filter(x => !x.finished && (x.state === 'on_track' || x.state === 'at_risk'))) {
    const k = c.commitment
    if (k.kind === 'spend_limit') {
      const applies = k.category_id ? k.category_id === d.categoryId : d.necessity === 'want'
      if (applies) {
        const left = c.target - c.progress
        if (price > left) { impactScore += 2; reasons.push(`It would break your commitment “${k.title}” (only ${money(left)} left).`) }
        else reasons.push(`It fits your commitment “${k.title}”, leaving ${money(left - price)}.`)
      }
    }
    if (k.kind === 'no_unplanned' && d.necessity === 'want') {
      reasons.push(`You committed to “${k.title}”. Buying it as an unplanned purchase would break that.`)
      impactScore += 1
    }
  }

  // ---------- recent behaviour ----------
  if (d.necessity === 'want' && s.week.unplannedCount >= 3) {
    reasons.push(`You've made ${s.week.unplannedCount} unplanned purchases this week already.`)
    impactScore += 1
  }

  const impact: Level = impactScore >= 3 ? 'high' : impactScore >= 1 ? 'medium' : 'low'

  // ---------- should I buy it? ----------
  let verdict: DecisionResult['verdict']
  if (!canAfford) verdict = priority === 'high' ? 'go_ahead_carefully' : 'wait'
  else if (priority === 'high') verdict = impact === 'high' ? 'go_ahead_carefully' : 'go_ahead'
  else if (priority === 'medium') verdict = impact === 'low' ? 'go_ahead' : impact === 'medium' ? 'go_ahead_carefully' : 'wait'
  else verdict = impact === 'low' ? 'go_ahead_carefully' : impact === 'medium' ? 'wait' : 'skip'
  if (verdict === 'go_ahead_carefully' && priority === 'low' && impact === 'low' && share < 0.15) verdict = 'go_ahead'

  const paydayHint = canWaitForPayday ? ` until after payday on ${fmtDay(s.windowEnd)}` : ''
  let advice: string
  switch (verdict) {
    case 'go_ahead':
      advice = priority === 'high' ? 'It\'s needed soon and fits your plan. Go ahead.' : 'It fits your plan without putting anything else at risk.'
      break
    case 'go_ahead_carefully':
      advice = !canAfford
        ? `You need it soon, so it may be worth it, but cover the ${money(price - s.safeToSpend)} gap by cutting other spending ${until}${s.reserved.savings ? ' or pausing this month\'s savings' : ''}.`
        : 'It\'s affordable, but it has a real cost elsewhere. Buy it only if it\'s still worth it after reading the points below.'
      break
    case 'wait':
      advice = `Consider postponing it${paydayHint || (d.neededBy ? ` closer to ${fmtDay(d.neededBy)}` : '')}${canAfford ? '' : ', when it won\'t squeeze what you\'ve already committed to'}.`
      break
    case 'skip':
      advice = 'This one costs more than it gives back right now. Consider skipping it, or adding it to your Priorities to revisit later.'
      break
  }

  // a cheaper alternative date: next payday
  if ((verdict === 'wait' || verdict === 'skip') && s.hasPayday && !reasons.some(r => r.includes('payday'))) {
    reasons.push(`Your next payday is ${fmtDay(s.windowEnd)}, ${daysBetween(today, s.windowEnd)} day${daysBetween(today, s.windowEnd) === 1 ? '' : 's'} away.`)
  }

  return { canAfford, affordability, impact, priority, verdict, headline, advice, reasons, after: { safeToSpend: afterSafe, perDay: afterPerDay }, goalDelayDays, goalName: goal?.goal.name ?? null }
}
