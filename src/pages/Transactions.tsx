import { useMemo, useState } from 'react'
import { useData } from '../data/DataProvider'
import { useTransactionSheet } from '../components/AppShell'
import { formatMoney, localToday } from '../lib/format'
import type { Transaction, TxType } from '../lib/types'
import { PageTitle } from '../components/Icon'

const FILTERS: { value: TxType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'savings', label: 'Savings' },
  { value: 'debt_repayment', label: 'Repayments' },
  { value: 'transfer', label: 'Transfers' },
]

const monthKey = (d: string) => d.slice(0, 7) // YYYY-MM

function shiftMonth(key: string, by: number) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function dayLabel(iso: string) {
  const today = localToday()
  const y = new Date(); y.setDate(y.getDate() - 1)
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
  if (iso === today) return 'Today'
  if (iso === yesterday) return 'Yesterday'
  const [yy, mm, dd] = iso.split('-').map(Number)
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function Transactions() {
  const { transactions, categories, goals, debts, currency } = useData()
  const { openTransaction } = useTransactionSheet()
  const [month, setMonth] = useState(monthKey(localToday()))
  const [filter, setFilter] = useState<TxType | 'all'>('all')
  const [query, setQuery] = useState('')

  const catName = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])
  const goalName = useMemo(() => new Map(goals.map(g => [g.id, g.name])), [goals])
  const debtName = useMemo(() => new Map(debts.map(d => [d.id, d.creditor])), [debts])

  const inMonth = useMemo(() => transactions.filter(t => monthKey(t.occurred_on) === month), [transactions, month])

  const totals = useMemo(() => {
    const sum = (type: TxType) => inMonth.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0)
    return { income: sum('income'), spent: sum('expense'), saved: sum('savings'), repaid: sum('debt_repayment') }
  }, [inMonth])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inMonth.filter(t =>
      (filter === 'all' || t.type === filter) &&
      (!q || (t.description ?? '').toLowerCase().includes(q) || (catName.get(t.category_id ?? '') ?? '').toLowerCase().includes(q)),
    )
  }, [inMonth, filter, query, catName])

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const t of shown) m.set(t.occurred_on, [...(m.get(t.occurred_on) ?? []), t])
    return [...m.entries()]
  }, [shown])

  const isCurrentMonth = month === monthKey(localToday())

  function title(t: Transaction) {
    if (t.description) return t.description
    if (t.type === 'savings') return t.goal_id ? `Saved for ${goalName.get(t.goal_id) ?? 'a goal'}` : 'Savings'
    if (t.type === 'debt_repayment') return `Repaid ${debtName.get(t.debt_id ?? '') ?? 'debt'}`
    if (t.type === 'transfer') return 'Transfer'
    return catName.get(t.category_id ?? '') ?? (t.type === 'income' ? 'Income' : 'Expense')
  }

  function subtitle(t: Transaction) {
    const bits: string[] = []
    if (t.type === 'expense' || t.type === 'income') { const c = catName.get(t.category_id ?? ''); if (c && c !== t.description) bits.push(c) }
    if (t.type === 'savings' && t.description && t.goal_id) bits.push(goalName.get(t.goal_id) ?? '')
    if (t.type === 'debt_repayment' && t.description) bits.push(debtName.get(t.debt_id ?? '') ?? '')
    if (t.type === 'transfer' && t.description) bits.push('Transfer')
    if (t.payment_method) bits.push(t.payment_method)
    return bits.filter(Boolean).join(' · ')
  }

  return (
    <section>
      <PageTitle icon="transactions" action={<button className="btn primary" onClick={() => openTransaction()}>+ Add transaction</button>}>Transactions</PageTitle>

      <div className="month-bar">
        <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
        <strong>{monthLabel(month)}</strong>
        <button className="icon-btn" aria-label="Next month" disabled={isCurrentMonth} onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
      </div>

      <div className="stat-row">
        <div className="stat"><span className="muted small">Came in</span><strong className="pos">{formatMoney(totals.income, currency)}</strong></div>
        <div className="stat"><span className="muted small">Spent</span><strong>{formatMoney(totals.spent, currency)}</strong></div>
        <div className="stat"><span className="muted small">Saved</span><strong>{formatMoney(totals.saved, currency)}</strong></div>
        <div className="stat"><span className="muted small">Repaid</span><strong>{formatMoney(totals.repaid, currency)}</strong></div>
      </div>

      <div className="toolbar">
        <div className="chips">
          {FILTERS.map(f => (
            <button key={f.value} className={`chip ${filter === f.value ? 'on' : ''}`} onClick={() => setFilter(f.value)}>{f.label}</button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Search" aria-label="Search transactions" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {groups.length === 0 ? (
        <div className="card empty">
          {inMonth.length === 0
            ? <><p><strong>Nothing recorded in {monthLabel(month)}.</strong></p><p className="muted">Log what you spend as you go. It takes a few seconds, and everything GreenWise tells you is built from it.</p>
                {isCurrentMonth && <button className="btn primary" onClick={() => openTransaction()}>+ Add your first transaction</button>}</>
            : <p className="muted">No transactions match.</p>}
        </div>
      ) : groups.map(([day, list]) => (
        <div key={day} className="tx-group">
          <div className="tx-day">
            <span>{dayLabel(day)}</span>
            <span className="muted small">
              {(() => { const out = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0); return out ? `${formatMoney(out, currency)} spent` : '' })()}
            </span>
          </div>
          <ul className="tx-list">
            {list.map(t => (
              <li key={t.id}>
                <button className="tx-row" onClick={() => openTransaction(t)}>
                  <span className={`tx-dot ${t.type}`} aria-hidden />
                  <span className="tx-main">
                    <span className="tx-title">{title(t)}</span>
                    <span className="tx-sub muted small">
                      {subtitle(t)}
                      {t.necessity === 'want' && <span className="tag">Want</span>}
                      {t.is_planned === false && <span className="tag warn">Unplanned</span>}
                      {t.source === 'bank' && <span className="tag">Bank</span>}
                    </span>
                  </span>
                  <span className={`tx-amount ${t.type === 'income' ? 'pos' : t.type === 'transfer' ? 'muted' : ''}`}>
                    {t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '−'}{formatMoney(t.amount, currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
