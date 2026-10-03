import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { useTransactionSheet } from '../components/AppShell'
import { MoneyInput } from '../components/MoneyInput'
import { Priorities } from '../components/Priorities'
import { IncomePlan } from '../components/IncomePlan'
import { formatMoney, localToday } from '../lib/format'
import { friendlyError } from '../lib/supabase'
import { perMonth } from '../engine/dates'
import {
  deleteBudget, deleteGoal, deleteObligation, insertGoal, insertObligation, saveBudget, updateGoal, updateObligation,
  type GoalInput, type ObligationInput,
} from '../lib/data'
import type { Goal, Obligation } from '../lib/types'
import { PageTitle } from '../components/Icon'

const TABS = [
  { id: 'budgets', label: 'Budgets' },
  { id: 'income', label: 'Income' },
  { id: 'goals', label: 'Goals' },
  { id: 'bills', label: 'Regular payments' },
  { id: 'priorities', label: 'Priorities' },
] as const
type Tab = typeof TABS[number]['id']

const FREQ_LABEL: Record<Obligation['frequency'], string> = {
  once: 'One time', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly',
}
const PRIORITY_LABEL: Record<number, string> = { 1: 'High', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Low' }

function fmtDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Plan() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some(t => t.id === params.get('tab')) ? params.get('tab') : 'budgets') as Tab

  return (
    <section>
      <PageTitle icon="plan">Plan</PageTitle>
      <PlanSummary />
      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''}
            onClick={() => setParams(t.id === 'budgets' ? {} : { tab: t.id }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'budgets' && <Budgets />}
      {tab === 'goals' && <div className="page-goals"><Goals /></div>}
      {tab === 'bills' && <Bills />}
      {tab === 'income' && <IncomePlan />}
      {tab === 'priorities' && <Priorities />}
    </section>
  )
}

// ---------- how the monthly plan compares to income ----------
function PlanSummary() {
  const { snapshot: s, obligations, debts, budgets, currency } = useData()
  if (!s) return null
  const money = (n: number) => formatMoney(n, currency)
  const bills = obligations.filter(o => o.active && o.frequency !== 'once').reduce((a, o) => a + o.amount * perMonth(o.frequency), 0)
  const repayments = debts.filter(d => d.status === 'active').reduce((a, d) => a + d.minimum_payment * perMonth(d.repayment_frequency), 0)
  const savings = s.goals.reduce((a, g) => a + (g.suggestedMonthly ?? 0), 0)
  const flexible = budgets.reduce((a, b) => a + b.monthly_limit, 0)
  const fixed = bills + repayments + savings
  const base = s.income.minimumMonthly
  if (base <= 0) return null
  const total = fixed + flexible
  const over = fixed > base
  const pct = (n: number) => `${Math.min((n / Math.max(total, base)) * 100, 100)}%`

  return (
    <div className={`card plan-summary ${over ? 'over' : ''}`}>
      <div className="row-between">
        <strong>Your monthly plan</strong>
        <span className="small">{money(total)} <span className="muted">of {money(base)} {s.income.irregular ? 'minimum ' : ''}income</span></span>
      </div>
      <div className="stack-bar" role="img" aria-label="Monthly plan breakdown">
        <div className="seg bills" style={{ width: pct(bills) }} />
        <div className="seg debts" style={{ width: pct(repayments) }} />
        <div className="seg savings" style={{ width: pct(savings) }} />
        <div className="seg flexible" style={{ width: pct(flexible) }} />
      </div>
      <div className="legend small">
        <span><i className="seg bills" /> Regular payments {money(bills)}</span>
        <span><i className="seg debts" /> Repayments {money(repayments)}</span>
        <span><i className="seg savings" /> Goals {money(savings)}</span>
        <span><i className="seg flexible" /> Budgets {money(flexible)}</span>
      </div>
      <p className="small tight">
        {over
          ? `Your fixed commitments (${money(fixed)}) are more than your ${s.income.irregular ? 'minimum' : ''} income of ${money(base)}. In a slow month something won't get paid. Trim a goal or a payment, or push a deadline back.`
          : total > base
            ? `Fixed commitments fit, but with your budgets you're planning ${money(total - base)} more than you can count on. ${s.income.irregular ? 'Keep budgets inside your minimum income and treat anything extra as a bonus.' : 'Trim a budget or two.'}`
            : `Everything fits inside your ${s.income.irregular ? 'minimum ' : ''}income, with ${money(base - total)} unplanned.`}
      </p>
    </div>
  )
}

// ---------- budgets ----------
function Budgets() {
  const { snapshot: s, categories, budgets, currency, reload } = useData()
  const [adding, setAdding] = useState(false)
  const [catId, setCatId] = useState('')
  const [limit, setLimit] = useState<number | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editLimit, setEditLimit] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!s) return null
  const money = (n: number) => formatMoney(n, currency)
  const budgeted = new Set(budgets.map(b => b.category_id))
  const free = categories.filter(c => c.kind === 'expense' && !c.archived && !budgeted.has(c.id) && c.name !== 'Savings' && c.name !== 'Debt')

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError('')
    try { await fn(); await reload() } catch (e) { setError(friendlyError((e as Error).message)) } finally { setBusy(false) }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!catId) return setError('Pick a category.')
    if (!limit || limit <= 0) return setError('Enter a monthly limit.')
    await run(async () => { await saveBudget(catId, limit); setAdding(false); setCatId(''); setLimit(null) })
  }

  return (
    <div className="stack">
      <p className="muted small tight">A monthly limit for a spending category. GreenWise warns you at 80% and tells you when you're on pace to go over.</p>
      {s.budgets.length === 0 && !adding && (
        <div className="card empty"><p className="muted">No budgets yet. Start with the categories you overspend on most.</p></div>
      )}
      {s.budgets.map(b => {
        const status = b.pct >= 1 ? 'over' : b.pct >= 0.8 ? 'warn' : b.projected > b.budget.monthly_limit ? 'pace' : 'ok'
        return (
          <div className="card compact" key={b.budget.id}>
            <div className="row-between">
              <strong>{b.category}</strong>
              <span className="small">{money(b.spent)} <span className="muted">of {money(b.budget.monthly_limit)}</span></span>
            </div>
            <div className="bar"><div className={`bar-fill ${status === 'over' ? 'danger' : status === 'warn' || status === 'pace' ? 'warn' : ''}`} style={{ width: `${Math.min(b.pct * 100, 100)}%` }} /></div>
            <p className="muted small tight">
              {status === 'over' ? `${money(-b.remaining)} over the limit.`
                : `${money(b.remaining)} left · ${s.month.daysLeft} days to go.`}
              {status !== 'over' && b.projected > b.budget.monthly_limit && ` On pace for ${money(b.projected)}.`}
            </p>
            {editing === b.budget.id ? (
              <div className="inline-add">
                <MoneyInput value={editLimit} onChange={setEditLimit} currency={currency} />
                <button className="btn primary small-btn" disabled={busy} onClick={() => editLimit && editLimit > 0 ? run(async () => { await saveBudget(b.budget.category_id, editLimit); setEditing(null) }) : setError('Enter a limit above zero.')}>Save</button>
                <button className="btn small-btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            ) : (
              <div className="card-actions">
                <button className="link-btn" onClick={() => { setEditing(b.budget.id); setEditLimit(b.budget.monthly_limit) }}>Change limit</button>
                <button className="link-btn danger-text" disabled={busy} onClick={() => run(() => deleteBudget(b.budget.id))}>Remove</button>
              </div>
            )}
          </div>
        )
      })}
      {adding ? (
        <form className="card form" onSubmit={add}>
          <label>Category
            <select value={catId} onChange={e => setCatId(e.target.value)}>
              <option value="">Choose…</option>
              {free.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Monthly limit<MoneyInput value={limit} onChange={setLimit} currency={currency} /></label>
          <div className="inline-add">
            <button className="btn primary" disabled={busy}>Add budget</button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : free.length > 0 && <button className="btn ghost" onClick={() => setAdding(true)}>+ Add a budget</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

// ---------- goals ----------
function GoalForm({ goal, onDone }: { goal?: Goal; onDone: () => void }) {
  const { currency, reload } = useData()
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState<number | null>(goal?.target_amount ?? null)
  const [start, setStart] = useState<number | null>(goal?.starting_amount ?? null)
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  const [priority, setPriority] = useState(goal?.priority ?? 3)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Give the goal a name.')
    if (!target || target <= 0) return setError('Enter a target amount.')
    if ((start ?? 0) > target) return setError('The amount saved before can’t be more than the target.')
    if (deadline && deadline <= localToday()) return setError('Pick a deadline in the future, or leave it empty.')
    const input: GoalInput = { name: name.trim().slice(0, 80), target_amount: target, starting_amount: start ?? 0, deadline: deadline || null, priority, status: goal?.status ?? 'active' }
    setBusy(true); setError('')
    try { goal ? await updateGoal(goal.id, input) : await insertGoal(input); await reload(); onDone() }
    catch (err) { setError(friendlyError((err as Error).message)); setBusy(false) }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>Goal<input maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Laptop" /></label>
      <div className="grid2">
        <label>Target<MoneyInput value={target} onChange={setTarget} currency={currency} /></label>
        <label>Saved before GreenWise<MoneyInput value={start} onChange={setStart} currency={currency} /></label>
        <label>Deadline <span className="muted small">(optional)</span><input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
        <label>Priority
          <select value={priority} onChange={e => setPriority(Number(e.target.value))}>
            <option value={1}>High</option><option value={3}>Medium</option><option value={5}>Low</option>
          </select>
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="inline-add">
        <button className="btn primary" disabled={busy}>{goal ? 'Save goal' : 'Add goal'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}

function Goals() {
  const { snapshot: s, goals, transactions, asOf, currency, reload } = useData()
  const { openTransaction } = useTransactionSheet()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState('')
  const money = (n: number) => formatMoney(n, currency)
  const history = useMemo(() => {
    const m = new Map<string, typeof transactions>()
    for (const t of transactions) if (t.type === 'savings' && t.goal_id && t.occurred_on >= asOf) m.set(t.goal_id, [...(m.get(t.goal_id) ?? []), t])
    return m
  }, [transactions, asOf])
  if (!s) return null
  const others = goals.filter(g => g.status !== 'active')

  async function act(fn: () => Promise<void>) {
    setError('')
    try { await fn(); await reload() } catch (e) { setError(friendlyError((e as Error).message)) }
  }

  return (
    <div className="stack">
      {s.goals.length === 0 && editing !== 'new' && <div className="card empty"><p className="muted">No active goals. A goal gives GreenWise something to protect when you're deciding whether to buy something.</p></div>}
      {s.goals.map(g => editing === g.goal.id ? <GoalForm key={g.goal.id} goal={g.goal} onDone={() => setEditing(null)} /> : (
        <div className="card compact" key={g.goal.id}>
          <div className="row-between">
            <strong>{g.goal.name} <span className="tag">{PRIORITY_LABEL[g.goal.priority]}</span></strong>
            <span className="small">{money(g.saved)} <span className="muted">of {money(g.goal.target_amount)}</span></span>
          </div>
          <div className="bar"><div className={`bar-fill ${g.onTrack === false ? 'warn' : ''}`} style={{ width: `${g.pct * 100}%` }} /></div>
          <p className="muted small tight">
            {g.remaining <= 0 ? 'Target reached. Mark it achieved to clear it from your plan.'
              : g.goal.deadline
                ? `${money(g.remaining)} to go by ${fmtDay(g.goal.deadline)}. Suggested: ${money(g.suggestedMonthly ?? 0)} a month.${g.onTrack === false ? ' Behind schedule.' : g.onTrack ? ' On track.' : ''}`
                : `${money(g.remaining)} to go. Add a deadline to get a suggested monthly amount.`}
          </p>
          {(history.get(g.goal.id)?.length ?? 0) > 0 && (
            <details className="history">
              <summary className="small">Contributions ({history.get(g.goal.id)!.length})</summary>
              <ul className="plain-list">
                {history.get(g.goal.id)!.slice(0, 10).map(t => (
                  <li key={t.id} className="row-between small"><span>{fmtDay(t.occurred_on)}</span><span>{money(t.amount)}</span></li>
                ))}
              </ul>
            </details>
          )}
          {confirm === g.goal.id ? (
            <div className="confirm-row">
              <span className="small">Delete this goal? Its contributions stay in Transactions as general savings.</span>
              <button className="btn small-btn" onClick={() => setConfirm(null)}>Keep</button>
              <button className="btn danger small-btn" onClick={() => act(() => deleteGoal(g.goal.id))}>Delete</button>
            </div>
          ) : (
            <div className="card-actions">
              {g.remaining > 0 && <button className="btn primary small-btn" onClick={() => openTransaction(null, { type: 'savings', goal_id: g.goal.id, amount: g.suggestedMonthly ?? undefined })}>+ Add money</button>}
              {g.remaining <= 0 && <button className="btn primary small-btn" onClick={() => act(() => updateGoal(g.goal.id, { status: 'achieved' }))}>Mark achieved</button>}
              <button className="link-btn" onClick={() => setEditing(g.goal.id)}>Edit</button>
              <button className="link-btn" onClick={() => act(() => updateGoal(g.goal.id, { status: 'paused' }))}>Pause</button>
              <button className="link-btn danger-text" onClick={() => setConfirm(g.goal.id)}>Delete</button>
            </div>
          )}
        </div>
      ))}
      {editing === 'new' ? <GoalForm onDone={() => setEditing(null)} /> : <button className="btn ghost" onClick={() => setEditing('new')}>+ Add a goal</button>}
      {others.length > 0 && (
        <details className="card compact">
          <summary><strong>Paused and finished ({others.length})</strong></summary>
          <ul className="plain-list">
            {others.map(g => (
              <li key={g.id} className="row-between small">
                <span>{g.name} <span className="tag">{g.status}</span></span>
                <button className="link-btn" onClick={() => act(() => updateGoal(g.id, { status: 'active' }))}>Make active</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

// ---------- regular payments ----------
function BillForm({ bill, onDone }: { bill?: Obligation; onDone: () => void }) {
  const { categories, currency, reload } = useData()
  const expenseCats = categories.filter(c => c.kind === 'expense' && !c.archived)
  const [name, setName] = useState(bill?.name ?? '')
  const [amount, setAmount] = useState<number | null>(bill?.amount ?? null)
  const [frequency, setFrequency] = useState<Obligation['frequency']>(bill?.frequency ?? 'monthly')
  const [due, setDue] = useState(bill?.next_due_date ?? '')
  const [categoryId, setCategoryId] = useState(bill?.category_id ?? '')
  const [essential, setEssential] = useState(bill?.is_essential ?? true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Give it a name.')
    if (!amount || amount <= 0) return setError('Enter the amount.')
    if (!due) return setError('When is it next due?')
    const input: ObligationInput = { name: name.trim().slice(0, 80), amount, frequency, next_due_date: due, category_id: categoryId || null, is_essential: essential, active: bill?.active ?? true }
    setBusy(true); setError('')
    try { bill ? await updateObligation(bill.id, input) : await insertObligation(input); await reload(); onDone() }
    catch (err) { setError(friendlyError((err as Error).message)); setBusy(false) }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>Name<input maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rent" /></label>
      <div className="grid2">
        <label>Amount<MoneyInput value={amount} onChange={setAmount} currency={currency} /></label>
        <label>How often
          <select value={frequency} onChange={e => setFrequency(e.target.value as Obligation['frequency'])}>
            {Object.entries(FREQ_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>{bill ? 'Next due (first unpaid)' : 'Next due'}<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
        <label>Category
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={essential} onChange={e => setEssential(e.target.checked)} />Must be paid (essential)</label>
      {bill && <p className="muted small tight">Changing the due date restarts the schedule from that date. Payments you've already linked still count.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="inline-add">
        <button className="btn primary" disabled={busy}>{bill ? 'Save' : 'Add payment'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}

function Bills() {
  const { snapshot: s, obligations, categories, currency, reload } = useData()
  const { openTransaction } = useTransactionSheet()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState('')
  if (!s) return null
  const money = (n: number) => formatMoney(n, currency)
  const catName = new Map(categories.map(c => [c.id, c.name]))
  const active = obligations.filter(o => o.active)
  const paused = obligations.filter(o => !o.active)
  const monthly = active.filter(o => o.frequency !== 'once').reduce((a, o) => a + o.amount * perMonth(o.frequency), 0)

  async function act(fn: () => Promise<void>) {
    setError('')
    try { await fn(); await reload() } catch (e) { setError(friendlyError((e as Error).message)) }
  }

  return (
    <div className="stack">
      <p className="muted small tight">
        Money that has to go out on a schedule. GreenWise sets it aside before showing what's safe to spend.
        {active.length > 0 && ` About ${money(monthly)} a month in total.`}
      </p>
      {active.length === 0 && editing !== 'new' && <div className="card empty"><p className="muted">No regular payments yet.</p></div>}
      {active.map(o => {
        if (editing === o.id) return <BillForm key={o.id} bill={o} onDone={() => setEditing(null)} />
        const next = s.upcoming.find(u => u.refId === o.id)
        return (
          <div className="card compact" key={o.id}>
            <div className="row-between">
              <strong>{o.name} {!o.is_essential && <span className="tag">Optional</span>}</strong>
              <strong>{money(o.amount)}</strong>
            </div>
            <p className="muted small tight">
              {FREQ_LABEL[o.frequency]}{o.category_id && catName.get(o.category_id) ? ` · ${catName.get(o.category_id)}` : ''} ·{' '}
              {next ? <>{next.overdue ? <span className="danger-text">Overdue since {fmtDay(next.due)}</span> : `Next due ${fmtDay(next.due)}`}{next.amount < o.amount && ` (${money(next.amount)} left)`}</>
                : 'Nothing due in the next 30 days'}
            </p>
            {confirm === o.id ? (
              <div className="confirm-row">
                <span className="small">Delete {o.name}? Past payments stay in Transactions.</span>
                <button className="btn small-btn" onClick={() => setConfirm(null)}>Keep</button>
                <button className="btn danger small-btn" onClick={() => act(() => deleteObligation(o.id))}>Delete</button>
              </div>
            ) : (
              <div className="card-actions">
                {next && (
                  <button className="btn primary small-btn" onClick={() => openTransaction(null, {
                    type: 'expense', amount: next.amount, description: o.name, category_id: o.category_id, obligation_id: o.id,
                    necessity: o.is_essential ? 'need' : 'want', is_planned: true,
                  })}>Mark paid</button>
                )}
                <button className="link-btn" onClick={() => setEditing(o.id)}>Edit</button>
                <button className="link-btn" onClick={() => act(() => updateObligation(o.id, { active: false }))}>Pause</button>
                <button className="link-btn danger-text" onClick={() => setConfirm(o.id)}>Delete</button>
              </div>
            )}
          </div>
        )
      })}
      {editing === 'new' ? <BillForm onDone={() => setEditing(null)} /> : <button className="btn ghost" onClick={() => setEditing('new')}>+ Add a regular payment</button>}
      {paused.length > 0 && (
        <details className="card compact">
          <summary><strong>Paused ({paused.length})</strong></summary>
          <ul className="plain-list">
            {paused.map(o => (
              <li key={o.id} className="row-between small">
                <span>{o.name} · {money(o.amount)}</span>
                <button className="link-btn" onClick={() => act(() => updateObligation(o.id, { active: true }))}>Resume</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted small">Debt repayments live in <Link to="/debts">Debts</Link>.</p>
    </div>
  )
}
