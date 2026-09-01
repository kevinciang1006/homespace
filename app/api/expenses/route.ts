import { supabase } from '@/lib/supabase'

// NEW route — Step 0 of the voice-assistant build found no existing
// add-expense action anywhere in the codebase (ExpensesClient.tsx only
// reads initialExpenses server-side and deletes; nothing inserts). Rather
// than invent a parallel path, this mirrors the exact `expenses` table
// shape the Expenses page already reads (lib/supabase.ts's Expense type).

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { date, store, total } = body
  if (!date || total === undefined || total === null) {
    return Response.json({ error: 'date and total required' }, { status: 400 })
  }
  const { data, error } = await supabase.from('expenses').insert({
    date, store: store ?? null, items: body.items ?? null, total: Number(total),
    currency: body.currency || 'IDR', logged_by: body.logged_by ?? null, notes: body.notes ?? null,
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const start = url.searchParams.get('start')
  const end = url.searchParams.get('end')
  let query = supabase.from('expenses').select('*').order('date', { ascending: false })
  if (start) query = query.gte('date', start)
  if (end) query = query.lte('date', end)
  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ expenses: data ?? [] })
}
