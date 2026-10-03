import { useEffect, useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { PageTitle } from '../components/Icon'

const CURRENCIES = ['NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'EUR']
const FOCUS: { value: string; label: string }[] = [
  { value: 'impulse', label: 'Stop impulse buying' },
  { value: 'overspending', label: 'Control overspending' },
  { value: 'save_more', label: 'Save more' },
  { value: 'debt', label: 'Manage debt' },
  { value: 'irregular_income', label: 'Plan irregular income' },
  { value: 'goal', label: 'Reach a specific goal' },
]

export default function Settings() {
  const { session, profile, signOut } = useAuth()
  return (
    <section>
      <PageTitle icon="settings">Settings</PageTitle>
      {profile && <ProfileCard key={`p-${profile.full_name}-${profile.currency}`} />}
      {profile && <AlertCard key={`a-${JSON.stringify(profile.alert_settings)}-${profile.focus_areas?.join()}`} />}
      <div className="card">
        <p className="muted small tight" style={{ marginTop: 0 }}>Signed in as {session?.user.email}</p>
        <button className="btn" style={{ marginTop: '.75rem' }} onClick={signOut}>Log out</button>
      </div>
    </section>
  )
}

function ProfileCard() {
  const { session, profile, refreshProfile } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [currency, setCurrency] = useState(profile?.currency ?? 'NGN')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setMsg(''); setError(''); setBusy(true)
    const { error } = await supabase.from('profiles')
      .update({ full_name: name.trim().slice(0, 100) || null, currency })
      .eq('id', session!.user.id)
    setBusy(false)
    if (error) return setError(friendlyError(error.message))
    await refreshProfile()
    setMsg('Saved.')
  }

  return (
    <div className="card">
      <h2>Profile</h2>
      <form onSubmit={save} className="form">
        <label>Name<input maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>Currency
          <select value={currency} onChange={e => setCurrency(e.target.value)}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        {msg && <p className="success">{msg}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </div>
  )
}

function AlertCard() {
  const { session, profile, refreshProfile } = useAuth()
  const a = profile?.alert_settings ?? { budget_warn_pct: 80, unplanned_per_week: 5, large_purchase_pct: 20 }
  const [warn, setWarn] = useState(String(a.budget_warn_pct))
  const [unplanned, setUnplanned] = useState(String(a.unplanned_per_week))
  const [large, setLarge] = useState(String(a.large_purchase_pct))
  const [focus, setFocus] = useState<string[]>(profile?.focus_areas ?? [])
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setMsg(''), [warn, unplanned, large, focus])

  async function save(e: FormEvent) {
    e.preventDefault()
    const w = Number(warn), u = Number(unplanned), l = Number(large)
    if (!Number.isInteger(w) || w < 50 || w > 100) return setError('Budget warning should be between 50% and 100%.')
    if (!Number.isInteger(u) || u < 1 || u > 50) return setError('Unplanned purchases per week should be between 1 and 50.')
    if (!Number.isInteger(l) || l < 5 || l > 100) return setError('Large purchase should be between 5% and 100% of income.')
    setBusy(true); setError('')
    const { error } = await supabase.from('profiles')
      .update({ alert_settings: { budget_warn_pct: w, unplanned_per_week: u, large_purchase_pct: l }, focus_areas: focus })
      .eq('id', session!.user.id)
    setBusy(false)
    if (error) return setError(friendlyError(error.message))
    await refreshProfile()
    setMsg('Saved. Your alerts and insights now use these settings.')
  }

  return (
    <div className="card">
      <h2>Alerts and focus</h2>
      <form onSubmit={save} className="form">
        <div className="field">
          <span className="field-label">What do you want GreenWise to help with?</span>
          <div className="chips">
            {FOCUS.map(f => {
              const on = focus.includes(f.value)
              return <button type="button" key={f.value} className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => setFocus(l => on ? l.filter(x => x !== f.value) : [...l, f.value])}>{f.label}</button>
            })}
          </div>
          <span className="muted small">Alerts and insights about these come first. Choosing “Stop impulse buying” also makes the unplanned-purchase alert stricter (3 a week).</span>
        </div>
        <div className="grid3">
          <label>Warn me when a budget reaches
            <span className="suffix-input"><input inputMode="numeric" value={warn} onChange={e => setWarn(e.target.value.replace(/\D/g, ''))} /><span>%</span></span>
          </label>
          <label>Flag unplanned purchases after
            <span className="suffix-input"><input inputMode="numeric" value={unplanned} onChange={e => setUnplanned(e.target.value.replace(/\D/g, ''))} /><span>a week</span></span>
          </label>
          <label>Count a purchase as large above
            <span className="suffix-input"><input inputMode="numeric" value={large} onChange={e => setLarge(e.target.value.replace(/\D/g, ''))} /><span>% of income</span></span>
          </label>
        </div>
        <p className="muted small tight">Alerts are worked out again every time your data changes, and show on Home when you open the app. Email and phone notifications are planned for a later version.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {msg && <p className="success">{msg}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save alert settings'}</button>
      </form>
    </div>
  )
}
