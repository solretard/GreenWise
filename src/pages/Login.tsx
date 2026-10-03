import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { AuthCard } from '../components/AuthCard'

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) return setError(friendlyError(error.message))
    nav('/', { replace: true })
  }

  return (
    <AuthCard title="Welcome back" subtitle="Log in to see where you stand.">
      <form onSubmit={submit} className="form">
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p className="links"><Link to="/forgot-password">Forgot password?</Link></p>
      <p className="links">New here? <Link to="/signup">Create an account</Link></p>
    </AuthCard>
  )
}
