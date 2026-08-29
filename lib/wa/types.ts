export type WaOutboundKind =
  | 'weekly_shopping' | 'daily_reminder' | 'prep_thaw' | 'backlog_nudge'
  | 'batch_prep_wife' | 'batch_prep_kevin'

export type WaSettings = {
  id: string
  weekly_enabled: boolean
  weekly_time: string
  weekly_cutoff_dow: number // Mon=0 .. Sun=6; today >= this -> shopping list targets NEXT week
  daily_enabled: boolean
  daily_time: string
  prep_enabled: boolean
  prep_time: string
  backlog_enabled: boolean
  backlog_time: string
  include_kevin: boolean
  updated_at: string
  // Weekly batch-prep (lib/meals/batchPrep.ts) — a separate feature from
  // prep_enabled/prep_time above (the day-before thaw/marinate reminder).
  // Two independent per-recipient toggles since Wife and Kevin get
  // different message content, not a CC of the same text.
  batch_prep_enabled: boolean
  batch_prep_time: string
  batch_prep_dow: number // Mon=0 .. Sun=6 — which day the batch-prep messages go out
  batch_prep_wife_enabled: boolean
  batch_prep_kevin_enabled: boolean
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

// One meal_plans row, for the weekly-shopping message's meal overview.
export type WeeklyMealPlanRow = {
  plan_date: string
  slot: string
  dish_name: string | null
  skipped: boolean
}

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

// Input shapes for composeBatchPrepWifeMessage/composeBatchPrepKevinMessage —
// structurally identical to lib/meals/batchPrep.ts's BatchPrepDishBlock/
// FruitPrepItem (kept separate so lib/wa never imports lib/meals directly,
// matching every other message composer in this file).
export type BatchPrepDishBlockRow = {
  dish_name: string
  steps: { instruction: string; amount_display: string | null }[]
}
export type FruitPrepItemRow = {
  instruction: string
  amount_display: string | null
}
