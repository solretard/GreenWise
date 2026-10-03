import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { AuthCard } from '../components/AuthCard'

export default function Signup() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (name.trim().length < 1) return setError('Tell us what to call you.')
    if (password.length < 8) return setError('Use at least 8 characters for your password.')
    if (password !== confirm) return setError('The two passwords don’t match.')
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim().slice(0, 100) }, emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) return setError(friendlyError(error.message))
    // Supabase returns a user with no identities when the email is already taken
    if (data.user && data.user.identities?.length === 0) return setError('An account with this email already exists. Try logging in.')
    if (!data.session) setSentTo(email.trim())
  }

  if (sentTo) {
    return (
      <AuthCard title="Check your email" subtitle={`We sent a confirmation link to ${sentTo}. Open it to activate your account, then log in.`}>
        <p className="links"><Link to="/login">Back to log in</Link></p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Create your account" subtitle="Your numbers stay private to you.">
      <form onSubmit={submit} className="form">
        <label>What should we call you?<input autoComplete="given-name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p className="links">Already have an account? <Link to="/login">Log in</Link></p>
    </AuthCard>
  )
}
