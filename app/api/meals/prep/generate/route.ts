import { generateWeekBatchPrep } from '@/lib/meals/batchPrepGenerate'
import { isoDate } from '@/lib/meals/dates'

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  try {
    const result = await generateWeekBatchPrep(weekStart, isoDate(new Date()))
    return Response.json({ created: result.created, skipped: result.skipped })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'generate failed' }, { status: 500 })
  }
}
