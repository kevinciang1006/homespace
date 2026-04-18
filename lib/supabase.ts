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

export type User = {
  id: string
  name: string
  phone: string
  email: string | null
  google_calendar_id: string | null
}

export type CalendarEvent = {
  id: string
  title: string
  description: string | null
  start_at: string
  end_at: string
  location: string | null
  guests: { name: string; email: string }[] | null
  google_event_id: string | null
  created_by: string | null
}

export type ShoppingItem = {
  id: string
  name: string
  quantity: string | null
  category: string | null
  checked: boolean
  added_by: string | null
}
