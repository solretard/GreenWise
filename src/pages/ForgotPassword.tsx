import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { AuthCard } from '../components/AuthCard'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (error) return setError(friendlyError(error.message))
    setSent(true)
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle="If an account exists for that email, a reset link is on its way. It expires in an hour.">
        <p className="links"><Link to="/login">Back to log in</Link></p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we’ll send you a link.">
      <form onSubmit={submit} className="form">
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <p className="links"><Link to="/login">Back to log in</Link></p>
    </AuthCard>
  )
}
