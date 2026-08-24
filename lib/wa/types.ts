export type WaOutboundKind = 'weekly_shopping' | 'daily_reminder' | 'prep_thaw'

export type WaSettings = {
  id: string
  weekly_enabled: boolean
  weekly_time: string
  weekly_cutoff_dow: number // Mon=0 .. Sun=6; today >= this -> shopping list targets NEXT week
  daily_enabled: boolean
  daily_time: string
  prep_enabled: boolean
  prep_time: string
  include_kevin: boolean
  updated_at: string
}

export type WaOutboundRow = {
  id: string
  kind: WaOutboundKind
  send_at: string
  recipients: string[]
  message: string
  ref_date: string
  sent: boolean
  sent_at: string | null
}

// ---- message-composer input shapes ------------------------------------------

export type WeeklyShoppingItem = { ingredient: string; quantity: string | null; category: string }

// Raw shape of one entry in dishes.shop_ingredients (see scripts/draft-shopping-ingredients.mjs).
export type ShopIngredientRow = { item: string; amount: number; unit: string; category: string }

export type DailyPlanRow = {
  slot: string
  role: string
  dish_id: string | null
  dish_name: string | null
  skipped: boolean
}

export type PrepDishRow = {
  dish_name: string
  cook_date: string
  needs_thaw: boolean
  needs_marinate: boolean
  prep_note: string | null
}
