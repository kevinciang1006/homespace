export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocal(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function weekDates(weekStart: string): string[] {
  const start = parseLocal(weekStart)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return isoDate(d)
  })
}

export function daysBetween(a: string, b: string): number {
  const ms = parseLocal(b).getTime() - parseLocal(a).getTime()
  return Math.round(ms / 86_400_000)
}

export function currentMonday(): string {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - dow)
  return isoDate(now)
}

export function shiftWeek(weekStart: string, deltaDays: number): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + deltaDays)
  return isoDate(dt)
}

export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = (dt.getDay() + 6) % 7 // Mon=0
  dt.setDate(dt.getDate() - dow)
  return isoDate(dt)
}
