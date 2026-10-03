import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { computeInsights } from '../engine/insights'
import { addMonths, monthStart } from '../engine/dates'
import { formatMoney } from '../lib/format'
import { PageTitle } from '../components/Icon'

export default function Insights() {
  const { profile } = useAuth()
  const { snapshot: s, transactions, categories, obligations, debts, currency, dismissed, dismiss } = useData()
  const money = (n: number) => formatMoney(n, currency)

  const result = useMemo(() => s && profile ? computeInsights({
    snapshot: s, transactions, categories, obligations, debts, focus: profile.focus_areas ?? [],
    largePurchasePct: profile.alert_settings?.large_purchase_pct ?? 20, money,
  }) : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [s, transactions, categories, obligations, debts, profile, currency])

  // where the money went this month vs last month, top categories only
  const table = useMemo(() => {
    if (!s) return []
    const mStart = monthStart(s.today), prevStart = addMonths(mStart, -1)
    const prevSameDay = addMonths(s.today, -1)
    const rows = new Map<string, { now: number; prev: number }>()
    for (const t of transactions) {
      if (t.type !== 'expense' || !t.category_id) continue
      const r = rows.get(t.category_id) ?? { now: 0, prev: 0 }
      if (t.occurred_on >= mStart && t.occurred_on <= s.today) r.now += t.amount
      else if (t.occurred_on >= prevStart && t.occurred_on <= prevSameDay) r.prev += t.amount // same point last month, so it's fair
      rows.set(t.category_id, r)
    }
    const name = new Map(categories.map(c => [c.id, c.name]))
    return [...rows.entries()].filter(([, r]) => r.now > 0 || r.prev > 0)
      .map(([id, r]) => ({ name: name.get(id) ?? 'Other', ...r }))
      .sort((a, b) => b.now - a.now).slice(0, 6)
  }, [s, transactions, categories])

  if (!s || !result) return null
  const visible = result.insights.filter(x => !dismissed.has(`insight:${x.key}`))

  return (
    <section>
      <PageTitle icon="insights">Insights</PageTitle>
      <p className="muted small tight" style={{ marginBottom: '1rem' }}>Patterns in your spending that could lead to a better decision. Anything that wouldn't change what you do is left out.</p>

      {!result.enoughData ? (
        <div className="card empty">
          <p><strong>Not enough to go on yet.</strong></p>
          <p className="muted">Log a week or two of spending, including the small stuff, and patterns will start to show here.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="card empty"><p className="muted">Nothing worth flagging right now. Your spending looks steady.</p></div>
      ) : (
        <div className="stack">
          {visible.map(x => (
            <div key={x.key} className="card compact insight">
              <div className="row-between">
                <strong>{x.title}</strong>
                <button className="icon-btn tiny" aria-label={`Hide: ${x.title}`} title="Hide" onClick={() => dismiss(`insight:${x.key}`)}>×</button>
              </div>
              <p className="tight">{x.body}</p>
              <p className="insight-action tight"><span className="eyebrow">What you could do</span> {x.action}</p>
              {x.link && <Link to={x.link} className="small">Go there</Link>}
            </div>
          ))}
        </div>
      )}

      {table.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-head"><h2>Where it's going</h2><span className="muted small">this month vs same point last month</span></div>
          <table className="cat-table">
            <thead><tr><th>Category</th><th>This month</th><th>Last month</th><th>Change</th></tr></thead>
            <tbody>
              {table.map(r => {
                const diff = r.now - r.prev
                return (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{money(r.now)}</td>
                    <td className="muted">{money(r.prev)}</td>
                    <td className={diff > 0 ? 'warn-text' : diff < 0 ? 'pos' : 'muted'}>{diff === 0 ? '—' : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {s.income.minimumMonthly > 0 && (
            <p className="muted small tight">
              So far this month you've spent {money(s.month.spent)}, {Math.round((s.month.spent / s.income.minimumMonthly) * 100)}% of your {s.income.irregular ? 'minimum ' : ''}monthly income, with {Math.round(s.month.dayFraction * 100)}% of the month gone.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
