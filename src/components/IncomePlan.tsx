import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { MoneyInput } from './MoneyInput'
import { formatMoney } from '../lib/format'
import { friendlyError } from '../lib/supabase'
import { planScenarios, type ScenarioName } from '../engine/scenarios'
import { deleteIncomeSource, insertIncomeSource, updateIncomeSource, updateMoneySettings, type IncomeInput } from '../lib/data'
import type { IncomeSource } from '../lib/types'

const LABEL: Record<ScenarioName, { title: string; sub: string }> = {
  conservative: { title: 'Slow month', sub: 'Your minimum income' },
  expected: { title: 'Normal month', sub: 'What you usually get' },
  higher: { title: 'Good month', sub: 'Your optimistic figure' },
}
const FREQ: Record<IncomeSource['frequency'], string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', irregular: 'Irregular' }
const TYPES: Record<string, string> = { salary: 'Salary', business: 'Business', freelance: 'Freelance', allowance: 'Allowance', commission: 'Commission', other: 'Other' }

export function IncomePlan() {
  const { session, profile, refreshProfile } = useAuth()
  const { snapshot: s, incomeSources, obligations, debts, budgets, currency, reload } = useData()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [buffer, setBuffer] = useState<number | null>(profile?.emergency_buffer ?? 0)
  const [actual, setActual] = useState<number | null>(null)
  const [fixing, setFixing] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const money = (n: number) => formatMoney(n, currency)

  const plan = useMemo(() => s ? planScenarios({
    incomeSources, obligations, debts,
    goalsMonthly: s.goals.reduce((a, g) => a + (g.suggestedMonthly ?? 0), 0),
    budgetsTotal: budgets.reduce((a, b) => a + b.monthly_limit, 0),
    emergencyBuffer: profile?.emergency_buffer ?? 0, money,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }) : null, [s, incomeSources, obligations, debts, budgets, profile, currency])

  if (!s || !plan || !profile) return null

  async function act(fn: () => Promise<void>, done?: string) {
    setError(''); setMsg('')
    try { await fn(); await refreshProfile(); await reload(); if (done) setMsg(done) } catch (e) { setError(friendlyError((e as Error).message)) }
  }

  const c = plan.scenarios.conservative
  const active = incomeSources.filter(i => i.active)
  const inactive = incomeSources.filter(i => !i.active)

  return (
    <div className="stack">
      <p className="muted small tight">
        {plan.irregular
          ? 'Your income changes, so GreenWise plans your must-pay bills around a slow month and treats anything above it as a bonus.'
          : 'Your income is steady. These scenarios show how much room your plan has.'}
      </p>

      {active.length > 0 && (
        <>
          <div className="scenario-grid">
            {(['conservative', 'expected', 'higher'] as ScenarioName[]).map(k => {
              const x = plan.scenarios[k]
              return (
                <div key={k} className={`scenario ${x.status} ${k === 'conservative' ? 'base' : ''}`}>
                  <span className="muted small">{LABEL[k].sub}</span>
                  <strong className="scenario-title">{LABEL[k].title}</strong>
                  <div className="scenario-income">{money(x.income)}</div>
                  <dl>
                    <dt>Bills & repayments</dt><dd>−{money(x.fixed)}</dd>
                    {x.optional > 0 && <><dt>Optional payments</dt><dd>−{money(x.optional)}</dd></>}
                    {x.savings > 0 && <><dt>Goals</dt><dd>−{money(x.savings)}</dd></>}
                    {x.budgets > 0 && <><dt>Budgets</dt><dd>−{money(x.budgets)}</dd></>}
                    <dt className="total">Left over</dt><dd className={`total ${x.afterEverything < 0 ? 'danger-text' : ''}`}>{x.afterEverything < 0 ? '−' : ''}{money(Math.abs(x.afterEverything))}</dd>
                  </dl>
                  <span className={`tag state-${x.status === 'comfortable' ? 'on_track' : x.status === 'tight' ? 'at_risk' : 'broken'}`}>
                    {x.status === 'comfortable' ? 'Everything fits' : x.status === 'tight' ? 'Tight' : 'Bills not covered'}
                  </span>
                </div>
              )
            })}
          </div>

          <div className={`card compact ${c.status === 'short' ? 'plan-summary over' : ''}`}>
            <p className="tight" style={{ marginTop: 0 }}>{plan.verdict}</p>
            {c.status !== 'short' && (
              <p className="small tight"><strong>New fixed commitments:</strong> {plan.safeNewCommitment > 0
                ? `you can safely take on up to ${money(plan.safeNewCommitment)} a month, based on a slow month.`
                : 'there’s no room for new fixed payments right now. Even a small one would be paid from money you might not get.'}</p>
            )}
            {plan.bonusPlan && <p className="small tight"><strong>When a good month comes:</strong> {plan.bonusPlan.split}</p>}
            <p className="muted small tight">
              So far this month you've received {money(s.month.income)}.{' '}
              {s.month.income < c.income ? `That's below your slow-month figure, and GreenWise only counts money that has arrived.` : s.month.income >= plan.scenarios.expected.income ? 'That’s already a normal month or better.' : 'That’s above your slow-month figure.'}
            </p>
          </div>
        </>
      )}

      {/* ---------- income sources ---------- */}
      <div className="card-head" style={{ marginTop: '.5rem' }}><h2>Income sources</h2></div>
      {active.length === 0 && editing !== 'new' && <div className="card empty"><p className="muted">No income added. GreenWise needs at least one to plan.</p></div>}
      {active.map(i => editing === i.id ? <IncomeForm key={i.id} src={i} onDone={() => setEditing(null)} /> : (
        <div className="card compact" key={i.id}>
          <div className="row-between">
            <strong>{i.name} <span className="tag">{TYPES[i.income_type] ?? 'Income'}</span></strong>
            <strong>{money(i.expected_amount)}<span className="muted small"> {i.frequency === 'irregular' ? '/ month' : `· ${FREQ[i.frequency].toLowerCase()}`}</span></strong>
          </div>
          <p className="muted small tight">
            Lowest {money(i.minimum_amount)}{i.optimistic_amount ? ` · good ${money(i.optimistic_amount)}` : ''}
            {i.frequency !== 'irregular' && i.next_pay_date ? ` · paid from ${i.next_pay_date}` : ''}
          </p>
          <div className="card-actions">
            <button className="link-btn" onClick={() => setEditing(i.id)}>Edit</button>
            <button className="link-btn" onClick={() => act(() => updateIncomeSource(i.id, { active: false }))}>Stopped receiving this</button>
          </div>
        </div>
      ))}
      {editing === 'new' ? <IncomeForm onDone={() => setEditing(null)} /> : <button className="btn ghost" onClick={() => setEditing('new')}>+ Add income source</button>}
      {inactive.length > 0 && (
        <details className="card compact">
          <summary><strong>Past income ({inactive.length})</strong></summary>
          <ul className="plain-list">
            {inactive.map(i => (
              <li key={i.id} className="row-between small">
                <span>{i.name} · {money(i.expected_amount)}</span>
                <span>
                  <button className="link-btn" onClick={() => act(() => updateIncomeSource(i.id, { active: true }))}>Receiving again</button>{' '}
                  <button className="link-btn danger-text" onClick={() => act(() => deleteIncomeSource(i.id))}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ---------- buffer & balance ---------- */}
      <div className="card-head" style={{ marginTop: '.5rem' }}><h2>Safety net</h2></div>
      <div className="card compact form">
        <label>Emergency buffer
          <MoneyInput value={buffer} onChange={setBuffer} currency={currency} />
          <span className="muted small hint">Money GreenWise never counts as spendable.{plan.bonusPlan && plan.bonusPlan.bufferGap > 0 ? ` A month of commitments is ${money(plan.bonusPlan.bufferTarget)}.` : ''}</span>
        </label>
        <button className="btn primary" style={{ justifySelf: 'start' }} onClick={() => act(() => updateMoneySettings(session!.user.id, { emergency_buffer: Math.max(buffer ?? 0, 0) }), 'Buffer saved.')}>Save buffer</button>
      </div>
      <div className="card compact">
        <div className="row-between"><span>GreenWise thinks you have</span><strong>{money(s.available)}</strong></div>
        {!fixing ? (
          <button className="link-btn" style={{ marginTop: '.5rem' }} onClick={() => { setFixing(true); setActual(s.available) }}>That’s not right, update it</button>
        ) : (
          <div className="form" style={{ marginTop: '.75rem' }}>
            <label>What you actually have across all accounts and cash<MoneyInput value={actual} onChange={setActual} currency={currency} /></label>
            <p className="muted small tight">GreenWise adjusts your starting balance so the totals match. Your transactions aren't changed. A difference usually means something wasn't logged.</p>
            <div className="inline-add">
              <button className="btn primary" onClick={() => actual != null && act(async () => {
                await updateMoneySettings(session!.user.id, { starting_balance: profile.starting_balance + (actual - s.available) })
                setFixing(false)
              }, `Updated. ${actual >= s.available ? `${money(actual - s.available)} more` : `${money(s.available - actual)} less`} than GreenWise had.`)}>Update</button>
              <button className="btn" onClick={() => setFixing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {msg && <p className="success">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

function IncomeForm({ src, onDone }: { src?: IncomeSource; onDone: () => void }) {
  const { currency, reload } = useData()
  const [name, setName] = useState(src?.name ?? '')
  const [type, setType] = useState(src?.income_type ?? 'salary')
  const [freq, setFreq] = useState<IncomeSource['frequency']>(src?.frequency ?? 'monthly')
  const [expected, setExpected] = useState<number | null>(src?.expected_amount ?? null)
  const [minimum, setMinimum] = useState<number | null>(src?.minimum_amount ?? null)
  const [optimistic, setOptimistic] = useState<number | null>(src?.optimistic_amount ?? null)
  const [payday, setPayday] = useState(src?.next_pay_date ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const irregular = freq === 'irregular'
  const per = irregular ? 'month' : freq === 'weekly' ? 'week' : freq === 'biweekly' ? 'payment' : 'month'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Give it a name.')
    if (!expected || expected <= 0) return setError('How much do you usually get?')
    if (minimum == null) return setError('What’s the least you could get?')
    if (minimum > expected) return setError('The lowest amount can’t be more than the usual amount.')
    if (optimistic != null && optimistic < expected) return setError('A good month should be at least the usual amount.')
    const input: IncomeInput = {
      name: name.trim().slice(0, 80), income_type: type, frequency: freq, expected_amount: expected, minimum_amount: minimum,
      optimistic_amount: optimistic, next_pay_date: irregular ? null : payday || null, active: src?.active ?? true,
    }
    setBusy(true); setError('')
    try { src ? await updateIncomeSource(src.id, input) : await insertIncomeSource(input); await reload(); onDone() }
    catch (err) { setError(friendlyError((err as Error).message)); setBusy(false) }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>Name<input maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Salary, design gigs" /></label>
      <div className="grid2">
        <label>Type
          <select value={type} onChange={e => setType(e.target.value)}>
            {Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>How often
          <select value={freq} onChange={e => setFreq(e.target.value as IncomeSource['frequency'])}>
            {Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>{irregular ? 'Normal month' : `Usual amount per ${per}`}<MoneyInput value={expected} onChange={setExpected} currency={currency} /></label>
        <label>{irregular ? 'Slow month' : `Least per ${per}`}<MoneyInput value={minimum} onChange={setMinimum} currency={currency} /></label>
        <label>{irregular ? 'Good month' : `Good ${per}`} <span className="muted small">(optional)</span><MoneyInput value={optimistic} onChange={setOptimistic} currency={currency} /></label>
        {!irregular && <label>Next payday<input type="date" value={payday} onChange={e => setPayday(e.target.value)} /></label>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="inline-add">
        <button className="btn primary" disabled={busy}>{src ? 'Save' : 'Add income'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
