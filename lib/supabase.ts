import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Expense = {
  id: string
  date: string
  store: string | null
  items: { name: string; price?: number }[] | null
  total: number
  currency: string
  logged_by: string | null
  notes: string | null
  created_at: string
}
