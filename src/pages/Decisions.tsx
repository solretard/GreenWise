import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { useTransactionSheet } from '../components/AppShell'
import { MoneyInput } from '../components/MoneyInput'
import { formatMoney, localToday } from '../lib/format'
import { friendlyError } from '../lib/supabase'
import { decide, type DecisionInput, type DecisionResult, type Level } from '../engine/decision'
import { addDays, monthEnd, weekStart } from '../engine/dates'
import {
  deleteCommitment, deleteDecision, insertCommitment, insertDecision, updateCommitmentStatus, updateDecisionOutcome,
  type CommitmentInput,
} from '../lib/data'
import type { Commitment, PurchaseDecision } from '../lib/types'
import { PageTitle } from '../components/Icon'

function fmtDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const LEVEL: Record<Level | 'none', string> = { high: 'High', medium: 'Moderate', low: 'Low', none: 'None' }
const VERDICT: Record<DecisionResult['verdict'], string> = {
  go_ahead: 'Go ahead', go_ahead_carefully: 'Go ahead carefully', wait: 'Consider waiting', skip: 'Consider skipping',
}
const OUTCOME: Record<PurchaseDecision['outcome'], string> = { pending: 'Undecided', bought: 'Bought', postponed: 'Waiting', skipped: 'Skipped' }

export default function Decisions() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'commitments' ? 'commitments' : 'buy'
  return (
    <section>
      <PageTitle icon="decisions">Decisions</PageTitle>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'buy'} className={tab === 'buy' ? 'on' : ''} onClick={() => setParams({}, { replace: true })}>Should I buy it?</button>
        <button role="tab" aria-selected={tab === 'commitments'} className={tab === 'commitments' ? 'on' : ''} onClick={() => setParams({ tab: 'commitments' }, { replace: true })}>Commitments</button>
      </div>
      {tab === 'buy' ? <PurchaseCheck /> : <Commitments />}
    </section>
  )
}

// =====================================================================
// Purchase decisions
// =====================================================================
function PurchaseCheck() {
  const { snapshot: s, transactions, categories, decisions, currency, reload } = useData()
  const { openTransaction } = useTransactionSheet()
  const [item, setItem] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [necessity, setNecessity] = useState<'need' | 'want' | null>(null)
  const [neededBy, setNeededBy] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [checked, setChecked] = useState<{ input: DecisionInput; result: DecisionResult; reason: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const money = (n: number) => formatMoney(n, currency)
  const expenseCats = categories.filter(c => c.kind === 'expense' && !c.archived && c.name !== 'Savings' && c.name !== 'Debt')
  const catName = (id: string | null) => (id ? categories.find(c => c.id === id)?.name ?? null : null)

  if (!s) return null

  function run(input: DecisionInput) {
    return decide(input, s!, transactions, s!.commitments, money, fmtDay)
  }

  function check(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!item.trim()) return setError('What do you want to buy?')
    if (!price || price <= 0) return setError('Enter the price.')
    if (!necessity) return setError('Is it a need or a want?')
    const input: DecisionInput = { item: item.trim().slice(0, 120), price, necessity, neededBy: neededBy || null, categoryId: categoryId || null, categoryName: catName(categoryId || null) }
    setChecked({ input, result: run(input), reason: reason.trim().slice(0, 300) })
    setTimeout(() => document.getElementById('decision-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function record(outcome: PurchaseDecision['outcome']) {
    if (!checked) return
    setBusy(true); setError('')
    const { input, result } = checked
    try {
      await insertDecision({
        item: input.item, price: input.price, reason: checked.reason || null, necessity: input.necessity,
        needed_by: input.neededBy, category_id: input.categoryId, outcome,
        result: { ...result, checked_on: localToday(), safe_before: s!.safeToSpend },
      })
      await reload()
      if (outcome === 'bought') {
        openTransaction(null, {
          type: 'expense', amount: input.price, description: input.item, category_id: input.categoryId,
          necessity: input.necessity, is_planned: true,
        })
      }
      setChecked(null); setItem(''); setPrice(null); setReason(''); setNecessity(null); setNeededBy(''); setCategoryId('')
    } catch (err) {
      setError(friendlyError((err as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const r = checked?.result

  return (
    <div className="stack">
      <form className="card form" onSubmit={check}>
        <p className="muted small tight" style={{ marginTop: 0 }}>
          Thinking about buying something? GreenWise checks it against everything you've committed to, not just your balance.
        </p>
        <label>What do you want to buy?<input maxLength={120} value={item} onChange={e => setItem(e.target.value)} placeholder="e.g. New headphones" /></label>
        <div className="grid2">
          <label>Price<MoneyInput value={price} onChange={setPrice} currency={currency} /></label>
          <label>When do you need it? <span className="muted small">(optional)</span><input type="date" min={localToday()} value={neededBy} onChange={e => setNeededBy(e.target.value)} /></label>
        </div>
        <div className="field">
          <span className="field-label">Need or want?</span>
          <div className="segmented" role="radiogroup" aria-label="Need or want">
            <button type="button" role="radio" aria-checked={necessity === 'need'} className={necessity === 'need' ? 'on' : ''} onClick={() => setNecessity('need')}>Need</button>
            <button type="button" role="radio" aria-checked={necessity === 'want'} className={necessity === 'want' ? 'on' : ''} onClick={() => setNecessity('want')}>Want</button>
          </div>
        </div>
        <label>Category <span className="muted small">(helps check your budget)</span>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">Not sure</option>
            {expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Why do you want it? <span className="muted small">(optional)</span><input maxLength={300} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. My old pair broke" /></label>
        {error && !checked && <p className="error" role="alert">{error}</p>}
        <button className="btn primary">Check it</button>
      </form>

      {checked && r && (
        <div className={`card decision verdict-${r.verdict}`} id="decision-result">
          <span className="eyebrow">Can I afford it?</span>
          <h2 className="decision-headline">{r.headline}</h2>
          <div className="meters">
            <Meter label="Affordability" level={r.affordability} good="high" />
            <Meter label="Financial impact" level={r.impact} good="low" />
            <Meter label="Priority" level={r.priority} good="high" neutral />
          </div>
          <span className="eyebrow">Should I buy it?</span>
          <p className="decision-advice"><strong>{VERDICT[r.verdict]}.</strong> {r.advice}</p>
          <ul className="reasons">
            {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="decision-actions">
            <button className="btn primary" disabled={busy} onClick={() => record('bought')}>I'm buying it</button>
            <button className="btn" disabled={busy} onClick={() => record('postponed')}>I'll wait</button>
            <button className="btn" disabled={busy} onClick={() => record('skipped')}>Skip it</button>
            <button className="link-btn" disabled={busy} onClick={() => record('pending')}>Decide later</button>
          </div>
          <p className="muted small tight">Choosing saves the decision so you can look back on it. "I'm buying it" also opens the expense form, ready to log.</p>
        </div>
      )}

      <DecisionHistory decisions={decisions} run={run} />
    </div>
  )
}

function Meter({ label, level, good, neutral }: { label: string; level: Level | 'none'; good: Level; neutral?: boolean }) {
  const tone = neutral ? 'neutral' : level === good ? 'good' : level === 'medium' ? 'mid' : 'bad'
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : level === 'low' ? 1 : 0
  return (
    <div className={`meter ${tone}`}>
      <span className="muted small">{label}</span>
      <strong>{LEVEL[level]}</strong>
      <span className="pips" aria-hidden>{[1, 2, 3].map(i => <i key={i} className={i <= filled ? 'on' : ''} />)}</span>
    </div>
  )
}

function DecisionHistory({ decisions, run }: { decisions: PurchaseDecision[]; run: (i: DecisionInput) => DecisionResult }) {
  const { categories, currency, reload } = useData()
  const { openTransaction } = useTransactionSheet()
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')
  const money = (n: number) => formatMoney(n, currency)
  const catName = (id: string | null) => (id ? categories.find(c => c.id === id)?.name ?? null : null)
  if (decisions.length === 0) return null

  async function act(fn: () => Promise<void>) {
    setError('')
    try { await fn(); await reload() } catch (e) { setError(friendlyError((e as Error).message)) }
  }

  return (
    <div className="card">
      <div className="card-head"><h2>Your decisions</h2></div>
      <ul className="plain-list">
        {decisions.map(d => {
          const fresh = open === d.id ? run({ item: d.item, price: d.price, necessity: d.necessity, neededBy: d.needed_by && d.needed_by >= localToday() ? d.needed_by : null, categoryId: d.category_id, categoryName: catName(d.category_id) }) : null
          const then = d.result as Partial<DecisionResult>
          return (
            <li key={d.id} className="decision-row">
              <button className="decision-summary" onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>
                <span>
                  <strong>{d.item}</strong>
                  <span className="muted small block">{fmtDay(d.created_at.slice(0, 10))} · {then.verdict ? VERDICT[then.verdict] : ''}</span>
                </span>
                <span className="right">
                  {money(d.price)}
                  <span className={`tag ${d.outcome === 'pending' ? 'warn' : ''}`}>{OUTCOME[d.outcome]}</span>
                </span>
              </button>
              {fresh && (
                <div className="decision-detail">
                  <p className="small tight"><strong>Today:</strong> {fresh.headline} {VERDICT[fresh.verdict]}. {fresh.advice}</p>
                  {d.reason && <p className="muted small tight">Why you wanted it: {d.reason}</p>}
                  <div className="card-actions">
                    {d.outcome !== 'bought' && (
                      <button className="btn primary small-btn" onClick={() => act(async () => {
                        await updateDecisionOutcome(d.id, 'bought')
                        openTransaction(null, { type: 'expense', amount: d.price, description: d.item, category_id: d.category_id, necessity: d.necessity, is_planned: true })
                      })}>I bought it</button>
                    )}
                    {d.outcome !== 'postponed' && d.outcome !== 'bought' && <button className="link-btn" onClick={() => act(() => updateDecisionOutcome(d.id, 'postponed'))}>Waiting</button>}
                    {d.outcome !== 'skipped' && d.outcome !== 'bought' && <button className="link-btn" onClick={() => act(() => updateDecisionOutcome(d.id, 'skipped'))}>Skipped</button>}
                    <button className="link-btn danger-text" onClick={() => act(() => deleteDecision(d.id))}>Delete</button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

// =====================================================================
// Commitments
// =====================================================================
const STATE_LABEL = { on_track: 'On track', at_risk: 'At risk', broken: 'Broken', kept: 'Kept', missed: 'Missed' } as const

function Commitments() {
  const { snapshot: s, commitments, reload } = useData()
  const [creating, setCreating] = useState<Commitment['kind'] | null>(null)
  const [error, setError] = useState('')
  const past = commitments.filter(c => c.status !== 'active')
  if (!s) return null

  async function act(fn: () => Promise<void>) {
    setError('')
    try { await fn(); await reload() } catch (e) { setError(friendlyError((e as Error).message)) }
  }

  return (
    <div className="stack">
      <p className="muted small tight">Decide once, then let GreenWise keep track. You'll get a warning on Home before a commitment slips, not after.</p>

      {s.commitments.map(c => (
        <div key={c.commitment.id} className={`card compact commitment ${c.state}`}>
          <div className="row-between">
            <strong>{c.commitment.title}</strong>
            <span className={`tag state-${c.state}`}>{STATE_LABEL[c.state]}</span>
          </div>
          {c.commitment.kind !== 'no_unplanned' && c.target > 0 && (
            <div className="bar"><div className={`bar-fill ${c.state === 'broken' || c.state === 'missed' ? 'danger' : c.state === 'at_risk' ? 'warn' : ''}`} style={{ width: `${Math.min((c.progress / c.target) * 100, 100)}%` }} /></div>
          )}
          <p className="small tight">{c.message}</p>
          <p className="muted small tight">{fmtDay(c.commitment.start_date)} – {fmtDay(c.commitment.end_date)}</p>
          <div className="card-actions">
            {c.finished ? (
              <button className="btn primary small-btn" onClick={() => act(() => updateCommitmentStatus(c.commitment.id, c.state === 'kept' ? 'kept' : 'broken'))}>
                Close and record as {c.state === 'kept' ? 'kept' : 'not kept'}
              </button>
            ) : (
              <button className="link-btn" onClick={() => act(() => updateCommitmentStatus(c.commitment.id, 'cancelled'))}>Cancel commitment</button>
            )}
          </div>
        </div>
      ))}

      {creating ? <CommitmentForm kind={creating} onDone={() => setCreating(null)} /> : (
        <div className="template-grid">
          <button className="choice" onClick={() => setCreating('spend_limit')}><strong>Spend no more than…</strong><span className="muted small">A limit on a category, or on wants</span></button>
          <button className="choice" onClick={() => setCreating('save_target')}><strong>Save … before …</strong><span className="muted small">An amount by a date</span></button>
          <button className="choice" onClick={() => setCreating('no_unplanned')}><strong>No unplanned purchases</strong><span className="muted small">For a week, or longer</span></button>
        </div>
      )}

      {past.length > 0 && (
        <details className="card compact">
          <summary><strong>Past commitments ({past.length})</strong> · kept {past.filter(c => c.status === 'kept').length} of {past.filter(c => c.status !== 'cancelled').length}</summary>
          <ul className="plain-list">
            {past.map(c => (
              <li key={c.id} className="row-between small">
                <span>{c.title} <span className="muted">· ended {fmtDay(c.end_date)}</span></span>
                <span>
                  <span className={`tag ${c.status === 'kept' ? 'state-kept' : c.status === 'broken' ? 'state-broken' : ''}`}>{c.status === 'broken' ? 'Not kept' : c.status}</span>{' '}
                  <button className="link-btn danger-text" onClick={() => act(() => deleteCommitment(c.id))}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

function CommitmentForm({ kind, onDone }: { kind: Commitment['kind']; onDone: () => void }) {
  const { categories, goals, currency, reload } = useData()
  const today = localToday()
  const [amount, setAmount] = useState<number | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [goalId, setGoalId] = useState('')
  const [period, setPeriod] = useState<'week' | 'month' | 'custom'>(kind === 'save_target' ? 'custom' : kind === 'no_unplanned' ? 'week' : 'month')
  const [customEnd, setCustomEnd] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const money = (n: number) => formatMoney(n, currency)
  const expenseCats = categories.filter(c => c.kind === 'expense' && !c.archived && c.name !== 'Savings' && c.name !== 'Debt')
  const activeGoals = goals.filter(g => g.status === 'active')

  const end = useMemo(() => period === 'week' ? addDays(weekStart(today), 6) : period === 'month' ? monthEnd(today) : customEnd, [period, customEnd, today])
  const periodText = period === 'week' ? 'this week' : period === 'month' ? 'this month' : end ? `before ${fmtDay(end)}` : ''

  const title = (() => {
    const cat = categories.find(c => c.id === categoryId)?.name.toLowerCase()
    if (kind === 'spend_limit') return `Spend no more than ${amount ? money(amount) : '…'} on ${cat ?? 'wants'} ${periodText}`
    if (kind === 'save_target') return `Save ${amount ? money(amount) : '…'}${goalId ? ` for ${goals.find(g => g.id === goalId)?.name}` : ''} ${periodText}`
    return `No unplanned purchases ${periodText}`
  })()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (kind !== 'no_unplanned' && (!amount || amount <= 0)) return setError('Enter an amount.')
    if (!end || end < today) return setError('Pick an end date from today onwards.')
    const input: CommitmentInput = {
      kind, title: title.slice(0, 120), amount: kind === 'no_unplanned' ? null : amount,
      category_id: kind === 'spend_limit' ? categoryId || null : null,
      goal_id: kind === 'save_target' ? goalId || null : null,
      start_date: period === 'month' ? today.slice(0, 8) + '01' : period === 'week' ? weekStart(today) : today,
      end_date: end,
    }
    setBusy(true); setError('')
    try { await insertCommitment(input); await reload(); onDone() }
    catch (err) { setError(friendlyError((err as Error).message)); setBusy(false) }
  }

  return (
    <form className="card form" onSubmit={submit}>
      {kind !== 'no_unplanned' && (
        <label>{kind === 'spend_limit' ? 'Spend no more than' : 'Save'}<MoneyInput value={amount} onChange={setAmount} currency={currency} /></label>
      )}
      {kind === 'spend_limit' && (
        <label>On
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">All wants (anything marked “want”)</option>
            {expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {kind === 'save_target' && activeGoals.length > 0 && (
        <label>Towards <span className="muted small">(optional)</span>
          <select value={goalId} onChange={e => setGoalId(e.target.value)}>
            <option value="">Any savings</option>
            {activeGoals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      )}
      <div className="field">
        <span className="field-label">For</span>
        <div className="segmented">
          {kind !== 'save_target' && <button type="button" className={period === 'week' ? 'on' : ''} onClick={() => setPeriod('week')}>This week</button>}
          <button type="button" className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>This month</button>
          <button type="button" className={period === 'custom' ? 'on' : ''} onClick={() => setPeriod('custom')}>Until a date</button>
        </div>
      </div>
      {period === 'custom' && <label>End date<input type="date" min={today} value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></label>}
      <p className="note">“{title}”</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="inline-add">
        <button className="btn primary" disabled={busy}>Make this commitment</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
