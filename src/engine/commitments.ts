// Tracks each commitment against what has actually happened.
import type { Commitment, Transaction } from '../lib/types'
import { daysBetween } from './dates'

export type CommitmentStatus = {
  commitment: Commitment
  state: 'on_track' | 'at_risk' | 'broken' | 'kept' | 'missed'
  progress: number          // spent, saved or count of unplanned purchases so far
  target: number            // limit, savings target, or 0 for no_unplanned
  projected: number         // where the current pace ends up by the end date
  finished: boolean         // end date has passed
  message: string
}

export function trackCommitments(
  commitments: Commitment[], transactions: Transaction[], today: string,
  money: (n: number) => string, categoryName: (id: string | null) => string,
): CommitmentStatus[] {
  return commitments.filter(c => c.status === 'active').map(c => {
    const end = c.end_date
    const finished = today > end
    const until = finished ? end : today
    const inRange = transactions.filter(t => t.occurred_on >= c.start_date && t.occurred_on <= until)
    const totalDays = daysBetween(c.start_date, end) + 1
    const elapsed = Math.min(Math.max(daysBetween(c.start_date, until) + 1, 1), totalDays)
    const left = Math.max(daysBetween(today, end), 0)
    const r = Math.round

    if (c.kind === 'spend_limit') {
      const limit = c.amount ?? 0
      const spent = inRange
        .filter(t => t.type === 'expense' && (c.category_id ? t.category_id === c.category_id : t.necessity === 'want'))
        .reduce((s, t) => s + t.amount, 0)
      const projected = r((spent / elapsed) * totalDays)
      const what = c.category_id ? categoryName(c.category_id).toLowerCase() : 'wants'
      let state: CommitmentStatus['state']; let message: string
      if (spent > limit) {
        state = 'broken'
        message = `You've spent ${money(spent)} on ${what}, ${money(spent - limit)} over your ${money(limit)} commitment.`
      } else if (finished) {
        state = 'kept'
        message = `Kept. You spent ${money(spent)} of ${money(limit)} on ${what}.`
      } else if (elapsed >= 3 && projected > limit) {
        state = 'at_risk'
        message = `You're on pace to exceed your ${what} commitment by ${money(projected - limit)}. ${money(limit - spent)} left for ${left} day${left === 1 ? '' : 's'}.`
      } else {
        state = 'on_track'
        message = `${money(spent)} of ${money(limit)} used. ${money(limit - spent)} left for ${left} day${left === 1 ? '' : 's'}.`
      }
      return { commitment: c, state, progress: spent, target: limit, projected, finished, message }
    }

    if (c.kind === 'save_target') {
      const target = c.amount ?? 0
      const saved = inRange
        .filter(t => t.type === 'savings' && (!c.goal_id || t.goal_id === c.goal_id))
        .reduce((s, t) => s + t.amount, 0)
      const projected = r((saved / elapsed) * totalDays)
      const expectedByNow = target * (elapsed / totalDays)
      let state: CommitmentStatus['state']; let message: string
      if (saved >= target) {
        state = 'kept'
        message = `Done. You saved ${money(saved)} towards your ${money(target)} target.`
      } else if (finished) {
        state = 'missed'
        message = `Ended ${money(target - saved)} short. You saved ${money(saved)} of ${money(target)}.`
      } else if (elapsed >= 3 && saved < expectedByNow * 0.8) {
        state = 'at_risk'
        message = `${money(saved)} saved so far. You need ${money(target - saved)} more in ${left} day${left === 1 ? '' : 's'}, about ${money((target - saved) / Math.max(left, 1) * 7)} a week.`
      } else {
        state = 'on_track'
        message = `${money(saved)} of ${money(target)} saved. ${money(target - saved)} to go in ${left} day${left === 1 ? '' : 's'}.`
      }
      return { commitment: c, state, progress: saved, target, projected, finished, message }
    }

    // no_unplanned
    const slips = inRange.filter(t => t.type === 'expense' && t.is_planned === false)
    const total = slips.reduce((s, t) => s + t.amount, 0)
    const state: CommitmentStatus['state'] = slips.length > 0 ? 'broken' : finished ? 'kept' : 'on_track'
    const message = slips.length > 0
      ? `${slips.length} unplanned purchase${slips.length === 1 ? '' : 's'} so far (${money(total)}).${finished ? '' : ` ${left} day${left === 1 ? '' : 's'} to go. Every day from here still counts.`}`
      : finished ? 'Kept. No unplanned purchases.' : `No unplanned purchases yet. ${left} day${left === 1 ? '' : 's'} to go.`
    return { commitment: c, state, progress: slips.length, target: 0, projected: slips.length, finished, message }
  })
}
