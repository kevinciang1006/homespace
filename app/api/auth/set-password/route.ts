import { supabase } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { userId, password, secret } = await request.json()

  if (secret !== process.env.SETUP_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!userId || !password) {
    return Response.json({ error: 'userId and password are required' }, { status: 400 })
  }

  const hash = await bcrypt.hash(password, 10)
  const { error } = await supabase.from('users').update({ password_hash: hash }).eq('id', userId)

  if (error) {
    return Response.json({ error: 'Failed to update password' }, { status: 500 })
  }

  return Response.json({ success: true })
}
