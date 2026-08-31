import { supabase } from '@/lib/supabase'

// "When will I eat X?" — the plan-view search bar. Scans every generated
// week's meal_plans (not just the one currently loaded in the UI), so a
// match can point at a date in a different week than what's on screen right
// now. No date-range limit: the table stays small (a few thousand rows even
// a year out), so a plain ilike scan is cheap and always complete.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  if (q.length < 1) return Response.json({ results: [] })

  const { data, error } = await supabase.from('meal_plans')
    .select('dish_id, dish_name, plan_date')
    .ilike('dish_name', `%${q}%`)
    .eq('skipped', false)
    .not('dish_id', 'is', null)
    .order('plan_date')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const byDish = new Map<string, { dish_id: string; dish_name: string; dates: string[] }>()
  for (const row of data ?? []) {
    const key = row.dish_id as string
    if (!byDish.has(key)) byDish.set(key, { dish_id: key, dish_name: row.dish_name as string, dates: [] })
    byDish.get(key)!.dates.push(row.plan_date as string)
  }
  const results = [...byDish.values()].sort((a, b) => a.dish_name.localeCompare(b.dish_name))
  return Response.json({ results })
}
