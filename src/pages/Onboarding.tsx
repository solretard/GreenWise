import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { MoneyInput } from '../components/MoneyInput'
import { formatMoney, localToday } from '../lib/format'

// ---------- types ----------
type IncomeType = 'salary' | 'business' | 'freelance' | 'allowance' | 'commission' | 'other'
type Freq = 'weekly' | 'biweekly' | 'monthly' | 'irregular'
type Income = {
  name: string; income_type: IncomeType; frequency: Freq
  expected_amount: number | null; minimum_amount: number | null; optimistic_amount: number | null
  next_pay_date: string
}
type ObFreq = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
type Obligation = { name: string; amount: number | null; frequency: ObFreq; next_due_date: string; is_essential: boolean; category: string }
type Goal = { name: string; target_amount: number | null; starting_amount: number | null; deadline: string; priority: number }
type Debt = {
  creditor: string; balance: number | null; minimum_payment: number | null
  repayment_frequency: 'weekly' | 'biweekly' | 'monthly' | 'one_off'; next_due_date: string; interest_rate: string
}

// ---------- options ----------
const INCOME_TYPES: { value: IncomeType | 'multiple'; label: string; hint: string }[] = [
  { value: 'salary', label: 'Salary', hint: 'A fixed amount from an employer' },
  { value: 'business', label: 'Business', hint: 'Profit from something you run' },
  { value: 'freelance', label: 'Freelance', hint: 'Paid per gig or project' },
  { value: 'allowance', label: 'Allowance', hint: 'From family or a sponsor' },
  { value: 'commission', label: 'Commission', hint: 'Depends on what you sell' },
  { value: 'multiple', label: 'Multiple sources', hint: 'More than one of these' },
  { value: 'other', label: 'Other', hint: 'Something else' },
]
const TYPE_LABEL: Record<IncomeType, string> = { salary: 'Salary', business: 'Business', freelance: 'Freelance', allowance: 'Allowance', commission: 'Commission', other: 'Income' }
const FREQS: { value: Freq; label: string; hint: string }[] = [
  { value: 'weekly', label: 'Weekly', hint: 'Every week' },
  { value: 'biweekly', label: 'Every two weeks', hint: 'Twice a month or so' },
  { value: 'monthly', label: 'Monthly', hint: 'Once a month' },
  { value: 'irregular', label: 'Irregularly', hint: 'It changes, no fixed day' },
]
const OB_FREQS: { value: ObFreq; label: string }[] = [
  { value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'quarterly', label: 'Every 3 months' }, { value: 'yearly', label: 'Yearly' }, { value: 'once', label: 'One time' },
]
const OB_PRESETS: { name: string; category: string; essential: boolean; frequency: ObFreq }[] = [
  { name: 'Rent', category: 'Housing', essential: true, frequency: 'yearly' },
  { name: 'School fees', category: 'Education', essential: true, frequency: 'once' },
  { name: 'Electricity', category: 'Bills', essential: true, frequency: 'monthly' },
  { name: 'Data & airtime', category: 'Bills', essential: true, frequency: 'monthly' },
  { name: 'Transport', category: 'Transport', essential: true, frequency: 'monthly' },
  { name: 'Family support', category: 'Family', essential: true, frequency: 'monthly' },
  { name: 'Subscriptions', category: 'Subscriptions', essential: false, frequency: 'monthly' },
]
const OB_CATEGORIES = ['Housing', 'Education', 'Bills', 'Transport', 'Food', 'Health', 'Family', 'Subscriptions', 'Other']
const FOCUS: { value: string; label: string }[] = [
  { value: 'impulse', label: 'Stop impulse buying' },
  { value: 'overspending', label: 'Control overspending' },
  { value: 'save_more', label: 'Save more' },
  { value: 'debt', label: 'Manage debt' },
  { value: 'irregular_income', label: 'Plan irregular income' },
  { value: 'goal', label: 'Reach a specific goal' },
]

const blankIncome = (t: IncomeType = 'salary', f: Freq = 'monthly'): Income => ({
  name: TYPE_LABEL[t], income_type: t, frequency: f,
  expected_amount: null, minimum_amount: null, optimistic_amount: null, next_pay_date: '',
})

const STEPS = ['income', 'frequency', 'amount', 'now', 'obligations', 'goals', 'debts', 'focus'] as const
type Step = typeof STEPS[number]

// ---------- validation ----------
function incomeProblem(i: Income, multiple: boolean): string {
  const who = multiple ? `“${i.name || 'Unnamed source'}”: ` : ''
  if (multiple && !i.name.trim()) return 'Give each income source a name.'
  if (i.expected_amount == null || i.expected_amount <= 0) return `${who}enter how much you usually get.`
  if (i.minimum_amount == null) return `${who}enter the least you could get.`
  if (i.minimum_amount > i.expected_amount) return `${who}the lowest amount can’t be more than the usual amount.`
  if (i.optimistic_amount != null && i.optimistic_amount < i.expected_amount) return `${who}a great month should be at least your usual amount.`
  return ''
}

export default function Onboarding() {
  const { profile, refreshProfile } = useAuth()
  const nav = useNavigate()
  const currency0 = profile?.currency ?? 'NGN'

  const [step, setStep] = useState<Step>('income')
  const [multiple, setMultiple] = useState(false)
  const [incomes, setIncomes] = useState<Income[]>([blankIncome()])
  const [currency, setCurrency] = useState(currency0)
  const [balance, setBalance] = useState<number | null>(null)
  const [buffer, setBuffer] = useState<number | null>(null)
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [hasDebt, setHasDebt] = useState<boolean | null>(null)
  const [debts, setDebts] = useState<Debt[]>([])
  const [focus, setFocus] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const visibleSteps = STEPS.filter(s => !(multiple && s === 'frequency'))
  const index = visibleSteps.indexOf(step)
  const first = incomes[0]

  const updateIncome = (i: number, patch: Partial<Income>) =>
    setIncomes(list => list.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  // ----- per-step checks -----
  function problem(): string {
    switch (step) {
      case 'amount':
        for (const i of incomes) { const p = incomeProblem(i, multiple); if (p) return p }
        return ''
      case 'now':
        if (balance == null) return 'Enter how much money you have right now (0 is fine).'
        return ''
      case 'obligations':
        for (const o of obligations) {
          if (!o.name.trim()) return 'Give each payment a name, or remove it.'
          if (!o.amount || o.amount <= 0) return `Enter an amount for “${o.name}”.`
          if (!o.next_due_date) return `When is “${o.name}” next due?`
        }
        return ''
      case 'goals':
        for (const g of goals) {
          if (!g.name.trim()) return 'Give each goal a name, or remove it.'
          if (!g.target_amount || g.target_amount <= 0) return `Enter a target for “${g.name}”.`
          if ((g.starting_amount ?? 0) > g.target_amount) return `You’ve already saved more than the target for “${g.name}”.`
        }
        return ''
      case 'debts':
        if (hasDebt == null) return 'Choose yes or no.'
        if (hasDebt) {
          if (debts.length === 0) return 'Add the debt, or choose “No”.'
          for (const d of debts) {
            if (!d.creditor.trim()) return 'Who do you owe? Add a name for each debt.'
            if (!d.balance || d.balance <= 0) return `How much do you still owe ${d.creditor}?`
            const rate = d.interest_rate.trim() === '' ? 0 : Number(d.interest_rate)
            if (Number.isNaN(rate) || rate < 0 || rate > 1000) return `Interest rate for ${d.creditor} should be a number like 5 or 24.`
          }
        }
        return ''
      default:
        return ''
    }
  }

  function next() {
    const p = problem()
    if (p) return setError(p)
    setError('')
    if (index < visibleSteps.length - 1) setStep(visibleSteps[index + 1])
    else finish()
  }

  function back() {
    setError('')
    if (index > 0) setStep(visibleSteps[index - 1])
  }

  async function finish() {
    setSaving(true); setError('')
    const payload = {
      today: localToday(),
      currency,
      starting_balance: balance ?? 0,
      emergency_buffer: buffer ?? 0,
      focus_areas: focus,
      income_sources: incomes.map(i => ({
        ...i,
        name: i.name.trim() || TYPE_LABEL[i.income_type],
        next_pay_date: i.frequency === 'irregular' ? '' : i.next_pay_date,
      })),
      obligations: obligations.map(o => ({ ...o, name: o.name.trim() })),
      goals: goals.map(g => ({ ...g, name: g.name.trim(), starting_amount: g.starting_amount ?? 0 })),
      debts: hasDebt ? debts.map(d => ({ ...d, creditor: d.creditor.trim(), minimum_payment: d.minimum_payment ?? 0 })) : [],
    }
    const { error } = await supabase.rpc('complete_onboarding', { payload })
    if (error) {
      setSaving(false)
      return setError(friendlyError(error.message))
    }
    await refreshProfile()
    nav('/', { replace: true })
  }

  // ---------- step screens ----------
  let title = ''
  let subtitle = ''
  let body: ReactNode = null

  if (step === 'income') {
    title = 'What’s your main income source?'
    subtitle = 'This shapes how GreenWise plans around your money.'
    const selected = multiple ? 'multiple' : first.income_type
    body = (
      <div className="choice-list">
        {INCOME_TYPES.map(t => (
          <button key={t.value} type="button" className={`choice ${selected === t.value ? 'selected' : ''}`}
            onClick={() => {
              if (t.value === 'multiple') {
                setMultiple(true)
                if (incomes.length < 2) setIncomes([incomes[0], blankIncome('freelance', 'irregular')])
              } else {
                setMultiple(false)
                setIncomes([{ ...blankIncome(t.value, first.frequency), expected_amount: first.expected_amount, minimum_amount: first.minimum_amount, optimistic_amount: first.optimistic_amount, next_pay_date: first.next_pay_date }])
              }
            }}>
            <strong>{t.label}</strong><span className="muted small">{t.hint}</span>
          </button>
        ))}
      </div>
    )
  }

  if (step === 'frequency') {
    title = 'How often do you get paid?'
    body = (
      <div className="choice-list">
        {FREQS.map(f => (
          <button key={f.value} type="button" className={`choice ${first.frequency === f.value ? 'selected' : ''}`}
            onClick={() => updateIncome(0, { frequency: f.value })}>
            <strong>{f.label}</strong><span className="muted small">{f.hint}</span>
          </button>
        ))}
      </div>
    )
  }

  if (step === 'amount') {
    title = multiple ? 'Tell us about each income source' : 'How much do you usually get?'
    subtitle = 'GreenWise plans your must-pay bills around the lowest amount, so a bad month doesn’t catch you out.'
    body = (
      <div className="stack">
        {incomes.map((inc, i) => (
          <IncomeEditor key={i} inc={inc} currency={currency} multiple={multiple}
            onChange={patch => updateIncome(i, patch)}
            onRemove={multiple && incomes.length > 1 ? () => setIncomes(l => l.filter((_, k) => k !== i)) : undefined} />
        ))}
        {multiple && (
          <button type="button" className="btn ghost" onClick={() => setIncomes(l => [...l, blankIncome('other', 'irregular')])}>
            + Add another source
          </button>
        )}
      </div>
    )
  }

  if (step === 'now') {
    title = 'Where do you stand today?'
    subtitle = 'Add up what you have across your bank accounts, wallets and cash.'
    body = (
      <div className="form">
        <label>Currency
          <select value={currency} onChange={e => setCurrency(e.target.value)}>
            {['NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'EUR'].map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Money you have right now
          <MoneyInput value={balance} onChange={setBalance} currency={currency} />
        </label>
        <label>Emergency buffer <span className="muted small">(optional)</span>
          <MoneyInput value={buffer} onChange={setBuffer} currency={currency} />
          <span className="muted small hint">An amount GreenWise should never count as spendable. Leave empty if you don’t have one yet.</span>
        </label>
      </div>
    )
  }

  if (step === 'obligations') {
    title = 'What do you have to pay regularly?'
    subtitle = 'Rent, school fees, bills, family support. These come out before anything else. You can skip this and add them later.'
    const used = new Set(obligations.map(o => o.name))
    body = (
      <div className="stack">
        <div className="chips">
          {OB_PRESETS.filter(p => !used.has(p.name)).map(p => (
            <button key={p.name} type="button" className="chip"
              onClick={() => setObligations(l => [...l, { name: p.name, amount: null, frequency: p.frequency, next_due_date: '', is_essential: p.essential, category: p.category }])}>
              + {p.name}
            </button>
          ))}
          <button type="button" className="chip"
            onClick={() => setObligations(l => [...l, { name: '', amount: null, frequency: 'monthly', next_due_date: '', is_essential: true, category: 'Other' }])}>
            + Something else
          </button>
        </div>
        {obligations.map((o, i) => (
          <div className="item-card" key={i}>
            <div className="item-head">
              <input aria-label="Name" placeholder="Name" value={o.name} maxLength={80}
                onChange={e => setObligations(l => l.map((x, k) => k === i ? { ...x, name: e.target.value } : x))} />
              <button type="button" className="icon-btn" aria-label={`Remove ${o.name}`} onClick={() => setObligations(l => l.filter((_, k) => k !== i))}>×</button>
            </div>
            <div className="grid2">
              <label>Amount<MoneyInput value={o.amount} currency={currency} onChange={v => setObligations(l => l.map((x, k) => k === i ? { ...x, amount: v } : x))} /></label>
              <label>How often
                <select value={o.frequency} onChange={e => setObligations(l => l.map((x, k) => k === i ? { ...x, frequency: e.target.value as ObFreq } : x))}>
                  {OB_FREQS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
              <label>Next due<input type="date" value={o.next_due_date} onChange={e => setObligations(l => l.map((x, k) => k === i ? { ...x, next_due_date: e.target.value } : x))} /></label>
              <label>Category
                <select value={o.category} onChange={e => setObligations(l => l.map((x, k) => k === i ? { ...x, category: e.target.value } : x))}>
                  {OB_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={o.is_essential} onChange={e => setObligations(l => l.map((x, k) => k === i ? { ...x, is_essential: e.target.checked } : x))} />
              Must be paid (essential)
            </label>
          </div>
        ))}
      </div>
    )
  }

  if (step === 'goals') {
    title = 'What are you saving towards?'
    subtitle = 'An emergency fund, a laptop, school fees. GreenWise will show how each spending decision moves these closer or further away.'
    body = (
      <div className="stack">
        {goals.map((g, i) => (
          <div className="item-card" key={i}>
            <div className="item-head">
              <input aria-label="Goal name" placeholder="e.g. Emergency fund" value={g.name} maxLength={80}
                onChange={e => setGoals(l => l.map((x, k) => k === i ? { ...x, name: e.target.value } : x))} />
              <button type="button" className="icon-btn" aria-label={`Remove ${g.name}`} onClick={() => setGoals(l => l.filter((_, k) => k !== i))}>×</button>
            </div>
            <div className="grid2">
              <label>Target<MoneyInput value={g.target_amount} currency={currency} onChange={v => setGoals(l => l.map((x, k) => k === i ? { ...x, target_amount: v } : x))} /></label>
              <label>Saved so far<MoneyInput value={g.starting_amount} currency={currency} onChange={v => setGoals(l => l.map((x, k) => k === i ? { ...x, starting_amount: v } : x))} /></label>
              <label>Deadline <span className="muted small">(optional)</span><input type="date" value={g.deadline} onChange={e => setGoals(l => l.map((x, k) => k === i ? { ...x, deadline: e.target.value } : x))} /></label>
              <label>Priority
                <select value={g.priority} onChange={e => setGoals(l => l.map((x, k) => k === i ? { ...x, priority: Number(e.target.value) } : x))}>
                  <option value={1}>High</option><option value={3}>Medium</option><option value={5}>Low</option>
                </select>
              </label>
            </div>
          </div>
        ))}
        <button type="button" className="btn ghost"
          onClick={() => setGoals(l => [...l, { name: '', target_amount: null, starting_amount: null, deadline: '', priority: l.length === 0 ? 1 : 3 }])}>
          + Add a goal
        </button>
      </div>
    )
  }

  if (step === 'debts') {
    title = 'Do you owe anyone right now?'
    subtitle = 'Loans, credit, money borrowed from family or friends. It stays private to you.'
    body = (
      <div className="stack">
        <div className="choice-row">
          <button type="button" className={`choice ${hasDebt === true ? 'selected' : ''}`}
            onClick={() => { setHasDebt(true); if (debts.length === 0) setDebts([{ creditor: '', balance: null, minimum_payment: null, repayment_frequency: 'monthly', next_due_date: '', interest_rate: '' }]) }}>
            <strong>Yes</strong>
          </button>
          <button type="button" className={`choice ${hasDebt === false ? 'selected' : ''}`} onClick={() => setHasDebt(false)}>
            <strong>No</strong>
          </button>
        </div>
        {hasDebt && debts.map((d, i) => (
          <div className="item-card" key={i}>
            <div className="item-head">
              <input aria-label="Who you owe" placeholder="Who do you owe?" value={d.creditor} maxLength={80}
                onChange={e => setDebts(l => l.map((x, k) => k === i ? { ...x, creditor: e.target.value } : x))} />
              <button type="button" className="icon-btn" aria-label={`Remove ${d.creditor}`} onClick={() => setDebts(l => l.filter((_, k) => k !== i))}>×</button>
            </div>
            <div className="grid2">
              <label>Still owed<MoneyInput value={d.balance} currency={currency} onChange={v => setDebts(l => l.map((x, k) => k === i ? { ...x, balance: v } : x))} /></label>
              <label>Repayment amount<MoneyInput value={d.minimum_payment} currency={currency} onChange={v => setDebts(l => l.map((x, k) => k === i ? { ...x, minimum_payment: v } : x))} /></label>
              <label>How often
                <select value={d.repayment_frequency} onChange={e => setDebts(l => l.map((x, k) => k === i ? { ...x, repayment_frequency: e.target.value as Debt['repayment_frequency'] } : x))}>
                  <option value="monthly">Monthly</option><option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option><option value="one_off">All at once</option>
                </select>
              </label>
              <label>Next payment due<input type="date" value={d.next_due_date} onChange={e => setDebts(l => l.map((x, k) => k === i ? { ...x, next_due_date: e.target.value } : x))} /></label>
              <label>Interest per year <span className="muted small">(%, optional)</span>
                <input inputMode="decimal" placeholder="0" value={d.interest_rate} onChange={e => setDebts(l => l.map((x, k) => k === i ? { ...x, interest_rate: e.target.value.replace(/[^\d.]/g, '') } : x))} />
              </label>
            </div>
          </div>
        ))}
        {hasDebt && (
          <button type="button" className="btn ghost"
            onClick={() => setDebts(l => [...l, { creditor: '', balance: null, minimum_payment: null, repayment_frequency: 'monthly', next_due_date: '', interest_rate: '' }])}>
            + Add another debt
          </button>
        )}
      </div>
    )
  }

  if (step === 'focus') {
    title = 'What do you want GreenWise to help with?'
    subtitle = 'Pick as many as you like. Your alerts and insights will lean towards these.'
    body = (
      <div className="choice-list">
        {FOCUS.map(f => {
          const on = focus.includes(f.value)
          return (
            <button key={f.value} type="button" className={`choice ${on ? 'selected' : ''}`} aria-pressed={on}
              onClick={() => setFocus(l => on ? l.filter(x => x !== f.value) : [...l, f.value])}>
              <strong>{f.label}</strong>
            </button>
          )
        })}
      </div>
    )
  }

  const isLast = index === visibleSteps.length - 1
  const skippable = step === 'obligations' || step === 'goals'
  const listEmpty = (step === 'obligations' && obligations.length === 0) || (step === 'goals' && goals.length === 0)

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="progress" aria-label={`Step ${index + 1} of ${visibleSteps.length}`}>
          <div className="progress-bar" style={{ width: `${((index + 1) / visibleSteps.length) * 100}%` }} />
        </div>
        <p className="muted small step-count">Step {index + 1} of {visibleSteps.length}</p>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {body}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="nav-row">
          {index > 0 ? <button type="button" className="btn" onClick={back} disabled={saving}>Back</button> : <span />}
          <button type="button" className="btn primary" onClick={next} disabled={saving}>
            {saving ? 'Setting up…' : isLast ? 'Finish setup' : skippable && listEmpty ? 'Skip for now' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- one income source ----------
function IncomeEditor({ inc, currency, multiple, onChange, onRemove }: {
  inc: Income; currency: string; multiple: boolean
  onChange: (patch: Partial<Income>) => void; onRemove?: () => void
}) {
  const irregular = inc.frequency === 'irregular'
  const per = irregular ? 'month' : inc.frequency === 'weekly' ? 'week' : inc.frequency === 'biweekly' ? 'payment' : 'month'
  const fixed = inc.income_type === 'salary' && !irregular

  return (
    <div className={multiple ? 'item-card' : 'form'}>
      {multiple && (
        <>
          <div className="item-head">
            <input aria-label="Source name" placeholder="e.g. Web dev gigs" value={inc.name} maxLength={80} onChange={e => onChange({ name: e.target.value })} />
            {onRemove && <button type="button" className="icon-btn" aria-label="Remove source" onClick={onRemove}>×</button>}
          </div>
          <div className="grid2">
            <label>Type
              <select value={inc.income_type} onChange={e => onChange({ income_type: e.target.value as IncomeType })}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{v === 'other' ? 'Other' : l}</option>)}
              </select>
            </label>
            <label>How often
              <select value={inc.frequency} onChange={e => onChange({ frequency: e.target.value as Freq })}>
                {FREQS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
          </div>
        </>
      )}
      <div className={multiple ? 'grid2' : 'form'}>
        <label>{irregular ? 'In a normal month' : `Usual amount per ${per}`}
          <MoneyInput value={inc.expected_amount} currency={currency}
            onChange={v => onChange(fixed && (inc.minimum_amount == null || inc.minimum_amount === inc.expected_amount)
              ? { expected_amount: v, minimum_amount: v } : { expected_amount: v })} />
        </label>
        <label>{irregular ? 'In a bad month' : `The least you could get per ${per}`}
          <MoneyInput value={inc.minimum_amount} currency={currency} onChange={v => onChange({ minimum_amount: v })} />
          {fixed && !multiple && <span className="muted small hint">For a steady salary this is usually the same as above.</span>}
        </label>
        <label>{irregular ? 'In a great month' : `A good ${per}`} <span className="muted small">(optional)</span>
          <MoneyInput value={inc.optimistic_amount} currency={currency} onChange={v => onChange({ optimistic_amount: v })} />
        </label>
        {!irregular && (
          <label>Next payday <span className="muted small">(optional)</span>
            <input type="date" value={inc.next_pay_date} onChange={e => onChange({ next_pay_date: e.target.value })} />
          </label>
        )}
      </div>
      {!multiple && inc.expected_amount != null && inc.minimum_amount != null && inc.minimum_amount < inc.expected_amount && (
        <p className="note">Your bills will be planned around {formatMoney(inc.minimum_amount, currency)}, not {formatMoney(inc.expected_amount, currency)}. Anything above that is a bonus.</p>
      )}
    </div>
  )
}
