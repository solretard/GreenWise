import { useMemo, useState, type FormEvent } from 'react'
import { useData } from '../data/DataProvider'
import { useTransactionSheet } from './AppShell'
import { MoneyInput } from './MoneyInput'
import { formatMoney } from '../lib/format'
import { friendlyError } from '../lib/supabase'
import { rankPriorities } from '../engine/priorities'
import { deletePriority, insertPriority, updatePriority, type PriorityInput } from '../lib/data'
import type { Priority } from '../lib/types'

const URGENCY = ['', 'Can wait', 'Soon-ish', 'This month', 'Soon', 'Urgent']
const CONSEQ = ['', 'None', 'Minor', 'Some', 'Serious', 'Severe']

function fmtDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function Priorities() {
  const { snapshot: s, priorities, currency, reload } = useData()
  const { openTransaction } = useTransactionSheet()
  const [basis, setBasis] = useState<'safe' | 'custom'>('safe')
  const [custom, setCustom] = useState<number | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const money = (n: number) => formatMoney(n, currency)

  const pot = basis === 'safe' ? s?.safeToSpend ?? 0 : custom ?? 0
  const ranked = useMemo(() => (s ? rankPriorities(priorities, pot, s.today) : []), [priorities, pot, s])
  const closed = priorities.filter(p => p.status !== 'open')
  const anyManual = ranked.some(r => r.item.manual_rank != null)
  if (!s) return null

  const total = ranked.reduce((a, r) => a + r.item.amount, 0)
  const coveredCount = ranked.filter(r => r.funding === 'covered').length
  const partly = ranked.find(r => r.funding === 'partly')

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError('')
    try { await fn(); await reload() } catch (e) { setError(friendlyError((e as Error).message)) } finally { setBusy(false) }
  }

  function move(idx: number, dir: -1 | 1) {
    const ids = ranked.map(r => r.item.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    // pin the whole visible order so it stays exactly as arranged
    return act(async () => { await Promise.all(ids.map((id, k) => updatePriority(id, { manual_rank: k + 1 }))) })
  }

  return (
    <div className="stack">
      <p className="muted small tight">
        List what you need or want to pay for. GreenWise ranks it by how necessary and urgent each one is and what happens if it waits, not by price. Then it shows how far your money goes. Your regular bills and repayments are already set aside, so you don't need to add them here.
      </p>

      <div className="card compact">
        <div className="field">
          <span className="field-label">Money to work with</span>
          <div className="segmented">
            <button type="button" className={basis === 'safe' ? 'on' : ''} onClick={() => setBasis('safe')}>Safe to spend · {money(s.safeToSpend)}</button>
            <button type="button" className={basis === 'custom' ? 'on' : ''} onClick={() => setBasis('custom')}>Another amount</button>
          </div>
          {basis === 'custom' && <MoneyInput value={custom} onChange={setCustom} currency={currency} placeholder="e.g. what you expect on payday" />}
        </div>
        {ranked.length > 0 && (
          <p className="small tight">
            {pot <= 0 ? 'There’s nothing free to put towards these right now. They’ll have to wait for your next income.'
              : coveredCount === ranked.length ? `${money(pot)} covers everything on the list (${money(total)}), with ${money(pot - total)} left over.`
              : <>With {money(pot)} you can cover the top {coveredCount}{partly ? <>, and {money(partly.fundedAmount)} of <strong>{partly.item.name}</strong></> : ''}. The rest ({money(total - ranked.filter(r => r.funding === 'covered').reduce((a, r) => a + r.item.amount, 0) - (partly?.fundedAmount ?? 0))}) will have to wait.</>}
          </p>
        )}
      </div>

      {ranked.length === 0 && editing !== 'new' && (
        <div className="card empty"><p className="muted">Nothing on your list. Add the things competing for your money, like a laptop, school fees or a trip, and GreenWise will help you decide what comes first.</p></div>
      )}

      {ranked.length > 0 && (
        <ol className="priority-list">
          {ranked.map((r, idx) => editing === r.item.id ? (
            <li key={r.item.id}><PriorityForm item={r.item} onDone={() => setEditing(null)} /></li>
          ) : (
            <li key={r.item.id} className={`priority ${r.funding}`}>
              <span className="rank">{idx + 1}</span>
              <div className="priority-main">
                <div className="row-between">
                  <strong>{r.item.name} <span className={`tag ${r.item.necessity === 'need' ? 'state-on_track' : ''}`}>{r.item.necessity === 'need' ? 'Need' : 'Want'}</span></strong>
                  <strong>{money(r.item.amount)}</strong>
                </div>
                <p className="muted small tight">
                  Why here: {r.reasons.join(', ')}.
                  {r.item.manual_rank != null && r.suggestedRank !== idx + 1 && ` You moved this (suggested #${r.suggestedRank}).`}
                </p>
                <p className="small tight">
                  {r.funding === 'covered' ? <span className="pos">Covered by your money.</span>
                    : r.funding === 'partly' ? <span className="warn-text">{money(r.fundedAmount)} covered, {money(r.item.amount - r.fundedAmount)} short.</span>
                    : <span className="muted">Not covered yet{s.hasPayday ? `. Revisit after payday on ${fmtDay(s.windowEnd)}` : ''}.</span>}
                </p>
                <div className="card-actions">
                  <button className="icon-btn tiny" aria-label="Move up" disabled={idx === 0 || busy} onClick={() => move(idx, -1)}>↑</button>
                  <button className="icon-btn tiny" aria-label="Move down" disabled={idx === ranked.length - 1 || busy} onClick={() => move(idx, 1)}>↓</button>
                  <button className="link-btn" onClick={() => act(async () => {
                    await updatePriority(r.item.id, { status: 'done' })
                    openTransaction(null, { type: 'expense', amount: r.item.amount, description: r.item.name, necessity: r.item.necessity, is_planned: true })
                  })}>Paid for it</button>
                  <button className="link-btn" onClick={() => setEditing(r.item.id)}>Edit</button>
                  <button className="link-btn" onClick={() => act(() => updatePriority(r.item.id, { status: 'dropped' }))}>Drop</button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="inline-add">
        {editing !== 'new' && <button className="btn ghost" onClick={() => setEditing('new')}>+ Add to the list</button>}
        {anyManual && <button className="link-btn" disabled={busy} onClick={() => act(async () => { await Promise.all(ranked.map(r => updatePriority(r.item.id, { manual_rank: null }))) })}>Use suggested order</button>}
      </div>
      {editing === 'new' && <PriorityForm onDone={() => setEditing(null)} />}

      {closed.length > 0 && (
        <details className="card compact">
          <summary><strong>Done and dropped ({closed.length})</strong></summary>
          <ul className="plain-list">
            {closed.map(p => (
              <li key={p.id} className="row-between small">
                <span>{p.name} · {money(p.amount)} <span className="tag">{p.status}</span></span>
                <span>
                  <button className="link-btn" onClick={() => act(() => updatePriority(p.id, { status: 'open', manual_rank: null }))}>Back on the list</button>{' '}
                  <button className="link-btn danger-text" onClick={() => act(() => deletePriority(p.id))}>Delete</button>
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

function PriorityForm({ item, onDone }: { item?: Priority; onDone: () => void }) {
  const { currency, reload } = useData()
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState<number | null>(item?.amount ?? null)
  const [due, setDue] = useState(item?.due_date ?? '')
  const [necessity, setNecessity] = useState<'need' | 'want' | null>(item?.necessity ?? null)
  const [urgency, setUrgency] = useState(item?.urgency ?? 3)
  const [conseq, setConseq] = useState(item?.delay_consequence ?? 3)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('What is it?')
    if (amount == null || amount <= 0) return setError('How much does it cost?')
    if (!necessity) return setError('Is it a need or a want?')
    const input: PriorityInput = { name: name.trim().slice(0, 80), amount, due_date: due || null, necessity, urgency, delay_consequence: conseq }
    setBusy(true); setError('')
    try { item ? await updatePriority(item.id, input) : await insertPriority(input); await reload(); onDone() }
    catch (err) { setError(friendlyError((err as Error).message)); setBusy(false) }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>What is it?<input maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Laptop, school fees, new shoes" /></label>
      <div className="grid2">
        <label>Cost<MoneyInput value={amount} onChange={setAmount} currency={currency} /></label>
        <label>Due by <span className="muted small">(optional)</span><input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
      </div>
      <div className="field">
        <span className="field-label">Need or want?</span>
        <div className="segmented">
          <button type="button" className={necessity === 'need' ? 'on' : ''} onClick={() => setNecessity('need')}>Need</button>
          <button type="button" className={necessity === 'want' ? 'on' : ''} onClick={() => setNecessity('want')}>Want</button>
        </div>
      </div>
      <div className="field">
        <span className="field-label">How urgent?</span>
        <div className="segmented wrap">
          {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" className={urgency === n ? 'on' : ''} onClick={() => setUrgency(n)}>{URGENCY[n]}</button>)}
        </div>
      </div>
      <div className="field">
        <span className="field-label">What happens if it waits?</span>
        <div className="segmented wrap">
          {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" className={conseq === n ? 'on' : ''} onClick={() => setConseq(n)}>{CONSEQ[n]}</button>)}
        </div>
        <span className="muted small">Late fees, losing a place, something breaking down further, or nothing at all.</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="inline-add">
        <button className="btn primary" disabled={busy}>{item ? 'Save' : 'Add'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
