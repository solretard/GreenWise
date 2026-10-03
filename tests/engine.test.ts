// Engine checks against the brief's test numbers. Run: node --experimental-strip-types tests/engine.test.ts (after adding .ts to imports), or ask Claude.
import { computeSnapshot, type EngineInput } from '../src/engine/engine'
import { decide } from '../src/engine/decision'
import { formatMoney } from '../src/lib/format'
import { projectPayoff, simulateStrategy, repaymentBurden } from '../src/engine/debts'
import { rankPriorities } from '../src/engine/priorities'
import { computeInsights } from '../src/engine/insights'
import { planScenarios } from '../src/engine/scenarios'
import type { Transaction } from '../src/lib/types'

let id = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${++id}`, type: 'expense', amount: 0, category_id: null, description: null, occurred_on: '2026-10-03',
  necessity: null, is_planned: null, payment_method: null, source: 'manual', goal_id: null, debt_id: null,
  obligation_id: null, income_source_id: null, created_at: '', ...p,
})
let failures = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const base: EngineInput = {
  today: '2026-10-03', currency: 'NGN',
  profile: { starting_balance: 250000, emergency_buffer: 20000, balance_as_of: '2026-10-01', focus_areas: ['save_more'],
    alert_settings: { budget_warn_pct: 80, unplanned_per_week: 5, large_purchase_pct: 20 } },
  transactions: [],
  incomeSources: [{ id: 'i1', name: 'Salary', income_type: 'salary', frequency: 'monthly', expected_amount: 250000, minimum_amount: 250000, optimistic_amount: null, next_pay_date: '2026-10-28', active: true }],
  obligations: [
    { id: 'rent', name: 'Rent', amount: 50000, category_id: 'housing', frequency: 'monthly', next_due_date: '2026-10-05', is_essential: true, active: true },
    { id: 'bills', name: 'Bills', amount: 20000, category_id: 'bills', frequency: 'monthly', next_due_date: '2026-10-15', is_essential: true, active: true },
  ],
  debts: [{ id: 'd1', creditor: 'Uncle', original_amount: 60000, opening_balance: 60000, interest_rate: 0, minimum_payment: 20000, repayment_frequency: 'monthly', next_due_date: '2026-10-10', start_date: '2026-10-01', custom_priority: null, status: 'active' }],
  goals: [{ id: 'g1', name: 'Savings', target_amount: 50000, starting_amount: 0, deadline: '2026-10-31', priority: 1, status: 'active', created_at: '2026-10-01' }],
  budgets: [{ id: 'b1', category_id: 'food', monthly_limit: 45000 }, { id: 'b2', category_id: 'ent', monthly_limit: 20000 }],
  categories: [{ id: 'food', name: 'Food', kind: 'expense', is_essential: true, archived: false }, { id: 'ent', name: 'Entertainment', kind: 'expense', is_essential: false, archived: false }],
}

// 1. fresh start: 250k − rent 50k − bills 20k − debt 20k − savings 50k − buffer 20k = 90k
let s = computeSnapshot(base)
eq('available', s.available, 250000)
eq('window ends on payday', [s.windowEnd, s.windowDays, s.hasPayday], ['2026-10-28', 25, true])
eq('reserved', s.reserved, { overdue: 0, obligations: 70000, debts: 20000, savings: 50000, buffer: 20000 })
eq('safe to spend', s.safeToSpend, 90000)
eq('per day', s.perDay, 3600)

// 2. pay rent (linked), spend 42k on food, repay uncle 20k, save 10k
s = computeSnapshot({ ...base, transactions: [
  tx({ amount: 50000, obligation_id: 'rent', category_id: 'housing', occurred_on: '2026-10-02' }),
  tx({ amount: 42000, category_id: 'food', necessity: 'need', is_planned: true }),
  tx({ type: 'debt_repayment', amount: 20000, debt_id: 'd1' }),
  tx({ type: 'savings', amount: 10000, goal_id: 'g1' }),
] })
eq('available after spending', s.available, 128000)
eq('rent no longer reserved, debt paid', [s.reserved.obligations, s.reserved.debts], [20000, 0])
eq('savings reserve drops by what was saved', s.reserved.savings, 40000)
eq('safe to spend after', s.safeToSpend, 48000)
eq('debt balance', s.debts.totalRemaining, 40000)
eq('goal progress', s.goals[0].saved, 10000)
eq('food alert fires at 93%', s.alerts.some(a => a.title === 'Food spending alert' && a.body.includes('93%') && a.body.includes('₦3,000')), true)
eq('October repayment no longer due', s.upcoming.some(u => u.kind === 'debt'), false)

// 3. a payment from before setup doesn't move balances
s = computeSnapshot({ ...base, transactions: [tx({ amount: 99999, occurred_on: '2026-09-20' })] })
eq('pre-setup ignored', s.available, 250000)

// 4. transfer is neutral, income adds
s = computeSnapshot({ ...base, transactions: [tx({ type: 'transfer', amount: 5000 }), tx({ type: 'income', amount: 30000 })] })
eq('transfer neutral', s.available, 280000)

// 5. overdue: today after rent date, nothing paid
s = computeSnapshot({ ...base, today: '2026-10-07' })
eq('rent overdue', [s.reserved.overdue, s.alerts.some(a => a.title.startsWith('Rent was due'))], [50000, true])

// 6. shortfall
s = computeSnapshot({ ...base, profile: { ...base.profile, starting_balance: 100000 } })
eq('shortfall', [s.safeToSpend, s.shortfall, s.alerts[0].severity], [0, 60000, 'high'])

// 7. unplanned purchases (focus impulse lowers threshold to 3)
const unplanned = [1, 2, 3].map(() => tx({ amount: 2000, category_id: 'ent', is_planned: false, necessity: 'want' }))
eq('no impulse alert at 3 without focus', computeSnapshot({ ...base, transactions: unplanned }).alerts.some(a => a.title === 'Spending pattern detected'), false)
eq('impulse alert at 3 with focus', computeSnapshot({ ...base, transactions: unplanned, profile: { ...base.profile, focus_areas: ['impulse'] } }).alerts.some(a => a.title === 'Spending pattern detected'), true)

// 8. irregular income: no payday, 30-day window, plans on minimum
s = computeSnapshot({ ...base, incomeSources: [{ ...base.incomeSources[0], frequency: 'irregular', expected_amount: 250000, minimum_amount: 150000, optimistic_amount: 350000, next_pay_date: null }] })
eq('irregular window', [s.hasPayday, s.windowDays], [false, 30])
eq('income scenarios', [s.income.minimumMonthly, s.income.expectedMonthly, s.income.optimisticMonthly, s.income.irregular], [150000, 250000, 350000, true])

// 9. dismissed alerts hide
s = computeSnapshot({ ...base, today: '2026-10-07' })
const k = s.alerts[0].key
eq('dismiss hides', computeSnapshot({ ...base, today: '2026-10-07', dismissed: new Set([k]) }).alerts.some(a => a.key === k), false)

// 10. month-end date math
s = computeSnapshot({ ...base, today: '2027-01-31', obligations: [{ ...base.obligations[0], next_due_date: '2027-01-31' }], transactions: [tx({ amount: 50000, obligation_id: 'rent', occurred_on: '2027-01-31' })], profile: { ...base.profile, balance_as_of: '2027-01-01' } })
eq('31 Jan monthly → 28 Feb', s.upcoming.find(u => u.refId === 'rent')?.due, '2027-02-28')


// ---------- commitments ----------
const commit = (p: Record<string, unknown>) => ({ id: 'c1', title: 'test', category_id: null, goal_id: null, amount: null, start_date: '2026-10-01', end_date: '2026-10-31', status: 'active', created_at: '', ...p }) as never
s = computeSnapshot({ ...base, today: '2026-10-10', commitments: [commit({ kind: 'spend_limit', category_id: 'ent', amount: 30000, title: 'Entertainment under 30k' })],
  transactions: [tx({ amount: 12000, category_id: 'ent', occurred_on: '2026-10-05' }), tx({ amount: 3000, category_id: 'ent', occurred_on: '2026-10-09' })] })
eq('spend limit at risk (15k in 10 days → 46.5k pace)', [s.commitments[0].state, s.commitments[0].projected], ['at_risk', 46500])
eq('at-risk alert says by how much', s.alerts.some(a => a.body.includes('exceed your entertainment commitment by ₦16,500')), true)
s = computeSnapshot({ ...base, today: '2026-10-10', commitments: [commit({ kind: 'no_unplanned', end_date: '2026-10-12' })], transactions: [tx({ amount: 2000, is_planned: false, occurred_on: '2026-10-09' })] })
eq('no-unplanned broken', s.commitments[0].state, 'broken')
s = computeSnapshot({ ...base, today: '2026-11-02', commitments: [commit({ kind: 'save_target', amount: 50000 })], transactions: [tx({ type: 'savings', amount: 50000, occurred_on: '2026-10-20' })] })
eq('save target kept after end', [s.commitments[0].state, s.commitments[0].finished], ['kept', true])

// ---------- decisions ----------
const money = (n: number) => formatMoney(n, 'NGN')
const day = (iso: string) => iso
const fresh = computeSnapshot(base) // safe to spend 90,000
let d = decide({ item: 'Headphones', price: 35000, necessity: 'want', neededBy: null, categoryId: 'ent', categoryName: 'Entertainment' }, fresh, [], [], money, day)
eq('35k want: affordability high (39% of safe), priority low, not a yes', [d.canAfford, d.affordability, d.priority, d.verdict !== 'go_ahead'], [true, 'high', 'low', true])
eq('35k want: busts the 20k entertainment budget', d.reasons.some(r => r.includes('₦15,000 over')), true)
eq('35k want: goal delay in days', d.goalDelayDays, 21)
d = decide({ item: 'Textbook', price: 8000, necessity: 'need', neededBy: '2026-10-05', categoryId: null, categoryName: null }, fresh, [], [], money, day)
eq('cheap urgent need: go ahead', [d.affordability, d.priority, d.verdict], ['high', 'high', 'go_ahead'])
d = decide({ item: 'Phone', price: 120000, necessity: 'want', neededBy: null, categoryId: null, categoryName: null }, fresh, [], [], money, day)
eq('120k want: low affordability, wait/skip', [d.canAfford, d.affordability, ['wait', 'skip'].includes(d.verdict)], [false, 'low', true])
d = decide({ item: 'Car', price: 300000, necessity: 'want', neededBy: null, categoryId: null, categoryName: null }, fresh, [], [], money, day)
eq('more than you have', [d.affordability, d.headline.startsWith("You don't have enough")], ['none', true])

// ---------- debts ----------
const debt = (p: Record<string, unknown>) => ({ id: String(p.creditor), creditor: 'X', original_amount: 0, opening_balance: 0, interest_rate: 0, minimum_payment: 0, repayment_frequency: 'monthly', next_due_date: null, start_date: null, custom_priority: null, status: 'active', ...p }) as never
let p = projectPayoff(debt({ creditor: 'Uncle', minimum_payment: 20000 }), 60000, '2026-10-03')
eq('60k at 20k/month, no interest: 3 months', [p.months, p.date, p.totalInterest], [3, '2027-01-03', 0])
p = projectPayoff(debt({ creditor: 'Loan', minimum_payment: 1000, interest_rate: 24 }), 100000, '2026-10-03')
eq('payment below interest never clears', [p.months, !!p.neverReason], [null, true])
p = projectPayoff(debt({ creditor: 'Loan', minimum_payment: 10000, interest_rate: 24 }), 100000, '2026-10-03')
eq('100k at 24%/yr paying 10k: 12 months', p.months, 12)
const states = [
  { debt: debt({ creditor: 'Small', minimum_payment: 5000, interest_rate: 0 }), remaining: 20000 },
  { debt: debt({ creditor: 'Costly', minimum_payment: 10000, interest_rate: 36 }), remaining: 150000 },
]
const sm = simulateStrategy(states, 'smallest', 10000, '2026-10-03'), hi = simulateStrategy(states, 'interest', 10000, '2026-10-03')
eq('smallest-first clears a debt sooner', sm.firstClearedMonth! < hi.firstClearedMonth!, true)
eq('highest-interest costs less interest', hi.totalInterest < sm.totalInterest, true)
eq('both finish', [sm.months != null, hi.months != null], [true, true])
eq('burden 20k of 250k is manageable', repaymentBurden(20000, 250000), { pct: 0.08, level: 'manageable' })

// ---------- scale of preference ----------
const pr = (name: string, p: Record<string, unknown>) => ({ id: name, name, amount: 0, due_date: null, necessity: 'want', urgency: 3, delay_consequence: 3, manual_rank: null, status: 'open', created_at: '2026-10-01', ...p }) as never
const list = [
  pr('Laptop', { amount: 400000, necessity: 'want', urgency: 2, delay_consequence: 2 }),
  pr('Rent', { amount: 50000, necessity: 'need', urgency: 5, delay_consequence: 5, due_date: '2026-10-05' }),
  pr('Clothes', { amount: 15000, necessity: 'want', urgency: 1, delay_consequence: 1 }),
  pr('School fees', { amount: 40000, necessity: 'need', urgency: 4, delay_consequence: 5, due_date: '2026-10-08' }),
  pr('Food', { amount: 30000, necessity: 'need', urgency: 4, delay_consequence: 4 }),
  pr('Entertainment', { amount: 10000, necessity: 'want', urgency: 1, delay_consequence: 1 }),
]
let ranked = rankPriorities(list, 100000, '2026-10-03')
eq('needs first, wants last, not by price', ranked.map(r => r.item.name), ['Rent', 'School fees', 'Food', 'Laptop', 'Clothes', 'Entertainment'])
eq('100k covers rent + fees, part of food', ranked.map(r => r.funding), ['covered', 'covered', 'partly', 'not_yet', 'not_yet', 'not_yet'])
eq('food gets the last 10k', ranked[2].fundedAmount, 10000)
ranked = rankPriorities(list.map(x => (x as { name: string }).name === 'Clothes' ? { ...(x as object), manual_rank: 1 } as never : x), 100000, '2026-10-03')
eq('manual override pins to position 1', [ranked[0].item.name, ranked[0].suggestedRank, ranked[1].item.name], ['Clothes', 5, 'Rent'])

// ---------- insights ----------
{
  const T = '2026-10-20'
  const prof = { ...base.profile, balance_as_of: '2026-09-01', starting_balance: 400000 }
  const txs: Transaction[] = [
    // september: normal food, one netflix
    tx({ amount: 30000, category_id: 'food', occurred_on: '2026-09-10', necessity: 'need', is_planned: true }),
    tx({ amount: 4400, description: 'Netflix', category_id: 'ent', occurred_on: '2026-09-12', is_planned: true }),
    // october: food climbing, netflix again, lots of small unplanned buys
    tx({ amount: 45000, category_id: 'food', occurred_on: '2026-10-08', necessity: 'need', is_planned: true }),
    tx({ amount: 4400, description: 'Netflix', category_id: 'ent', occurred_on: '2026-10-12', is_planned: true }),
    ...Array.from({ length: 10 }, (_, k) => tx({ amount: 1500, description: 'snacks', category_id: 'ent', occurred_on: `2026-10-${String(5 + k).padStart(2, '0')}`, is_planned: false, necessity: 'want' })),
  ]
  const snap = computeSnapshot({ ...base, today: T, profile: prof, transactions: txs })
  const { insights, enoughData } = computeInsights({ snapshot: snap, transactions: txs, categories: base.categories, obligations: base.obligations, debts: base.debts, focus: ['impulse'], largePurchasePct: 20, money })
  const kinds = insights.map(x => x.kind)
  eq('enough data', enoughData, true)
  eq('small purchases spotted', kinds.includes('small_purchases'), true)
  eq('netflix flagged as recurring', insights.some(x => x.kind === 'recurring' && x.title.includes('Netflix')), true)
  eq('food rising vs september', insights.some(x => x.kind === 'rising_category' && x.title.startsWith('Food')), true)
  eq('unplanned share', kinds.includes('unplanned'), true)
  eq('impulse focus puts an impulse insight first', ['small_purchases', 'unplanned'].includes(insights[0].kind), true)
  const g = insights.find(x => x.kind === 'vs_goals' || x.kind === 'vs_income')
  eq('goal/income projection present', !!g, true)
  eq('too little data → nothing', computeInsights({ snapshot: snap, transactions: txs.slice(0, 3), categories: base.categories, obligations: [], debts: [], focus: [], largePurchasePct: 20, money }).enoughData, false)
}

// ---------- irregular income scenarios (brief section 13) ----------
{
  const inc = [{ ...base.incomeSources[0], frequency: 'irregular' as const, expected_amount: 250000, minimum_amount: 150000, optimistic_amount: 350000, next_pay_date: null }]
  const plan = planScenarios({ incomeSources: inc, obligations: base.obligations, debts: base.debts, goalsMonthly: 50000, budgetsTotal: 65000, emergencyBuffer: 20000, money })
  eq('three scenarios', [plan.scenarios.conservative.income, plan.scenarios.expected.income, plan.scenarios.higher.income], [150000, 250000, 350000])
  eq('fixed = bills 70k + debt 20k', plan.scenarios.conservative.fixed, 90000)
  eq('slow month: fixed covered, savings fit, budgets do not', [plan.scenarios.conservative.afterFixed, plan.scenarios.conservative.afterSavings, plan.scenarios.conservative.status], [60000, 10000, 'tight'])
  eq('safe new commitment = 10k', plan.safeNewCommitment, 10000)
  eq('bonus plan fills buffer to one month first', [plan.bonusPlan?.bufferTarget, plan.bonusPlan?.bufferGap], [90000, 70000])
  const short = planScenarios({ incomeSources: [{ ...inc[0], minimum_amount: 60000 }], obligations: base.obligations, debts: base.debts, goalsMonthly: 0, budgetsTotal: 0, emergencyBuffer: 0, money })
  eq('slow month short', [short.scenarios.conservative.status, short.verdict.includes('₦30,000 short')], ['short', true])
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
if (failures) process.exit(1)
