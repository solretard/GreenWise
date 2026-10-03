// Date helpers that work on 'YYYY-MM-DD' strings in UTC, so timezones and
// daylight-saving can never shift a due date by a day.

export type Freq = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'one_off'

const toUTC = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const addDays = (iso: string, n: number) => fromUTC(toUTC(iso) + n * 86_400_000)
export const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / 86_400_000)

export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay)) // 31 Jan + 1 month = 28/29 Feb, then back to the 31st after
  return fromUTC(target.getTime())
}

/** The k-th occurrence (k = 0 is the anchor itself). Returns null past the end of a one-time item. */
export function occurrence(anchor: string, freq: Freq, k: number): string | null {
  switch (freq) {
    case 'once': case 'one_off': return k === 0 ? anchor : null
    case 'weekly': return addDays(anchor, 7 * k)
    case 'biweekly': return addDays(anchor, 14 * k)
    case 'monthly': return addMonths(anchor, k)
    case 'quarterly': return addMonths(anchor, 3 * k)
    case 'yearly': return addMonths(anchor, 12 * k)
  }
}

export const monthStart = (iso: string) => iso.slice(0, 8) + '01'
export const monthEnd = (iso: string) => addDays(addMonths(monthStart(iso), 1), -1)

/** Monday of the week containing iso. */
export function weekStart(iso: string): string {
  const dow = new Date(toUTC(iso)).getUTCDay() // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7))
}

/** Roughly how many times per month something with this frequency happens. */
export function perMonth(freq: Freq | 'irregular'): number {
  switch (freq) {
    case 'weekly': return 52 / 12
    case 'biweekly': return 26 / 12
    case 'monthly': case 'irregular': return 1
    case 'quarterly': return 1 / 3
    case 'yearly': return 1 / 12
    default: return 0
  }
}
