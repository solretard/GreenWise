import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { useTransactionSheet } from '../components/AppShell'
import { formatMoney } from '../lib/format'
import { daysBetween } from '../engine/dates'
import { FeatureIcon } from '../components/Icon'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function fmtDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function inDays(today: string, iso: string) {
  const n = daysBetween(today, iso)
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} late`
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  return `in ${n} days`
}

export default function Home() {
  const { profile } = useAuth()
  const { snapshot: s, transactions, categories, decisions, currency, dismiss } = useData()
  const { openTransaction } = useTransactionSheet()
  const [showHow, setShowHow] = useState(false)
  if (!s || !profile) return null

  const money = (n: number) => formatMoney(n, currency)
  const first = profile.full_name?.split(' ')[0]
  const catName = new Map(categories.map(c => [c.id, c.name]))
  const recent = transactions.slice(0, 5)
  const focus = new Set(profile.focus_areas ?? [])
  const untilText = s.hasPayday ? 'until payday' : 'over the next 30 days'
  const committed = s.reserved.overdue + s.reserved.obligations + s.reserved.debts + s.reserved.savings + s.reserved.buffer
  const spendTotal = s.month.needs + s.month.wants

  const goalsCard = s.goals.length > 0 && (
    <div className="card area-goals" key="goals">
      <div className="card-head"><h2 className="h-icon"><FeatureIcon name="plan" size="sm" />Savings goals</h2><Link to="/plan" className="small">Manage</Link></div>
      <div className="stack">
        {s.goals.map(g => (
          <div key={g.goal.id}>
            <div className="row-between">
              <strong>{g.goal.name}</strong>
              <span className="small">{money(g.saved)} <span className="muted">of {money(g.goal.target_amount)}</span></span>
            </div>
            <div className="bar"><div className={`bar-fill ${g.onTrack === false ? 'warn' : ''}`} style={{ width: `${Math.round(g.pct * 100)}%` }} /></div>
            <p className="muted small tight">
              {g.remaining <= 0 ? 'Target reached.'
                : g.suggestedMonthly ? `Save about ${money(g.suggestedMonthly)} a month to reach it by ${fmtDay(g.goal.deadline!)}.${g.onTrack === false ? ' Behind schedule.' : ''}`
                : `${money(g.remaining)} to go.`}
            </p>
          </div>
        ))}
      </div>
    </div>
  )

  const activeDebts = s.debts.items.filter(d => d.debt.status === 'active')
  const debtsCard = activeDebts.length > 0 && (
    <div className="card area-debts" key="debts">
      <div className="card-head"><h2 className="h-icon"><FeatureIcon name="debts" size="sm" />Debts</h2><Link to="/debts" className="small">Details</Link></div>
      <div className="row-between">
        <span className="muted small">Still owed</span>
        <strong>{money(s.debts.totalRemaining)}</strong>
      </div>
      <div className="bar"><div className="bar-fill" style={{ width: `${s.debts.totalOpening ? Math.round((1 - s.debts.totalRemaining / s.debts.totalOpening) * 100) : 100}%` }} /></div>
      <ul className="plain-list">
        {activeDebts.map(d => (
          <li key={d.debt.id} className="row-between small">
            <span>{d.debt.creditor}</span>
            <span>{d.remaining <= 0 ? 'Paid off' : `${money(d.remaining)} left`}</span>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <section className={`home ${focus.has('debt') ? 'focus-debt' : ''}`}>
      <header className="greeting area-greeting">
        <h1 className="greeting-title">
          <span className="greeting-hello">{greeting()}{first ? ',' : ''}</span>
          {first && <span className="greeting-name">{first}</span>}
        </h1>
        <p className="greeting-date">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </header>

      <div className="home-main">
        {/* ---------- 1. how am I doing ---------- */}
        <div className={`card hero area-hero ${s.shortfall > 0 ? 'hero-short' : ''}`}>
          <div className="hero-top">
            <div className="hero-main">
              <span className="hero-label">Safe to spend</span>
              <div className="hero-amount">{money(s.safeToSpend)}</div>
              <p className="hero-sub">
                {s.shortfall > 0
                  ? <>You're <strong>{money(s.shortfall)}</strong> short of what's due {s.hasPayday ? 'before payday' : 'in the next 30 days'}.</>
                  : <>About <strong>{money(s.perDay)}</strong> a day {untilText}.</>}
              </p>
            </div>
            <div className="payday-box">
              <span className="payday-label">Next payday</span>
              {s.hasPayday ? (
                <>
                  <strong className="payday-date">{fmtDay(s.windowEnd)}</strong>
                  <span className="payday-in">{inDays(s.today, s.windowEnd)}</span>
                </>
              ) : (
                <>
                  <strong className="payday-date">No fixed payday</strong>
                  <span className="payday-in">Your income is irregular, so GreenWise plans 30 days ahead.</span>
                </>
              )}
            </div>
          </div>
          <button className="link-btn" onClick={() => setShowHow(v => !v)} aria-expanded={showHow}>
            {showHow ? 'Hide' : 'How is this worked out?'}
          </button>
          {showHow && (
            <div className="breakdown">
              {s.breakdown.map(l => (
                <div key={l.label} className="breakdown-row">
                  <span>{l.label}{l.detail && <span className="muted small block">{l.detail}</span>}</span>
                  <span className={l.amount < 0 ? '' : 'pos'}>{l.amount < 0 ? '−' : ''}{money(Math.abs(l.amount))}</span>
                </div>
              ))}
              <div className="breakdown-row total">
                <span>Safe to spend</span><span>{money(s.safeToSpend)}</span>
              </div>
              <p className="muted small tight">
                Your balance isn't the same as what you can spend. GreenWise first sets aside {money(committed)} for what's already committed{s.hasPayday ? ' until your next payday' : ''}, then shows you what's left.
                {s.income.irregular && ` Your income changes, so nothing you haven't received yet is counted.`}
              </p>
            </div>
          )}
          <div className="hero-stats">
            <div><span className="muted small">Money you have</span><strong>{money(s.available)}</strong></div>
            <div><span className="muted small">Came in this month</span><strong>{money(s.month.income)}</strong></div>
            <div><span className="muted small">Spent this month</span><strong>{money(s.month.spent)}</strong></div>
          </div>
        </div>

        {/* ---------- 3. what should I do next ---------- */}
        <div className="card next-step area-next">
          <span className="eyebrow">Next step</span>
          <p>{s.nextStep}</p>
        </div>

        {/* ---------- 2. what needs attention ---------- */}
        <div className="card area-attention">
          <div className="card-head"><h2>Needs attention</h2>{s.alerts.length > 0 && <span className="count-pill">{s.alerts.length}</span>}</div>
          {s.alerts.length === 0 ? (
            <p className="muted tight">Nothing needs your attention right now.</p>
          ) : (
            <ul className="alert-list">
              {s.alerts.slice(0, 5).map(a => (
                <li key={a.key} className={`alert ${a.severity}`}>
                  <div className="alert-text">
                    <strong>{a.title}</strong>
                    <p>{a.body}</p>
                    {a.link && <Link to={a.link} className="small">Open {a.link.slice(1)}</Link>}
                  </div>
                  <button className="icon-btn" aria-label={`Dismiss: ${a.title}`} title="Dismiss" onClick={() => dismiss(a.key)}>×</button>
                </li>
              ))}
            </ul>
          )}
          {s.alerts.length > 5 && <p className="muted small tight">+{s.alerts.length - 5} more</p>}
        </div>

        {/* ---------- spending behaviour ---------- */}
        <div className="card area-spending">
          <div className="card-head"><h2 className="h-icon"><FeatureIcon name="insights" size="sm" />This month's spending</h2><Link to="/transactions" className="small">See all</Link></div>
          {spendTotal === 0 ? (
            <p className="muted tight">No spending recorded this month yet.</p>
          ) : (
            <>
              <div className="split-bar" role="img" aria-label={`Needs ${money(s.month.needs)}, wants ${money(s.month.wants)}`}>
                <div className="split-needs" style={{ width: `${(s.month.needs / spendTotal) * 100}%` }} />
                <div className="split-wants" style={{ width: `${(s.month.wants / spendTotal) * 100}%` }} />
              </div>
              <div className="row-between small">
                <span><span className="dot needs" /> Needs {money(s.month.needs)}</span>
                <span><span className="dot wants" /> Wants {money(s.month.wants)}</span>
              </div>
              <p className="muted small tight">
                {s.month.unplannedCount === 0 ? 'No unplanned purchases this month.'
                  : `${s.month.unplannedCount} unplanned purchase${s.month.unplannedCount === 1 ? '' : 's'} this month, ${money(s.month.unplannedAmount)} in total.`}
                {s.income.minimumMonthly > 0 && ` That's ${Math.round((s.month.spent / s.income.minimumMonthly) * 100)}% of your ${s.income.irregular ? 'minimum ' : ''}monthly income, with ${s.month.daysLeft} days left.`}
              </p>
            </>
          )}
        </div>

        {/* ---------- recent ---------- */}
        <div className="card area-recent">
          <div className="card-head">
            <h2 className="h-icon"><FeatureIcon name="transactions" size="sm" />Recent</h2>
            <button className="btn primary small-btn" onClick={() => openTransaction()}>+ Add</button>
          </div>
          {recent.length === 0 ? <p className="muted tight">Nothing logged yet.</p> : (
            <ul className="tx-list">
              {recent.map(t => (
                <li key={t.id}>
                  <button className="tx-row" onClick={() => openTransaction(t)}>
                    <span className={`tx-dot ${t.type}`} aria-hidden />
                    <span className="tx-main">
                      <span className="tx-title">{t.description || catName.get(t.category_id ?? '') || t.type.replace('_', ' ')}</span>
                      <span className="tx-sub muted small">{fmtDay(t.occurred_on)}</span>
                    </span>
                    <span className={`tx-amount ${t.type === 'income' ? 'pos' : ''}`}>{t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '−'}{money(t.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <aside className="home-side">
        {/* ---------- upcoming ---------- */}
        <div className="card area-upcoming">
          <div className="card-head"><h2>Upcoming</h2><span className="muted small">next 30 days</span></div>
          {s.upcoming.length === 0 && !s.hasPayday ? (
            <p className="muted tight">No bills or repayments due. Add regular payments in Plan so GreenWise can set money aside for them.</p>
          ) : (
            <ul className="plain-list">
              {s.upcoming.map(u => (
                <li key={u.key} className="due-row">
                  <span className="due-main">
                    <span className="due-name">{u.name}{u.overdue && <span className="tag danger">Overdue</span>}</span>
                    <span className="due-date">{fmtDay(u.due)}</span>
                  </span>
                  <span className="due-amount">{money(u.amount)}<span className="muted small block">{inDays(s.today, u.due)}</span></span>
                </li>
              ))}
              {s.hasPayday && (
                <li className="due-row payday">
                  <span className="due-main">
                    <span className="due-name">Payday</span>
                    <span className="due-date">{fmtDay(s.windowEnd)}</span>
                  </span>
                  <span className="due-amount muted small">{inDays(s.today, s.windowEnd)}</span>
                </li>
              )}
            </ul>
          )}
        </div>


        {/* ---------- decisions waiting on you ---------- */}
        {(() => {
          const pending = decisions.filter(d => d.outcome === 'pending').slice(0, 2)
          return (
            <div className="card area-decisions">
              <div className="card-head"><h2 className="h-icon"><FeatureIcon name="decisions" size="sm" />Decisions</h2><Link to="/decisions" className="small">Check a purchase</Link></div>
              {pending.length === 0 ? (
                <p className="muted tight">Thinking of buying something? Check it first to see if you can afford it, and whether you should.</p>
              ) : (
                <ul className="plain-list">
                  {pending.map(d => {
                    const r = d.result as { headline?: string; advice?: string }
                    return (
                      <li key={d.id} className="pending-decision">
                        <strong>You're considering {d.item} ({money(d.price)})</strong>
                        <p className="small tight">{r.headline} {r.advice}</p>
                        <Link to="/decisions" className="small">Decide</Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })()}

        {goalsCard}
        {debtsCard}
      </aside>
    </section>
  )
}
