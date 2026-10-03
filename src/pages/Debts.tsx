import { useMemo, useState, type FormEvent } from 'react'
import { useData } from '../data/DataProvider'
import { useTransactionSheet } from '../components/AppShell'
import { MoneyInput } from '../components/MoneyInput'
import { formatMoney, localToday } from '../lib/format'
import { friendlyError } from '../lib/supabase'
import {
  explainStrategies, monthlyPayment, projectPayoff, repaymentBurden, simulateStrategy, type Strategy, type StrategyResult,
} from '../engine/debts'
import { deleteDebt, insertDebt, updateDebt, type DebtInput } from '../lib/data'
import type { Debt } from '../lib/types'
import { PageTitle } from '../components/Icon'

const FREQ: Record<Debt['repayment_frequency'], string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', one_off: 'All at once' }
const STRATEGY: Record<Strategy, { label: string; hint: string }> = {
  smallest: { label: 'Smallest balance first', hint: 'Clear the smallest debt, then roll its payment into the next.' },
  interest: { label: 'Highest interest first', hint: 'Attack the most expensive debt first.' },
  custom: { label: 'Your own order', hint: 'Use the order you set with the arrows below.' },
}

function fmtDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtMonth = (iso: string) => { const [y, m] = iso.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }

export default function Debts() {
  const { snapshot: s, currency, reload } = useData()
  const { openTransaction } = useTransactionSheet()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [extra, setExtra] = useState<number | null>(null)
  const [error, setError] = useState('')
  const money = (n: number) => formatMoney(n, currency)

  const active = useMemo(() => (s?.debts.items ?? []).filter(d => d.debt.status === 'active'), [s])
  const cleared = (s?.debts.items ?? []).filter(d => d.debt.status === 'paid_off')
  const ordered = useMemo(() => [...active].sort((a, b) => (a.debt.custom_priority ?? 999) - (b.debt.custom_priority ?? 999) || a.remaining - b.remaining), [active])

  const strategies = useMemo(() => {
    if (!s || active.length < 2) return null
    const states = active.filter(d => d.remaining > 0).map(d => ({ debt: d.debt, remaining: d.remaining }))
    if (states.length < 2) return null
    const r = Object.fromEntries((['smallest', 'interest', 'custom'] as Strategy[]).map(k => [k, simulateStrategy(states, k, extra ?? 0, s.today)])) as Record<Strategy, StrategyResult>
    return { r, notes: explainStrategies(r, money, states.some(x => x.debt.interest_rate > 0)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, active, extra, currency])

  if (!s) return null

  const monthlyTotal = active.filter(d => d.remaining > 0).reduce((a, d) => a + monthlyPayment(d.debt, d.remaining), 0)
  const burden = repaymentBurden(monthlyTotal, s.income.minimumMonthly)
  const paidSoFar = active.reduce((a, d) => a + d.paid, 0)
  const lastPayoff = active.map(d => projectPayoff(d.debt, d.remaining, s.today)).reduce<string | null | undefined>((acc, p) => (acc === null || p.date === null ? null : !acc || p.date > acc ? p.date : acc), undefined)
  const debtDue = s.upcoming.filter(u => u.kind === 'debt')
  const missed = debtDue.filter(u => u.overdue)
  const atRisk = s.shortfall > 0 ? s.dueInWindow.filter(u => u.kind === 'debt' && !u.overdue) : []

  async function act(fn: () => Promise<void>) {
    setError('')
    try { await fn(); await reload() } catch (e) { setError(friendlyError((e as Error).message)) }
  }

  async function move(id: string, dir: -1 | 1) {
    const list = ordered.map(d => d.debt.id)
    const i = list.indexOf(id), j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    await act(async () => { await Promise.all(list.map((dId, k) => updateDebt(dId, { custom_priority: k + 1 }))) })
  }

  return (
    <section className="page-debts">
      <PageTitle icon="debts" action={<button className="btn primary" onClick={() => setEditing('new')}>+ Add debt</button>} >Debts</PageTitle>

      {active.length === 0 && editing !== 'new' ? (
        <div className="card empty"><p className="muted">No debts recorded. If you owe anyone, add it here and GreenWise will set money aside for each repayment.</p></div>
      ) : active.length > 0 && (
        <div className="card">
          <div className="hero-stats debt-stats">
            <div><span className="muted small">Still owed</span><strong>{money(s.debts.totalRemaining)}</strong></div>
            <div><span className="muted small">Repaid since you started</span><strong>{money(paidSoFar)}</strong></div>
            <div><span className="muted small">Repayments a month</span><strong>{money(monthlyTotal)}</strong></div>
            <div><span className="muted small">Debt-free by</span><strong>{lastPayoff ? fmtMonth(lastPayoff) : lastPayoff === null ? 'Not at this rate' : '—'}</strong></div>
          </div>
          <div className="bar"><div className="bar-fill" style={{ width: `${s.debts.totalOpening ? (1 - s.debts.totalRemaining / s.debts.totalOpening) * 100 : 100}%` }} /></div>
          <p className="small tight">
            {burden.pct == null ? 'Add your income in Settings to see how heavy these repayments are.'
              : burden.level === 'none' ? ''
              : <>Repayments take <strong>{Math.round(burden.pct * 100)}%</strong> of your {s.income.irregular ? 'minimum ' : ''}monthly income. {
                  burden.level === 'manageable' ? 'That’s manageable.' : burden.level === 'heavy' ? 'That’s heavy. Be careful about taking on anything new.' : 'That’s very heavy. Avoid new debt and talk to your lenders if a payment is at risk.'}</>}
          </p>
        </div>
      )}

      {(missed.length > 0 || atRisk.length > 0) && (
        <div className="card">
          <h2>Needs attention</h2>
          <ul className="alert-list">
            {missed.map(u => (
              <li key={u.key} className="alert high"><div className="alert-text"><strong>{u.name}: {money(u.amount)} missed</strong><p>It was due {fmtDay(u.due)}. If you've paid it, record the payment so GreenWise stops counting it.</p></div></li>
            ))}
            {atRisk.map(u => (
              <li key={u.key} className="alert medium"><div className="alert-text"><strong>{u.name} on {fmtDay(u.due)} is at risk</strong><p>You're {money(s.shortfall)} short of everything due before payday. Keep spending to essentials so this one gets paid.</p></div></li>
            ))}
          </ul>
        </div>
      )}

      {debtDue.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Upcoming repayments</h2><span className="muted small">next 30 days</span></div>
          <ul className="plain-list">
            {debtDue.map(u => (
              <li key={u.key} className="due-row">
                <span className="due-date">{fmtDay(u.due)}</span>
                <span className="due-name">{u.name.replace('Repay ', '')}{u.overdue && <span className="tag danger">Overdue</span>}</span>
                <span className="due-amount">
                  {money(u.amount)}
                  <button className="link-btn small block" onClick={() => openTransaction(null, { type: 'debt_repayment', debt_id: u.refId, amount: u.amount })}>Record payment</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="stack">
        {editing === 'new' && <DebtForm onDone={() => setEditing(null)} />}
        {ordered.map((d, idx) => {
          if (editing === d.debt.id) return <DebtForm key={d.debt.id} debt={d.debt} paid={d.paid} remaining={d.remaining} onDone={() => setEditing(null)} />
          const p = projectPayoff(d.debt, d.remaining, s.today)
          const nextDue = debtDue.find(u => u.refId === d.debt.id)
          return (
            <div className="card compact" key={d.debt.id}>
              <div className="row-between">
                <strong>
                  {active.length > 1 && <span className="order-btns">
                    <button className="icon-btn tiny" aria-label="Move up" disabled={idx === 0} onClick={() => move(d.debt.id, -1)}>↑</button>
                    <button className="icon-btn tiny" aria-label="Move down" disabled={idx === ordered.length - 1} onClick={() => move(d.debt.id, 1)}>↓</button>
                  </span>}
                  {d.debt.creditor}
                </strong>
                <span className="small">{money(d.remaining)} <span className="muted">of {money(d.debt.original_amount)}</span></span>
              </div>
              <div className="bar"><div className="bar-fill" style={{ width: `${d.pct * 100}%` }} /></div>
              <p className="muted small tight">
                {d.remaining <= 0 ? 'Fully repaid.' : <>
                  {money(d.debt.minimum_payment)} {FREQ[d.debt.repayment_frequency].toLowerCase()}
                  {d.debt.interest_rate > 0 ? ` · ${d.debt.interest_rate}% a year` : ' · no interest'}
                  {nextDue ? ` · next ${fmtDay(nextDue.due)}` : ''}
                </>}
              </p>
              {d.remaining > 0 && (
                <p className="small tight">
                  {p.months == null ? <span className="danger-text">{p.neverReason}</span>
                    : <>Paid off around <strong>{fmtMonth(p.date!)}</strong> ({p.months} month{p.months === 1 ? '' : 's'}){p.totalInterest > 0 && `, about ${money(p.totalInterest)} in interest`}.</>}
                </p>
              )}
              {confirm === d.debt.id ? (
                <div className="confirm-row">
                  <span className="small">Delete this debt? Repayments stay in Transactions.</span>
                  <button className="btn small-btn" onClick={() => setConfirm(null)}>Keep</button>
                  <button className="btn danger small-btn" onClick={() => act(() => deleteDebt(d.debt.id))}>Delete</button>
                </div>
              ) : (
                <div className="card-actions">
                  {d.remaining > 0
                    ? <button className="btn primary small-btn" onClick={() => openTransaction(null, { type: 'debt_repayment', debt_id: d.debt.id, amount: Math.min(d.debt.minimum_payment || d.remaining, d.remaining) })}>Record payment</button>
                    : <button className="btn primary small-btn" onClick={() => act(() => updateDebt(d.debt.id, { status: 'paid_off' }))}>Mark as paid off</button>}
                  <button className="link-btn" onClick={() => setEditing(d.debt.id)}>Edit</button>
                  <button className="link-btn danger-text" onClick={() => setConfirm(d.debt.id)}>Delete</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {strategies && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Which debt to pay off first?</h2>
          <p className="muted small tight" style={{ marginBottom: '.75rem' }}>
            Every plan pays all your minimums. Anything extra, plus the payment from each debt you clear, goes to the next one in line.
          </p>
          <label className="form" style={{ maxWidth: 320 }}>
            <span className="field-label">Extra you could add each month</span>
            <MoneyInput value={extra} onChange={setExtra} currency={currency} placeholder="0" />
          </label>
          <div className="strategy-grid">
            {(['smallest', 'interest', 'custom'] as Strategy[]).map(k => {
              const r = strategies.r[k]
              return (
                <div key={k} className="strategy">
                  <strong>{STRATEGY[k].label}</strong>
                  <span className="muted small">{STRATEGY[k].hint}</span>
                  <dl>
                    <dt>Debt-free</dt><dd>{r.date ? fmtMonth(r.date) : 'Not at this rate'}</dd>
                    <dt>Interest paid</dt><dd>{money(r.totalInterest)}</dd>
                    <dt>First debt cleared</dt><dd>{r.firstClearedMonth ? `Month ${r.firstClearedMonth}` : '—'}</dd>
                  </dl>
                  <span className="muted small">Order: {r.order.map(o => o.creditor).join(' → ') || '—'}</span>
                </div>
              )
            })}
          </div>
          <ul className="reasons" style={{ marginTop: '1rem' }}>
            {strategies.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          <p className="muted small tight">These are estimates that assume monthly interest and on-time payments. GreenWise shows the trade-offs. The choice is yours.</p>
        </div>
      )}

      {cleared.length > 0 && (
        <details className="card compact" style={{ marginTop: '1rem' }}>
          <summary><strong>Paid off ({cleared.length})</strong></summary>
          <ul className="plain-list">
            {cleared.map(d => (
              <li key={d.debt.id} className="row-between small">
                <span>{d.debt.creditor} · {money(d.debt.original_amount)}</span>
                <button className="link-btn" onClick={() => act(() => updateDebt(d.debt.id, { status: 'active' }))}>Reopen</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  )
}

function DebtForm({ debt, paid = 0, remaining, onDone }: { debt?: Debt; paid?: number; remaining?: number; onDone: () => void }) {
  const { currency, reload } = useData()
  const [creditor, setCreditor] = useState(debt?.creditor ?? '')
  const [original, setOriginal] = useState<number | null>(debt?.original_amount ?? null)
  const [owed, setOwed] = useState<number | null>(remaining ?? null)
  const [rate, setRate] = useState(debt ? String(debt.interest_rate) : '')
  const [minimum, setMinimum] = useState<number | null>(debt?.minimum_payment ?? null)
  const [freq, setFreq] = useState<Debt['repayment_frequency']>(debt?.repayment_frequency ?? 'monthly')
  const [due, setDue] = useState(debt?.next_due_date ?? '')
  const [start, setStart] = useState(debt?.start_date ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!creditor.trim()) return setError('Who do you owe?')
    if (owed == null || owed < 0) return setError('How much do you still owe?')
    const r = rate.trim() === '' ? 0 : Number(rate)
    if (Number.isNaN(r) || r < 0 || r > 1000) return setError('Interest rate should be a number like 5 or 24.')
    if (freq !== 'one_off' && (!minimum || minimum <= 0)) return setError('Enter the repayment amount.')
    // the opening balance is "as of setup"; repayments already recorded are added back so the remaining figure is exact
    const opening = owed + paid
    const orig = Math.max(original ?? 0, opening)
    const input: DebtInput = {
      creditor: creditor.trim().slice(0, 80), original_amount: orig, opening_balance: opening, interest_rate: r,
      minimum_payment: minimum ?? 0, repayment_frequency: freq, next_due_date: due || null, start_date: start || debt?.start_date || localToday(),
      status: owed === 0 ? 'paid_off' : 'active',
    }
    if (orig <= 0) return setError('Enter the amount owed.')
    setBusy(true); setError('')
    try { debt ? await updateDebt(debt.id, input) : await insertDebt(input); await reload(); onDone() }
    catch (err) { setError(friendlyError((err as Error).message)); setBusy(false) }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>Who do you owe?<input maxLength={80} value={creditor} onChange={e => setCreditor(e.target.value)} placeholder="e.g. Uncle, Bank loan" /></label>
      <div className="grid2">
        <label>Still owed now<MoneyInput value={owed} onChange={setOwed} currency={currency} /></label>
        <label>Original amount <span className="muted small">(optional)</span><MoneyInput value={original} onChange={setOriginal} currency={currency} /></label>
        <label>Repayment amount<MoneyInput value={minimum} onChange={setMinimum} currency={currency} /></label>
        <label>How often
          <select value={freq} onChange={e => setFreq(e.target.value as Debt['repayment_frequency'])}>
            {Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Next payment due<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
        <label>Interest per year <span className="muted small">(%)</span><input inputMode="decimal" placeholder="0" value={rate} onChange={e => setRate(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label>Started <span className="muted small">(optional)</span><input type="date" max={localToday()} value={start} onChange={e => setStart(e.target.value)} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="inline-add">
        <button className="btn primary" disabled={busy}>{debt ? 'Save' : 'Add debt'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
