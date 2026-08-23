import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { getOrCreateSettings } from '@/lib/wa/settings'
import { resolveRecipients } from '@/lib/wa/config'
import { jakartaToday, upcomingSaturday, targetWeekStart, jakartaDateTimeToUtcIso } from '@/lib/wa/schedule'
import { composeWeeklyShoppingMessage, sumShopIngredients } from '@/lib/wa/messages'
import type { WaOutboundKind, WeeklyShoppingItem, ShopIngredientRow } from '@/lib/wa/types'

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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
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

  return Response.json({ built, sent: 0, skipped, failed: 0 })
}
