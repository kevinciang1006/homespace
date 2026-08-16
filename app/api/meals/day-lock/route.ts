import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { plan_date, locked } = await request.json()
  if (!plan_date || typeof locked !== 'boolean') {
    return Response.json({ error: 'plan_date and locked required' }, { status: 400 })
  }
  const { error } = await supabase.from('meal_plans').update({ locked }).eq('plan_date', plan_date)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
