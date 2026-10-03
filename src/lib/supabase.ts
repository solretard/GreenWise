import { createClient } from '@supabase/supabase-js'

// Both values are public by design (the publishable key only "opens the lobby").
// Never put the sb_secret_ key anywhere in this app.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://ypvqqpovkbtdeztnnkuk.supabase.co'
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? 'sb_publishable_pD8_6nPmOIIP_hC9dybdDQ_yqmLKTRp'

// Only the publishable key lives here. Row level security in the database
// decides what each signed-in user can read or change.
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
})

export type Profile = {
  id: string
  full_name: string | null
  currency: string
  starting_balance: number
  emergency_buffer: number
  balance_as_of: string
  focus_areas: string[]
  alert_settings: { budget_warn_pct: number; unplanned_per_week: number; large_purchase_pct: number }
  onboarding_complete: boolean
}

// Turn Supabase's technical errors into plain sentences.
export function friendlyError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'That email and password don’t match.'
  if (m.includes('email not confirmed')) return 'Please confirm your email first. Check your inbox for the link.'
  if (m.includes('already registered')) return 'An account with this email already exists. Try logging in.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a few minutes and try again.'
  if (m.includes('password should be')) return 'That password is too short or too simple.'
  if (m.includes('same password') || m.includes('different from the old')) return 'Choose a password different from your old one.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Can’t reach GreenWise. Check your internet connection.'
  return message
}
