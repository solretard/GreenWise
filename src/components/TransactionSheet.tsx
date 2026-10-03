import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useData } from '../data/DataProvider'
import { MoneyInput } from './MoneyInput'
import { deleteTransaction, insertCategory, insertTransaction, updateTransaction } from '../lib/data'
import { friendlyError } from '../lib/supabase'
import { formatMoney, localToday } from '../lib/format'
import { debtRemaining, goalSaved } from '../lib/ledger'
import { PAYMENT_METHODS, TX_TYPES, type Transaction, type TxInput, type TxType } from '../lib/types'

const MAX_AMOUNT = 999_999_999_999

type Props = { existing?: Transaction | null; preset?: Partial<TxInput>; onClose: () => void }

export function TransactionSheet({ existing, preset, onClose }: Props) {
  const { categories, goals, debts, obligations, incomeSources, transactions, asOf, currency, reload, setCategories } = useData()
  const editing = !!existing
  const fromBank = existing?.source === 'bank'
  const init: Partial<TxInput> = existing ?? preset ?? {}

  const [type, setType] = useState<TxType>(init.type ?? 'expense')
  const [amount, setAmount] = useState<number | null>(init.amount ?? null)
  const [description, setDescription] = useState(init.description ?? '')
  const [categoryId, setCategoryId] = useState(init.category_id ?? '')
  const [necessity, setNecessity] = useState<'need' | 'want' | null>(init.necessity ?? null)
  const [planned, setPlanned] = useState<boolean | null>(init.is_planned ?? null)
  const [date, setDate] = useState(init.occurred_on ?? localToday())
  const [goalId, setGoalId] = useState(init.goal_id ?? '')
  const [debtId, setDebtId] = useState(init.debt_id ?? '')
  const [obligationId, setObligationId] = useState(init.obligation_id ?? '')
  const [incomeSourceId, setIncomeSourceId] = useState(init.income_source_id ?? '')
  const [paymentMethod, setPaymentMethod] = useState(existing?.payment_method ?? '')
  const [showMore, setShowMore] = useState(!!existing?.payment_method)
  const [newCat, setNewCat] = useState<{ name: string; essential: boolean } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const firstField = useRef<HTMLDivElement>(null)

  // focus the amount field when the sheet opens
  useEffect(() => { firstField.current?.querySelector('input')?.focus() }, [])

  // close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const kindCats = useMemo(
    () => categories.filter(c => !c.archived && c.kind === (type === 'income' ? 'income' : 'expense')),
    [categories, type],
  )
  const activeGoals = goals.filter(g => g.status === 'active' || g.id === existing?.goal_id)
  const activeDebts = debts.filter(d => d.status === 'active' || d.id === existing?.debt_id)
  const activeObligations = obligations.filter(o => o.active || o.id === existing?.obligation_id)
  const activeIncome = incomeSources.filter(i => i.active || i.id === existing?.income_source_id)

  // other transactions (exclude the one being edited so its old amount isn't counted twice)
  const others = useMemo(() => transactions.filter(t => t.id !== existing?.id), [transactions, existing])

  function pickType(t: TxType) {
    setType(t); setError('')
    if (t === 'income' || type === 'income') setCategoryId('')
    if (t === 'debt_repayment' && !debtId && activeDebts.length === 1) setDebtId(activeDebts[0].id)
    if (t === 'savings' && !goalId && activeGoals.length === 1) setGoalId(activeGoals[0].id)
  }

  function pickCategory(id: string) {
    setCategoryId(id)
    const c = categories.find(x => x.id === id)
    if (c && type === 'expense' && necessity == null) setNecessity(c.is_essential ? 'need' : 'want')
  }

  function pickObligation(id: string) {
    setObligationId(id)
    const o = obligations.find(x => x.id === id)
    if (!o) return
    if (amount == null) setAmount(o.amount)
    if (!description.trim()) setDescription(o.name)
    if (o.category_id) setCategoryId(o.category_id)
    setNecessity(o.is_essential ? 'need' : 'want')
    setPlanned(true) // a known regular payment is planned by definition
  }

  async function addCategory() {
    if (!newCat || !newCat.name.trim()) return
    const name = newCat.name.trim().slice(0, 40)
    const kind = type === 'income' ? 'income' : 'expense'
    if (categories.some(c => c.kind === kind && c.name.toLowerCase() === name.toLowerCase())) {
      return setError(`You already have a “${name}” category.`)
    }
    try {
      const c = await insertCategory(name, kind, newCat.essential)
      setCategories([...categories, c].sort((a, b) => a.name.localeCompare(b.name)))
      pickCategory(c.id)
      setNewCat(null); setError('')
    } catch (e) {
      setError(friendlyError((e as Error).message))
    }
  }

  function categoryFor(t: TxType): string | null {
    if (t === 'savings') return categories.find(c => c.kind === 'expense' && c.name === 'Savings')?.id ?? null
    if (t === 'debt_repayment') return categories.find(c => c.kind === 'expense' && c.name === 'Debt')?.id ?? null
    if (t === 'transfer') return null
    return categoryId || null
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (amount == null || amount <= 0) return setError('Enter an amount.')
    if (amount > MAX_AMOUNT) return setError('That amount is too large.')
    if (!date) return setError('Pick a date.')
    if (type === 'expense') {
      if (!categoryId) return setError('Pick a category.')
      if (!necessity) return setError('Was it a need or a want?')
      if (planned == null) return setError('Was it planned or unplanned?')
    }
    if (type === 'income' && !categoryId) return setError('Pick what kind of income this is.')
    if (type === 'debt_repayment' && !debtId) return setError('Which debt did you pay?')

    const input: TxInput = {
      type,
      amount,
      description: description.trim().slice(0, 200) || null,
      category_id: categoryFor(type),
      occurred_on: date,
      necessity: type === 'expense' ? necessity : null,
      is_planned: type === 'expense' ? planned : null,
      payment_method: paymentMethod || null,
      goal_id: type === 'savings' ? goalId || null : null,
      debt_id: type === 'debt_repayment' ? debtId || null : null,
      obligation_id: type === 'expense' ? obligationId || null : null,
      income_source_id: type === 'income' ? incomeSourceId || null : null,
    }

    setBusy(true)
    try {
      if (editing) {
        // a bank-imported row keeps the bank's amount and date; only labels can change
        const patch: Partial<TxInput> = fromBank ? { ...input, amount: existing!.amount, occurred_on: existing!.occurred_on, type: existing!.type } : input
        await updateTransaction(existing!.id, patch)
      } else {
        await insertTransaction(input)
      }
      await reload()
      onClose()
    } catch (err) {
      setBusy(false)
      setError(friendlyError((err as Error).message))
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteTransaction(existing!.id)
      await reload()
      onClose()
    } catch (err) {
      setBusy(false)
      setError(friendlyError((err as Error).message))
    }
  }

  // ----- live impact lines -----
  const goal = goals.find(g => g.id === goalId)
  const debt = debts.find(d => d.id === debtId)
  const counts = date >= asOf
  let impact = ''
  if (type === 'savings' && goal && amount) {
    const before = goalSaved(goal, others, asOf)
    const after = counts ? before + amount : before
    impact = `${goal.name}: ${formatMoney(before, currency)} → ${formatMoney(after, currency)} of ${formatMoney(goal.target_amount, currency)}`
    if (after >= goal.target_amount) impact += '. That reaches your target!'
  }
  if (type === 'debt_repayment' && debt && amount) {
    const before = debtRemaining(debt, others, asOf)
    const after = counts ? Math.max(before - amount, 0) : before
    impact = `${debt.creditor}: ${formatMoney(before, currency)} left → ${formatMoney(after, currency)}`
    if (counts && amount > before) impact += `. This is ${formatMoney(amount - before, currency)} more than you owe.`
    else if (after === 0) impact += '. Paid off!'
  }

  const title = editing ? 'Edit transaction' : 'Add transaction'
  const typeInfo = TX_TYPES.find(t => t.value === type)!

  return (
    <div className="sheet-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
        </div>

        <form onSubmit={submit} className="form">
          {fromBank && <p className="note">This came from your bank, so the amount and date can’t be changed. You can still change the labels.</p>}

          <div className="segmented wrap" role="radiogroup" aria-label="Type">
            {TX_TYPES.map(t => (
              <button key={t.value} type="button" role="radio" aria-checked={type === t.value}
                className={type === t.value ? 'on' : ''} disabled={fromBank} onClick={() => pickType(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          {type === 'transfer' && <p className="muted small" style={{ margin: 0 }}>{typeInfo.hint}</p>}

          <div ref={firstField} className="amount-field">
            <MoneyInput value={amount} onChange={setAmount} currency={currency} />
          </div>

          {type === 'expense' && activeObligations.length > 0 && !editing && (
            <label>Is this one of your regular payments? <span className="muted small">(optional)</span>
              <select value={obligationId} onChange={e => pickObligation(e.target.value)}>
                <option value="">No</option>
                {activeObligations.map(o => <option key={o.id} value={o.id}>{o.name} · {formatMoney(o.amount, currency)}</option>)}
              </select>
            </label>
          )}

          <label>{type === 'income' ? 'What was it from?' : type === 'savings' ? 'Note' : 'What was it for?'} {type !== 'expense' && <span className="muted small">(optional)</span>}
            <input maxLength={200} value={description} onChange={e => setDescription(e.target.value)}
              placeholder={type === 'expense' ? 'e.g. Lunch at Item 7' : type === 'income' ? 'e.g. September salary' : ''} />
          </label>

          {(type === 'expense' || type === 'income') && (
            <div className="field">
              <span className="field-label">{type === 'income' ? 'Kind of income' : 'Category'}</span>
              <div className="chips">
                {kindCats.map(c => (
                  <button key={c.id} type="button" className={`chip ${categoryId === c.id ? 'on' : ''}`} onClick={() => pickCategory(c.id)}>{c.name}</button>
                ))}
                {!newCat && <button type="button" className="chip dashed" onClick={() => setNewCat({ name: '', essential: false })}>+ New</button>}
              </div>
              {newCat && (
                <div className="inline-add">
                  <input autoFocus maxLength={40} placeholder="Category name" value={newCat.name}
                    onChange={e => setNewCat({ ...newCat, name: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory() } }} />
                  {type === 'expense' && (
                    <label className="check"><input type="checkbox" checked={newCat.essential} onChange={e => setNewCat({ ...newCat, essential: e.target.checked })} />Essential</label>
                  )}
                  <button type="button" className="btn primary small-btn" onClick={addCategory}>Add</button>
                  <button type="button" className="btn small-btn" onClick={() => setNewCat(null)}>Cancel</button>
                </div>
              )}
            </div>
          )}

          {type === 'expense' && (
            <div className="grid2">
              <div className="field">
                <span className="field-label">Need or want?</span>
                <div className="segmented" role="radiogroup" aria-label="Need or want">
                  <button type="button" role="radio" aria-checked={necessity === 'need'} className={necessity === 'need' ? 'on' : ''} onClick={() => setNecessity('need')}>Need</button>
                  <button type="button" role="radio" aria-checked={necessity === 'want'} className={necessity === 'want' ? 'on' : ''} onClick={() => setNecessity('want')}>Want</button>
                </div>
              </div>
              <div className="field">
                <span className="field-label">Planned?</span>
                <div className="segmented" role="radiogroup" aria-label="Planned or unplanned">
                  <button type="button" role="radio" aria-checked={planned === true} className={planned === true ? 'on' : ''} onClick={() => setPlanned(true)}>Planned</button>
                  <button type="button" role="radio" aria-checked={planned === false} className={planned === false ? 'on' : ''} onClick={() => setPlanned(false)}>Unplanned</button>
                </div>
              </div>
            </div>
          )}

          {type === 'savings' && (
            <label>Towards which goal?
              <select value={goalId} onChange={e => setGoalId(e.target.value)}>
                <option value="">General savings (no goal)</option>
                {activeGoals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}

          {type === 'debt_repayment' && (
            activeDebts.length === 0
              ? <p className="note">You haven’t added any debts. You can add them in the Debts section.</p>
              : (
                <label>Which debt?
                  <select value={debtId} onChange={e => setDebtId(e.target.value)}>
                    <option value="">Choose…</option>
                    {activeDebts.map(d => <option key={d.id} value={d.id}>{d.creditor}</option>)}
                  </select>
                </label>
              )
          )}

          {type === 'income' && activeIncome.length > 1 && (
            <label>Which income source? <span className="muted small">(optional)</span>
              <select value={incomeSourceId} onChange={e => setIncomeSourceId(e.target.value)}>
                <option value="">Not linked</option>
                {activeIncome.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
          )}

          {impact && <p className="note">{impact}</p>}

          <label>Date
            <input type="date" value={date} max={localToday()} disabled={fromBank} onChange={e => setDate(e.target.value)} />
          </label>
          {!counts && (
            <p className="muted small" style={{ margin: 0 }}>
              This is before you set up GreenWise, so your starting numbers already include it. It will show in your history but won’t change your balances.
            </p>
          )}

          {!showMore ? (
            <button type="button" className="link-btn" onClick={() => setShowMore(true)}>+ Payment method</button>
          ) : (
            <label>Paid with <span className="muted small">(optional)</span>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                <option value="">Not set</option>
                {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
          )}

          {error && <p className="error" role="alert">{error}</p>}

          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add'}</button>

          {editing && !confirmDelete && (
            <button type="button" className="btn danger-outline" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete transaction</button>
          )}
          {editing && confirmDelete && (
            <div className="confirm-row">
              <span>Delete this for good?</span>
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep</button>
              <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete</button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
