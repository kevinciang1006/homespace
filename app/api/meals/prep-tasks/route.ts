import { supabase } from '@/lib/supabase'

// Weekly batch-prep tasks for one week (prep_category='batch_prep' only —
// the older day-before thaw/marinate tasks are fetched per-day by the
// /meals/day/[date] page instead, see app/meals/day/[date]/page.tsx).
export async function GET(request: Request) {
  const url = new URL(request.url)
  const week = url.searchParams.get('week')
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return Response.json({ error: 'week (YYYY-MM-DD) required' }, { status: 400 })
  }
  const { data, error } = await supabase.from('prep_tasks').select('*')
    .eq('week_start', week).eq('prep_category', 'batch_prep')
    .order('cook_date', { ascending: true }).order('created_at', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ tasks: data ?? [] })
}
