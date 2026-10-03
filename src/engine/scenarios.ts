// Conservative / expected / higher-income scenarios.
// Fixed commitments are judged against the conservative figure, so a slow month
// never leaves a bill unpaid. Anything above it is treated as a bonus.
import type { Debt, Goal, IncomeSource, Obligation } from '../lib/types'
import { perMonth } from './dates'

export type ScenarioName = 'conservative' | 'expected' | 'higher'

export type Scenario = {
  name: ScenarioName
  income: number
  fixed: number          // essential bills + debt repayments
  optional: number       // non-essential regular payments
  savings: number        // what dated goals need this month
  budgets: number        // flexible spending limits
  afterFixed: number
  afterSavings: number
  afterEverything: number
  status: 'comfortable' | 'tight' | 'short'
}

export type ScenarioPlan = {
  scenarios: Record<ScenarioName, Scenario>
  irregular: boolean
  safeNewCommitment: number   // extra fixed monthly payments you could take on safely
  bonusPlan: { bufferTarget: number; bufferGap: number; split: string } | null
  verdict: string
}

export function planScenarios(opts: {
  incomeSources: IncomeSource[]; obligations: Obligation[]; debts: Debt[]
  goalsMonthly: number; budgetsTotal: number; emergencyBuffer: number
  goals?: Goal[]; money: (n: number) => string
}): ScenarioPlan {
  const src = opts.incomeSources.filter(s => s.active)
  const sum = (f: (s: IncomeSource) => number) => Math.round(src.reduce((a, s) => a + f(s) * perMonth(s.frequency), 0))
  const incomes = {
    conservative: sum(s => s.minimum_amount),
    expected: sum(s => s.expected_amount),
    higher: sum(s => s.optimistic_amount ?? s.expected_amount),
  }
  const active = opts.obligations.filter(o => o.active && o.frequency !== 'once')
  const essentialBills = active.filter(o => o.is_essential).reduce((a, o) => a + o.amount * perMonth(o.frequency), 0)
  const optional = Math.round(active.filter(o => !o.is_essential).reduce((a, o) => a + o.amount * perMonth(o.frequency), 0))
  const repayments = opts.debts.filter(d => d.status === 'active' && d.repayment_frequency !== 'one_off').reduce((a, d) => a + d.minimum_payment * perMonth(d.repayment_frequency), 0)
  const fixed = Math.round(essentialBills + repayments)
  const savings = Math.round(opts.goalsMonthly)
  const budgets = Math.round(opts.budgetsTotal)

  const build = (name: ScenarioName): Scenario => {
    const income = incomes[name]
    const afterFixed = income - fixed
    const afterSavings = afterFixed - optional - savings
    const afterEverything = afterSavings - budgets
    const status = afterFixed < 0 ? 'short' : afterSavings < 0 || afterEverything < 0 ? 'tight' : 'comfortable'
    return { name, income, fixed, optional, savings, budgets, afterFixed, afterSavings, afterEverything, status }
  }
  const scenarios = { conservative: build('conservative'), expected: build('expected'), higher: build('higher') }
  const irregular = incomes.conservative < incomes.expected || src.some(s => s.frequency === 'irregular')
  const c = scenarios.conservative
  const safeNewCommitment = Math.max(c.afterSavings, 0)

  // what to do with a better-than-minimum month
  const bufferTarget = Math.round(fixed + optional) // one month of committed costs
  const bufferGap = Math.max(bufferTarget - opts.emergencyBuffer, 0)
  const bonusPlan = irregular ? {
    bufferTarget, bufferGap,
    split: bufferGap > 0
      ? `Put the first ${opts.money(bufferGap)} above ${opts.money(incomes.conservative)} into your emergency buffer until it covers one month of commitments (${opts.money(bufferTarget)}). After that, split anything extra between your goals and spending.`
      : `Your buffer already covers a month of commitments. Split anything above ${opts.money(incomes.conservative)} between your goals and spending, for example half and half.`,
  } : null

  const m = opts.money
  let verdict: string
  if (src.length === 0) verdict = 'Add your income so GreenWise can plan around it.'
  else if (c.status === 'short') verdict = `In a slow month (${m(c.income)}) your fixed commitments of ${m(fixed)} can't all be paid. You'd be ${m(-c.afterFixed)} short. Cut a commitment, or build a buffer to cover the gap.`
  else if (c.afterSavings < 0) verdict = `In a slow month your bills and repayments are covered, but there isn't room for the full ${m(savings + optional)} of savings and optional payments. Pause something in slow months and catch up in good ones.`
  else if (c.afterEverything < 0) verdict = `Commitments and savings fit even in a slow month. Your budgets only fit in an expected month, so in a slow month keep spending under ${m(c.afterSavings)}.`
  else verdict = `Everything fits even in a slow month, with ${m(c.afterEverything)} spare. You could take on up to ${m(safeNewCommitment)} a month in new fixed payments without risk.`

  return { scenarios, irregular, safeNewCommitment, bonusPlan, verdict }
}
