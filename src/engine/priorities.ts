// Scale of preference: "Given the money I have, what should I take care of first?"
// Ranked by necessity, consequences of delay, urgency and due date — never by price.
// Price only decides how far the available money stretches down the list.
import type { Priority } from '../lib/types'
import { daysBetween } from './dates'

export type RankedPriority = {
  item: Priority
  score: number
  suggestedRank: number
  reasons: string[]
  funding: 'covered' | 'partly' | 'not_yet'
  fundedAmount: number
}

const CONSEQUENCE = ['', 'nothing much happens if it waits', 'minor inconvenience if it waits', 'a real cost if it waits', 'serious consequences if it waits', 'severe consequences if it waits']

export function scorePriority(p: Priority, today: string): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0
  if (p.necessity === 'need') { score += 40; reasons.push('a need') } else reasons.push('a want')
  score += p.delay_consequence * 8
  reasons.push(CONSEQUENCE[p.delay_consequence] ?? '')
  score += p.urgency * 5
  if (p.urgency >= 4) reasons.push('marked urgent')
  if (p.due_date) {
    const d = daysBetween(today, p.due_date)
    if (d < 0) { score += 30; reasons.push(`overdue by ${-d} day${d === -1 ? '' : 's'}`) }
    else if (d <= 7) { score += 25; reasons.push(d === 0 ? 'due today' : `due in ${d} day${d === 1 ? '' : 's'}`) }
    else if (d <= 14) { score += 15; reasons.push(`due in ${d} days`) }
    else if (d <= 30) { score += 8; reasons.push(`due in ${d} days`) }
    else reasons.push('not due for a while')
  }
  return { score, reasons: reasons.filter(Boolean) }
}

/** Suggested order, then the user's manual positions on top, then how far the money goes. */
export function rankPriorities(items: Priority[], money: number, today: string): RankedPriority[] {
  const open = items.filter(p => p.status === 'open')
  const scored = open.map(p => ({ p, ...scorePriority(p, today) }))
    .sort((a, b) => b.score - a.score || (a.p.due_date ?? '9999').localeCompare(b.p.due_date ?? '9999') || a.p.created_at.localeCompare(b.p.created_at))
  const suggested = new Map(scored.map((x, i) => [x.p.id, i + 1]))

  // manual ranks pin items to a position; everything else fills the gaps in suggested order
  const pinned = scored.filter(x => x.p.manual_rank != null).sort((a, b) => a.p.manual_rank! - b.p.manual_rank!)
  const free = scored.filter(x => x.p.manual_rank == null)
  const ordered: typeof scored = []
  for (let pos = 1; ordered.length < scored.length; pos++) {
    const pin = pinned.find(x => x.p.manual_rank === pos)
    if (pin) ordered.push(pin)
    else if (free.length) ordered.push(free.shift()!)
    else ordered.push(...pinned.filter(x => !ordered.includes(x)))
  }

  let left = Math.max(money, 0)
  return ordered.map(x => {
    const funded = Math.min(left, x.p.amount)
    left -= funded
    return {
      item: x.p, score: x.score, suggestedRank: suggested.get(x.p.id)!, reasons: x.reasons,
      funding: funded >= x.p.amount ? 'covered' : funded > 0 ? 'partly' : 'not_yet',
      fundedAmount: funded,
    }
  })
}
