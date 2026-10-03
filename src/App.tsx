import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth/AuthProvider'
import { AppShell } from './components/AppShell'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Home from './pages/Home'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding'
import Transactions from './pages/Transactions'
import Plan from './pages/Plan'
import Decisions from './pages/Decisions'
import Debts from './pages/Debts'
import Insights from './pages/Insights'
import { DataProvider } from './data/DataProvider'

function RequireAuth({ children, onboarding = false }: { children: ReactNode; onboarding?: boolean }) {
  const { session, profile, loading, profileError, recovering, refreshProfile } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="center muted">Loading…</div>
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (recovering) return <Navigate to="/reset-password" replace />
  if (!profile) {
    return (
      <div className="center">
        <div className="card" style={{ maxWidth: 360, textAlign: 'center' }}>
          <p>{profileError ? 'We couldn’t load your account. Check your connection.' : 'Loading…'}</p>
          <button className="btn primary" onClick={refreshProfile}>Try again</button>
        </div>
      </div>
    )
  }
  // new users go through onboarding first; finished users can't redo it by accident
  if (!profile.onboarding_complete && !onboarding) return <Navigate to="/onboarding" replace />
  if (profile.onboarding_complete && onboarding) return <Navigate to="/" replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (session) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<RequireAuth onboarding><Onboarding /></RequireAuth>} />
      <Route element={<RequireAuth><DataProvider><AppShell /></DataProvider></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="plan" element={<Plan />} />
        <Route path="decisions" element={<Decisions />} />
        <Route path="debts" element={<Debts />} />
        <Route path="insights" element={<Insights />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
