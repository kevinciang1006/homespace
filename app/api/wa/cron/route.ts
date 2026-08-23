import { supabase } from '@/lib/supabase'
import { weekDates, shiftWeek } from '@/lib/meals/dates'
import { groupPrepByDate, type PrepCandidate } from '@/lib/meals/prep'
import { getOrCreateSettings } from '@/lib/wa/settings'
import { resolveRecipients } from '@/lib/wa/config'
import { sendWhatsapp } from '@/lib/wa/relay'
import {
  jakartaToday, upcomingSaturday, targetWeekStart, tomorrowOf, jakartaDateTimeToUtcIso,
} from '@/lib/wa/schedule'
import {
  composeWeeklyShoppingMessage, sumShopIngredients, composeDailyReminderMessage, composePrepThawMessage,
} from '@/lib/wa/messages'
import type {
  WaOutboundKind, WaOutboundRow, WaSettings, WeeklyShoppingItem, ShopIngredientRow, DailyPlanRow, PrepDishRow,
} from '@/lib/wa/types'

const PREP_LOOKAHEAD_DAYS = 14

async function buildWeeklyItems(saturday: string): Promise<WeeklyShoppingItem[]> {
  const weekStart = targetWeekStart(saturday)
  const { data: list } = await supabase.from('meal_shopping_lists')
    .select('id').eq('week_start', weekStart).maybeSingle()

  if (list) {
    const { data: items } = await supabase.from('meal_shopping_items')
      .select('ingredient, quantity, category')
      .eq('list_id', list.id).eq('checked', false).eq('already_have', false)
    return (items ?? []) as WeeklyShoppingItem[]
  }

  const days = weekDates(weekStart)
  const { data: plans } = await supabase.from('meal_plans').select('dish_id')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
    .eq('skipped', false).not('dish_id', 'is', null)
  const dishIds = [...new Set((plans ?? []).map(p => p.dish_id as string))]
  if (dishIds.length === 0) return []

  const { data: dishes } = await supabase.from('dishes').select('shop_ingredients').in('id', dishIds)
  const rows: ShopIngredientRow[] = (dishes ?? []).flatMap(d => (d.shop_ingredients ?? []) as ShopIngredientRow[])
  return sumShopIngredients(rows)
}

async function buildDailyRows(tomorrow: string): Promise<DailyPlanRow[]> {
  const { data } = await supabase.from('meal_plans')
    .select('slot, role, dish_id, dish_name, skipped').eq('plan_date', tomorrow)
  return (data ?? []) as DailyPlanRow[]
}

type DishFlags = { needs_thaw: boolean; needs_marinate: boolean; prep_lead_days: number | null; prep_note: string | null }

// Groups upcoming thaw/marinate dishes by the evening they should be prepped.
// Delegates the grouping itself to lib/meals/prep.ts (shared with the day page).
async function buildPrepBatches(today: string): Promise<Map<string, PrepDishRow[]>> {
  const until = shiftWeek(today, PREP_LOOKAHEAD_DAYS)
  const { data } = await supabase.from('meal_plans')
    .select('plan_date, dish_id, dish_name, skipped, dishes(needs_thaw, needs_marinate, prep_lead_days, prep_note)')
    .gte('plan_date', today).lte('plan_date', until)
    .eq('skipped', false).not('dish_id', 'is', null)

  // Without generated Database types, supabase-js can't infer the FK's
  // to-one cardinality from the select string and defaults to an array type;
  // it's actually a single nested object at runtime (same as the `dishes`
  // embed in app/api/meals/week/route.ts), hence the `unknown` bridge.
  type PrepPlanRow = { plan_date: string; dish_id: string; dish_name: string | null; dishes: DishFlags | null }
  const candidates: PrepCandidate[] = ((data ?? []) as unknown as PrepPlanRow[])
    .filter(row => row.dishes)
    .map(row => ({
      dish_id: row.dish_id, dish_name: row.dish_name ?? 'Dish', cook_date: row.plan_date,
      needs_thaw: row.dishes!.needs_thaw, needs_marinate: row.dishes!.needs_marinate,
      prep_lead_days: row.dishes!.prep_lead_days, prep_note: row.dishes!.prep_note,
    }))

  const grouped = groupPrepByDate(candidates)
  const batches = new Map<string, PrepDishRow[]>()
  for (const [date, items] of grouped) {
    batches.set(date, items.map(item => ({
      dish_name: item.dish_name, cook_date: item.cook_date,
      needs_thaw: item.needs_thaw, needs_marinate: item.needs_marinate, prep_note: item.prep_note,
    })))
  }
  return batches
}

// Insert a wa_outbound row for (kind, refDate) if absent; if present and not
// yet sent, refresh its content (message/recipients/send_at may have changed
// since the last build); if already sent, leave it untouched.
async function upsertOutbound(
  kind: WaOutboundKind, refDate: string, sendAt: string, recipients: string[], message: string,
): Promise<'built' | 'skipped'> {
  const { data: existing } = await supabase.from('wa_outbound').select('id, sent')
    .eq('kind', kind).eq('ref_date', refDate).maybeSingle()

  if (!existing) {
    const { error } = await supabase.from('wa_outbound').insert({
      kind, ref_date: refDate, send_at: sendAt, recipients, message, sent: false,
    })
    return error ? 'skipped' : 'built'
  }
  if (existing.sent) return 'skipped'
  // Row already exists and is still pending — refresh its content in case the
  // plan/settings changed since the last tick, but this isn't a *new* build.
  await supabase.from('wa_outbound')
    .update({ send_at: sendAt, recipients, message }).eq('id', existing.id)
  return 'skipped'
}

function kindEnabled(kind: WaOutboundKind, settings: WaSettings): boolean {
  if (kind === 'weekly_shopping') return settings.weekly_enabled
  if (kind === 'daily_reminder') return settings.daily_enabled
  return settings.prep_enabled
}

// ---- Test mode ----------------------------------------------------------------

const SAMPLE_WEEKLY_ITEMS: WeeklyShoppingItem[] = [
  { ingredient: 'Ayam', quantity: '1kg', category: 'protein' },
  { ingredient: 'Kangkung', quantity: '400g', category: 'vegetable' },
  { ingredient: 'Bumbu Rendang', quantity: null, category: 'bumbu' },
]
const SAMPLE_DAILY_ROWS: DailyPlanRow[] = [
  { slot: 'breakfast', role: 'breakfast', dish_id: 'sample', dish_name: 'Bubur ayam', skipped: false },
  { slot: 'utama', role: 'main', dish_id: 'sample', dish_name: 'Ayam bakar', skipped: false },
  { slot: 'sayuran', role: 'support', dish_id: 'sample', dish_name: 'Tumis kangkung', skipped: false },
  { slot: 'fruit', role: 'optional', dish_id: 'sample', dish_name: 'Pisang', skipped: false },
]
const SAMPLE_PREP_DISHES: PrepDishRow[] = [
  { dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: true, prep_note: null },
  {
    dish_name: 'Babi', cook_date: '2026-08-27', needs_thaw: false, needs_marinate: true,
    prep_note: 'bisa marinate sekarang, tahan seminggu',
  },
]
const SAMPLE_TAG = '\n\n_(contoh — belum ada data nyata untuk ini)_'

async function runTestMode(to: string): Promise<Response> {
  const today = jakartaToday()

  const saturday = upcomingSaturday(today)
  const weeklyItems = await buildWeeklyItems(saturday)
  const weeklyMessage = weeklyItems.length > 0
    ? composeWeeklyShoppingMessage(weeklyItems)
    : composeWeeklyShoppingMessage(SAMPLE_WEEKLY_ITEMS) + SAMPLE_TAG

  const tomorrow = tomorrowOf(today)
  const dailyRows = await buildDailyRows(tomorrow)
  const dailyMessage = composeDailyReminderMessage(tomorrow, dailyRows)
    ?? composeDailyReminderMessage(tomorrow, SAMPLE_DAILY_ROWS)! + SAMPLE_TAG

  const batches = await buildPrepBatches(today)
  const firstBatch = [...batches.values()][0]
  const prepMessage = firstBatch
    ? composePrepThawMessage(firstBatch)!
    : composePrepThawMessage(SAMPLE_PREP_DISHES)! + SAMPLE_TAG

  const sentOk: Record<string, boolean> = {}
  for (const [kind, message] of [
    ['weekly_shopping', weeklyMessage],
    ['daily_reminder', dailyMessage],
    ['prep_thaw', prepMessage],
  ] as const) {
    const result = await sendWhatsapp(to, message)
    sentOk[kind] = result.ok
  }
  return Response.json({ sent: sentOk })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const isTest = url.searchParams.get('test') === '1'
  if (isTest) {
    const to = url.searchParams.get('to')
    if (!to) return Response.json({ error: 'test mode requires &to=+62...' }, { status: 400 })
    return runTestMode(to)
  }

  const settings = await getOrCreateSettings()
  const today = jakartaToday()
  let built = 0, skipped = 0

  if (settings.weekly_enabled) {
    try {
      const saturday = upcomingSaturday(today)
      const items = await buildWeeklyItems(saturday)
      const message = composeWeeklyShoppingMessage(items)
      const sendAt = jakartaDateTimeToUtcIso(saturday, settings.weekly_time)
      const result = await upsertOutbound(
        'weekly_shopping', saturday, sendAt, resolveRecipients(settings.include_kevin), message,
      )
      if (result === 'built') built++; else skipped++
    } catch (err) {
      console.error('weekly_shopping build failed:', err)
      skipped++
    }
  }

  if (settings.daily_enabled) {
    try {
      const tomorrow = tomorrowOf(today)
      const rows = await buildDailyRows(tomorrow)
      const message = composeDailyReminderMessage(tomorrow, rows)
      if (message) {
        const sendAt = jakartaDateTimeToUtcIso(today, settings.daily_time)
        const result = await upsertOutbound(
          'daily_reminder', tomorrow, sendAt, resolveRecipients(settings.include_kevin), message,
        )
        if (result === 'built') built++; else skipped++
      } else {
        skipped++
      }
    } catch (err) {
      console.error('daily_reminder build failed:', err)
      skipped++
    }
  }

  if (settings.prep_enabled) {
    try {
      const batches = await buildPrepBatches(today)
      for (const [prepDate, dishes] of batches) {
        const message = composePrepThawMessage(dishes)
        if (!message) { skipped++; continue }
        const sendAt = jakartaDateTimeToUtcIso(prepDate, settings.prep_time)
        const result = await upsertOutbound(
          'prep_thaw', prepDate, sendAt, resolveRecipients(settings.include_kevin), message,
        )
        if (result === 'built') built++; else skipped++
      }
    } catch (err) {
      console.error('prep_thaw build failed:', err)
      skipped++
    }
  }

  const { data: due } = await supabase.from('wa_outbound').select('*')
    .eq('sent', false).lte('send_at', new Date().toISOString())

  let sent = 0, failed = 0
  for (const row of (due ?? []) as WaOutboundRow[]) {
    if (!kindEnabled(row.kind, settings)) { skipped++; continue }
    const results = await Promise.all(row.recipients.map(phone => sendWhatsapp(phone, row.message)))
    const allOk = results.every(r => r.ok)
    if (allOk) {
      await supabase.from('wa_outbound').update({ sent: true, sent_at: new Date().toISOString() }).eq('id', row.id)
      sent++
    } else {
      failed++
    }
  }

  return Response.json({ built, sent, skipped, failed })
}
