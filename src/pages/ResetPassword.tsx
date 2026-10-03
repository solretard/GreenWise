import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { AuthCard } from '../components/AuthCard'

export default function ResetPassword() {
  const { session, loading } = useAuth()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return <div className="center muted">Loading…</div>

  // The reset link signs the user in temporarily. No session = expired or bad link.
  if (!session) {
    return (
      <AuthCard title="Link expired" subtitle="This reset link is no longer valid. Request a new one.">
        <p className="links"><Link to="/forgot-password">Send a new link</Link></p>
      </AuthCard>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError('The two passwords don’t match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(friendlyError(error.message))
    nav('/', { replace: true })
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="form">
        <label>New password<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </AuthCard>
  )
}
