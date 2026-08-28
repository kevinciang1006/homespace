import { ccAuthorized } from '@/lib/cc/auth'
import { runCcCheck } from '@/lib/cc/checker'

export async function GET(request: Request) {
  if (!ccAuthorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const result = await runCcCheck()
  return Response.json(result)
}
