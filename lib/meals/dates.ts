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
