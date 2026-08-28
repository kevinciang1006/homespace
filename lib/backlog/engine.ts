import type { BacklogItem, NudgeContext, TimeOfDay } from './types'
import { HOMESPACE_URL } from '../wa/config'
import { daysBetween } from '../meals/dates'

const AUTO_SNOOZE_DAYS = 4
const DEADLINE_WINDOW_DAYS = 7
const DAY_MS = 86_400_000

// Maps a wall-clock "HH:MM" to its time-of-day bucket. 19:30 -> 'evening'.
export function slotForTime(hhmm: string): TimeOfDay {
  const h = Number(hhmm.split(':')[0])
  if (h < 5) return 'night'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'night'
}

// Picks at most one backlog item that fits *this* slot/day, or null.
// `items` is the full status='ready' pool; every other status is caller-filtered.
export function selectNudgeCandidate(items: BacklogItem[], ctx: NudgeContext): BacklogItem | null {
  const excluded = new Set(ctx.excludedMutexGroups)

  const eligible = items.filter(it => {
    if (it.status !== 'ready') return false
    if (it.snooze_until && it.snooze_until > ctx.today) return false
    if (!it.time_of_day.includes('any') && !it.time_of_day.includes(ctx.slot)) return false
    if (it.day_pref !== 'any' && it.day_pref !== ctx.dayType) return false
    if (it.recurring) return false
    if (it.last_suggested_at) {
      const ageMs = ctx.now.getTime() - new Date(it.last_suggested_at).getTime()
      if (ageMs < AUTO_SNOOZE_DAYS * DAY_MS) return false
    }
    if (it.mutex_group && excluded.has(it.mutex_group)) return false
    return true
  })

  eligible.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const at = a.last_suggested_at ? new Date(a.last_suggested_at).getTime() : -Infinity
    const bt = b.last_suggested_at ? new Date(b.last_suggested_at).getTime() : -Infinity
    return at - bt // oldest (and null = -Infinity) first
  })

  return eligible[0] ?? null
}

function countdown(today: string, deadline: string): string {
  const n = daysBetween(today, deadline)
  if (n <= 0) return 'today'
  return `${n} day${n === 1 ? '' : 's'} left`
}

// Zero or more short lines appended after the main pick: near-deadline countdowns
// and daily-recurring reminders. An item that is both gets ONE line (the countdown).
export function backlogTail(items: BacklogItem[], today: string): string[] {
  const lines: string[] = []
  for (const it of items) {
    const near = it.deadline != null
      && daysBetween(today, it.deadline) >= 0
      && daysBetween(today, it.deadline) <= DEADLINE_WINDOW_DAYS
    const recurringDue = it.recurring && it.recurrence === 'daily'
    if (near) {
      lines.push(`${it.title} — ${countdown(today, it.deadline!)}`)
    } else if (recurringDue) {
      lines.push(it.title)
    }
  }
  return lines
}

function phraseFor(it: BacklogItem): string {
  const detail = it.notes?.trim() ? ` — ${it.notes.trim()}` : ''
  if (it.prep_ahead) {
    const lead = it.lead_time_hours ? ` (~${it.lead_time_hours}h ahead)` : ''
    return `prep ${it.title.toLowerCase()} tonight, finish it later${lead}${detail}`
  }
  return `${it.title.toLowerCase()} tonight${detail}`
}

// The final message, or null when there's genuinely nothing to say.
export function composeBacklogNudge(candidate: BacklogItem | null, tailLines: string[]): string | null {
  if (!candidate && tailLines.length === 0) return null

  const parts: string[] = []
  if (candidate) parts.push(`🔧 Evening idea: ${phraseFor(candidate)}`)
  for (const line of tailLines) parts.push(`(+ ${line})`)
  parts.push(`${HOMESPACE_URL}/backlog`)
  return parts.join('\n')
}
