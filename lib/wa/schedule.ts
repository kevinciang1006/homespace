import { shiftWeek, mondayOf } from '../meals/dates'

const JAKARTA_OFFSET_MS = 7 * 3600_000
const ID_DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] // Mon..Sun
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Today's date (YYYY-MM-DD) in Asia/Jakarta (fixed UTC+7, no DST), derived
// from the instant `now` — never from the server process's own timezone.
export function jakartaToday(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + JAKARTA_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dowMonBased(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7 // Mon=0 ... Sun=6
}

// The next Saturday on/after `today` (inclusive).
export function upcomingSaturday(today: string): string {
  return upcomingDow(today, 5)
}

// The next date on/after `today` (inclusive) matching the given weekday
// (Mon=0..Sun=6, same convention as wa_settings.weekly_cutoff_dow/
// batch_prep_dow). Generalizes upcomingSaturday for a configurable day.
export function upcomingDow(today: string, targetDow: number): string {
  const dow = dowMonBased(today)
  const daysUntil = dow <= targetDow ? targetDow - dow : 7 - (dow - targetDow)
  return shiftWeek(today, daysUntil)
}

export function tomorrowOf(today: string): string {
  return shiftWeek(today, 1)
}

// Saturday or Sunday in Asia/Jakarta terms.
export function isWeekend(dateStr: string): boolean {
  return dowMonBased(dateStr) >= 5
}

// Which Monday-start week the shopping list is FOR, given today's date and a
// configurable day-of-week cutoff (Mon=0..Sun=6, from wa_settings.weekly_cutoff_dow).
// Today on/after the cutoff -> next week; before it -> this week. Decoupled from
// the Saturday send schedule (upcomingSaturday) — this only affects which
// week's meal_plans get aggregated, not when the message is sent.
export function shoppingWeekStart(today: string, cutoffDow: number): string {
  const dow = dowMonBased(today)
  const thisMonday = mondayOf(today)
  return dow >= cutoffDow ? shiftWeek(thisMonday, 7) : thisMonday
}

export function indonesianDayName(dateStr: string): string {
  return ID_DAYS[dowMonBased(dateStr)]
}

// Combine a local Asia/Jakarta date + "HH:MM" wall-clock time into a UTC ISO instant.
export function jakartaDateTimeToUtcIso(dateStr: string, hhmm: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - JAKARTA_OFFSET_MS).toISOString()
}

// Wall-clock fields in Asia/Jakarta for the instant `now`, via the real IANA
// zone rather than a raw offset (Jakarta is UTC+7 year-round with no DST, so it
// agrees with jakartaToday()). `hour` is 0-23; `weekday` is the English long
// name ("Tuesday"); `prettyDate` is "1 Sep 2026". Used by the morning standup
// ping's send-window guard and message.
export function jakartaClock(now: Date = new Date()): { hour: number; weekday: string; prettyDate: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', hourCycle: 'h23', weekday: 'long',
  }).formatToParts(now)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === t)?.value ?? ''
  return {
    hour: Number(get('hour')),
    weekday: get('weekday'),
    prettyDate: `${Number(get('day'))} ${MONTHS_SHORT[Number(get('month')) - 1]} ${get('year')}`,
  }
}
