import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from '../lib/supabase'

type AuthState = {
  session: Session | null
  profile: Profile | null
  loading: boolean      // true until we know who is signed in and have their profile
  profileError: boolean
  recovering: boolean   // true after opening a password-reset link
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const loadedFor = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string | undefined, silent = false) => {
    if (!userId) { loadedFor.current = null; setProfile(null); setProfileLoading(false); return }
    if (!silent) setProfileLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, currency, starting_balance, emergency_buffer, balance_as_of, focus_areas, alert_settings, onboarding_complete')
      .eq('id', userId)
      .single()
    setProfileError(!!error)
    if (error) console.error('profile load failed', error.message)
    setProfile(data ? { ...(data as Profile), starting_balance: Number(data.starting_balance), emergency_buffer: Number(data.emergency_buffer) } : null)
    loadedFor.current = userId
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session?.user.id)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
      setSession(s)
      const uid = s?.user.id ?? null
      // only reload the profile when the person changes, not on token refresh
      if (uid !== loadedFor.current) {
        if (uid) setProfileLoading(true)
        setTimeout(() => loadProfile(uid ?? undefined), 0)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const value: AuthState = {
    session,
    profile,
    loading: !authReady || profileLoading,
    profileError,
    recovering,
    refreshProfile: () => loadProfile(session?.user.id, true), // no loading screen
    signOut: async () => { await supabase.auth.signOut() },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
