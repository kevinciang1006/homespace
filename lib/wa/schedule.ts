import { shiftWeek, mondayOf } from '../meals/dates'

const JAKARTA_OFFSET_MS = 7 * 3600_000
const ID_DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] // Mon..Sun

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
  const dow = dowMonBased(today)
  const daysUntilSat = dow <= 5 ? 5 - dow : 6
  return shiftWeek(today, daysUntilSat)
}

export function tomorrowOf(today: string): string {
  return shiftWeek(today, 1)
}

// The Monday-start week a Saturday's shopping trip is FOR: the week after
// the Saturday's own Mon-Sun week.
export function targetWeekStart(saturdayDate: string): string {
  return shiftWeek(mondayOf(saturdayDate), 7)
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
