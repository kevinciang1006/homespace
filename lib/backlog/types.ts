export type BacklogCategory =
  | 'car' | 'kitchen' | 'home_maint' | 'outdoor' | 'online' | 'errand' | 'other'

export type BacklogStatus = 'ready' | 'blocked' | 'snoozed' | 'done' | 'dropped'

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night' | 'any'

export type DayPref = 'weekday' | 'weekend' | 'any'

export type BacklogAction =
  | 'suggested' | 'done' | 'snoozed' | 'unblocked' | 'skipped' | 'created'

// Mirrors a backlog_items row (snake_case), same convention as lib/wa/types.ts.
// Date/timestamp columns come back from supabase-js as ISO strings.
export type BacklogItem = {
  id: string
  title: string
  category: BacklogCategory
  status: BacklogStatus
  blocked_by: string | null
  time_of_day: TimeOfDay[]
  day_pref: DayPref
  needs_daylight: boolean
  needs_dry: boolean
  prep_ahead: boolean
  lead_time_hours: number | null
  mutex_group: string | null
  recurring: boolean
  recurrence: string | null
  deadline: string | null        // 'YYYY-MM-DD'
  priority: number
  last_suggested_at: string | null
  last_done_at: string | null
  snooze_until: string | null    // 'YYYY-MM-DD'
  notes: string | null
  created_at: string
}

export type BacklogLogRow = {
  id: string
  item_id: string | null
  action: BacklogAction
  note: string | null
  created_at: string
}

// Everything the pure nudge engine needs about "now", computed by the caller.
export type NudgeContext = {
  slot: TimeOfDay                 // which time-of-day bucket the nudge fires in
  dayType: 'weekday' | 'weekend'
  today: string                  // 'YYYY-MM-DD' in Asia/Jakarta
  now: Date                      // real instant, for the 4-day auto-snooze math
  excludedMutexGroups: string[]  // mutex_groups already suggested/done today
}
