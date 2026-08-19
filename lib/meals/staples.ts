import type { DailyStaple } from './types'

// Groups staples that share an identical item+note across people into one
// clause ("Son Susu (milk) · Kevin & Wife Susu / yogurt"), then joins
// distinct items with " · ". Rename a staple's `name` via the editor for a
// shorter/different display — this is a direct, WYSIWYG reflection of the
// data, no hidden translation.
export function formatStaplesLine(staples: DailyStaple[]): string {
  const groups = new Map<string, { name: string; people: string[] }>()
  for (const s of staples) {
    const key = `${s.name.trim().toLowerCase()}|${(s.note ?? '').trim().toLowerCase()}`
    const g = groups.get(key)
    if (g) g.people.push(s.person)
    else groups.set(key, { name: s.name.trim(), people: [s.person] })
  }
  return [...groups.values()].map(g => `${joinPeople(g.people)} ${g.name}`).join(' · ')
}

function joinPeople(people: string[]): string {
  if (people.length === 1) return people[0]
  if (people.length === 2) return `${people[0]} & ${people[1]}`
  return `${people.slice(0, -1).join(', ')} & ${people[people.length - 1]}`
}
