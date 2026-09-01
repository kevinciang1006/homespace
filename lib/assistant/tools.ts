import { supabase } from '@/lib/supabase'
import { attachAvailability } from '@/lib/stock/ledger'
import { mondayOf } from '@/lib/meals/dates'
import { jakartaToday } from '@/lib/wa/schedule'
import {
  resolveIngredient, stockRowsForIngredient, resolveDish, resolveGeneralShoppingItem,
  getOrCreateMealShoppingListId, resolveMealShoppingItem,
} from './resolvers'
import type { MatchResult } from './match'
import type { ToolContext, ToolDefinition, ToolResult } from './types'

// Every mutating tool here calls the SAME route the matching UI button
// calls (internal fetch to ctx.origin, cookie forwarded) — see the Step 0
// inventory in the build report for what this was built against. Reads
// call the same underlying query/lib function directly where one already
// exists (e.g. attachAvailability for stock) rather than round-tripping
// through HTTP. Nothing here writes to a table Homespace doesn't already
// have a page for.

const ok = (summary: string): ToolResult => ({ ok: true, summary })
const fail = (summary: string): ToolResult => ({ ok: false, summary })

// Every name-based lookup below (resolveDish, resolveIngredient, the
// shopping-item resolvers) returns a MatchResult — one/many/none — instead
// of silently picking a guess. This turns that into either the resolved row
// or a ToolResult that already says the right thing: a "which one?" listing
// candidates when the name is ambiguous ("ayam" against a dozen chicken
// dishes), or "couldn't find X" with a "did you mean" hint when nothing
// matched. Every call site below stays a two-line check instead of
// reimplementing this three-way branch per tool.
function resolveOrFail<T>(match: MatchResult<T>, label: (row: T) => string, noun: string, query: string): { row: T } | { result: ToolResult } {
  if (match.kind === 'one') return { row: match.row }
  if (match.kind === 'many') return { result: fail(`Which ${noun} — ${match.rows.map(label).join(', ')}?`) }
  const hint = match.suggestions.length ? ` Did you mean ${match.suggestions.map(label).join(' or ')}?` : ''
  return { result: fail(`Couldn't find a ${noun} called "${query}".${hint}`) }
}

function authHeaders(ctx: ToolContext): Record<string, string> {
  return { 'content-type': 'application/json', ...(ctx.cookie ? { cookie: ctx.cookie } : {}) }
}

// A tool needing confirmation ALWAYS carries a required `confirm_text`
// input — Claude writes the actual confirm question itself, in whichever
// language the user spoke (see the system prompt in
// app/api/assistant/route.ts). Far more reliably bilingual than a hand
// -rolled EN/ID template, and matches the build request's own example
// ("Tambah 2 liter susu ke belanja?").
const CONFIRM_PROP = {
  confirm_text: { type: 'string', description: 'Short one-line confirmation question, in the SAME language the user just spoke, e.g. "Tambah 2 liter susu ke belanja?" or "Log Rp150,000 at Indomaret?"' },
}
function withConfirm(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object' as const, properties: { ...properties, ...CONFIRM_PROP }, required: [...required, 'confirm_text'] }
}
function schema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object' as const, properties, required }
}

export const TOOLS: ToolDefinition[] = [
  // ------------------------------------------------------------------
  // Shopping — general (ad-hoc) list: app/api/shopping/items[/[id]]
  // DEFAULT list unless she says "meal"/"minggu ini" — see system prompt.
  // ------------------------------------------------------------------
  {
    name: 'add_shopping_item_general',
    description: 'Add an item to the general (ad-hoc) household shopping list — the default unless she specifically names the meal-plan / weekly list.',
    input_schema: schema({ name: { type: 'string' }, quantity: { type: 'string', description: 'e.g. "2 liter" — optional' } }, ['name']),
    requiresConfirmation: false,
    async execute(input, ctx) {
      const res = await fetch(`${ctx.origin}/api/shopping/items`, {
        method: 'POST', headers: authHeaders(ctx),
        body: JSON.stringify({ name: input.name, quantity: input.quantity ?? null, added_by: ctx.session?.name ?? null }),
      })
      if (!res.ok) return fail('Could not add that item.')
      return ok(`Added "${input.name}"${input.quantity ? ` (${input.quantity})` : ''} to the general shopping list.`)
    },
  },
  {
    name: 'remove_shopping_item_general',
    description: 'Remove an item from the general shopping list. Destructive — requires confirm_text.',
    input_schema: withConfirm({ name: { type: 'string' } }, ['name']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const resolved = resolveOrFail(await resolveGeneralShoppingItem(String(input.name)), r => r.name, 'shopping item', String(input.name))
      if ('result' in resolved) return resolved.result
      const item = resolved.row
      const res = await fetch(`${ctx.origin}/api/shopping/items/${item.id}`, { method: 'DELETE', headers: authHeaders(ctx) })
      if (!res.ok) return fail('Could not remove that item.')
      return ok(`Removed "${item.name}" from the general shopping list.`)
    },
  },
  {
    name: 'check_shopping_item_general',
    description: 'Mark an item on the general shopping list as bought (checked) or not.',
    input_schema: schema({ name: { type: 'string' }, checked: { type: 'boolean' } }, ['name', 'checked']),
    requiresConfirmation: false,
    async execute(input, ctx) {
      const resolved = resolveOrFail(await resolveGeneralShoppingItem(String(input.name)), r => r.name, 'shopping item', String(input.name))
      if ('result' in resolved) return resolved.result
      const item = resolved.row
      const res = await fetch(`${ctx.origin}/api/shopping/items/${item.id}`, {
        method: 'PATCH', headers: authHeaders(ctx), body: JSON.stringify({ checked: input.checked }),
      })
      if (!res.ok) return fail('Could not update that item.')
      return ok(`Marked "${item.name}" as ${input.checked ? 'bought' : 'not bought'}.`)
    },
  },

  // ------------------------------------------------------------------
  // Shopping — meal-plan (weekly) list: app/api/meals/shopping/items[/[id]]
  // ------------------------------------------------------------------
  {
    name: 'add_shopping_item_meal',
    description: 'Add an item to THIS WEEK\'s meal-plan shopping list (only when she explicitly says "meal", "weekly", or "minggu ini" — otherwise use add_shopping_item_general).',
    input_schema: schema({ ingredient: { type: 'string' }, quantity: { type: 'string' } }, ['ingredient']),
    requiresConfirmation: false,
    async execute(input, ctx) {
      const listId = await getOrCreateMealShoppingListId(ctx.origin, ctx.cookie, mondayOf(jakartaToday()))
      if (!listId) return fail('Could not find or create this week\'s meal shopping list.')
      const res = await fetch(`${ctx.origin}/api/meals/shopping/items`, {
        method: 'POST', headers: authHeaders(ctx),
        body: JSON.stringify({ list_id: listId, ingredient: input.ingredient, quantity: input.quantity ?? null }),
      })
      if (!res.ok) return fail('Could not add that item.')
      return ok(`Added "${input.ingredient}"${input.quantity ? ` (${input.quantity})` : ''} to this week's meal shopping list.`)
    },
  },
  {
    name: 'remove_shopping_item_meal',
    description: 'Remove an item from this week\'s meal-plan shopping list. Destructive — requires confirm_text.',
    input_schema: withConfirm({ ingredient: { type: 'string' } }, ['ingredient']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const listId = await getOrCreateMealShoppingListId(ctx.origin, ctx.cookie, mondayOf(jakartaToday()))
      if (!listId) return fail('No meal shopping list exists for this week.')
      const resolved = resolveOrFail(await resolveMealShoppingItem(listId, String(input.ingredient)), r => r.ingredient, 'shopping item', String(input.ingredient))
      if ('result' in resolved) return resolved.result
      const item = resolved.row
      const res = await fetch(`${ctx.origin}/api/meals/shopping/items/${item.id}`, { method: 'DELETE', headers: authHeaders(ctx) })
      if (!res.ok) return fail('Could not remove that item.')
      return ok(`Removed "${item.ingredient}" from this week's meal shopping list.`)
    },
  },
  {
    name: 'check_shopping_item_meal',
    description: 'Mark an item on this week\'s meal-plan shopping list as bought (checked) or not.',
    input_schema: schema({ ingredient: { type: 'string' }, checked: { type: 'boolean' } }, ['ingredient', 'checked']),
    requiresConfirmation: false,
    async execute(input, ctx) {
      const listId = await getOrCreateMealShoppingListId(ctx.origin, ctx.cookie, mondayOf(jakartaToday()))
      if (!listId) return fail('No meal shopping list exists for this week.')
      const resolved = resolveOrFail(await resolveMealShoppingItem(listId, String(input.ingredient)), r => r.ingredient, 'shopping item', String(input.ingredient))
      if ('result' in resolved) return resolved.result
      const item = resolved.row
      const res = await fetch(`${ctx.origin}/api/meals/shopping/items/${item.id}`, {
        method: 'PATCH', headers: authHeaders(ctx), body: JSON.stringify({ checked: input.checked }),
      })
      if (!res.ok) return fail('Could not update that item.')
      return ok(`Marked "${item.ingredient}" as ${input.checked ? 'bought' : 'not bought'}.`)
    },
  },

  // ------------------------------------------------------------------
  // Stock — app/api/stock[/[id]] — reservation-safe: every write below goes
  // through these exact routes (which log a stock_movements row), never a
  // raw on_hand UPDATE.
  // ------------------------------------------------------------------
  {
    name: 'check_stock',
    description: 'Read how much of an ingredient is in stock — on_hand, reserved (already spoken for by planned meals), and available. Read-only, immediate.',
    input_schema: schema({ ingredient: { type: 'string' } }, ['ingredient']),
    requiresConfirmation: false,
    async execute(input) {
      const resolved = resolveOrFail(await resolveIngredient(String(input.ingredient)), r => r.name, 'ingredient', String(input.ingredient))
      if ('result' in resolved) return resolved.result
      const ing = resolved.row
      const { data } = await supabase.from('stock')
        .select('*, ingredients(name, category, default_unit, shelf_stable, satisfies_group)').eq('ingredient_id', ing.id)
      if (!data || data.length === 0) return fail(`"${ing.name}" isn't tracked in stock.`)
      // attachAvailability does its own stock_movements/group lookups — see
      // lib/stock/ledger.ts — so passing these rows is all it needs.
      const withAvailability = await attachAvailability(data)
      const lines = withAvailability.map(r => `${r.ingredients?.name} in ${r.location}: ${r.on_hand}${r.unit ?? ''} on hand, ${r.reserved}${r.unit ?? ''} reserved, ${r.available}${r.unit ?? ''} available`)
      return ok(lines.join('; '))
    },
  },
  {
    name: 'add_stock_item',
    description: 'Track an ingredient in stock for the FIRST time in a location (freezer/fridge/pantry) — use only when it isn\'t already tracked there. Changes a stock count — requires confirm_text.',
    input_schema: withConfirm({
      ingredient: { type: 'string' },
      location: { type: 'string', enum: ['freezer', 'fridge', 'pantry'] },
      amount: { type: 'number' },
      unit: { type: 'string' },
    }, ['ingredient', 'location', 'amount', 'unit']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const ingMatch = await resolveIngredient(String(input.ingredient))
      if (ingMatch.kind === 'none') return fail(`"${input.ingredient}" isn't a known ingredient yet — add it as an ingredient first.`)
      if (ingMatch.kind === 'many') return fail(`Which ingredient — ${ingMatch.rows.map(r => r.name).join(', ')}?`)
      const ing = ingMatch.row
      const res = await fetch(`${ctx.origin}/api/stock`, {
        method: 'POST', headers: authHeaders(ctx),
        body: JSON.stringify({ ingredient_id: ing.id, location: input.location, on_hand: input.amount, unit: input.unit }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return fail(body.error || 'Could not add that to stock.')
      }
      return ok(`Added ${input.amount}${input.unit} of ${ing.name} to the ${input.location}.`)
    },
  },
  {
    name: 'set_stock_on_hand',
    description: 'Correct or restock an ALREADY-tracked stock item to a new amount (covers both "restock after shopping" and "correct to actual"). Changes a stock count — requires confirm_text.',
    input_schema: withConfirm({
      ingredient: { type: 'string' },
      amount: { type: 'number' },
      location: { type: 'string', enum: ['freezer', 'fridge', 'pantry'], description: 'Optional — only needed if the ingredient is tracked in more than one location.' },
    }, ['ingredient', 'amount']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const ingResolved = resolveOrFail(await resolveIngredient(String(input.ingredient)), r => r.name, 'ingredient', String(input.ingredient))
      if ('result' in ingResolved) return ingResolved.result
      const rows = await stockRowsForIngredient(ingResolved.row)
      const row = input.location ? rows.find(r => r.location === input.location) : rows.sort((a, b) => b.on_hand - a.on_hand)[0]
      if (!row) return fail(`"${input.ingredient}" isn't tracked in stock yet — add it first.`)
      const res = await fetch(`${ctx.origin}/api/stock/${row.id}`, {
        method: 'PATCH', headers: authHeaders(ctx), body: JSON.stringify({ on_hand: input.amount }),
      })
      if (!res.ok) return fail('Could not update that stock item.')
      return ok(`${row.ingredient_name} in ${row.location} is now ${input.amount}${row.unit ?? ''}.`)
    },
  },
  {
    name: 'move_stock_location',
    description: 'Move a stock item to a different location (e.g. she put it in the fridge instead of the freezer). Requires confirm_text.',
    input_schema: withConfirm({
      ingredient: { type: 'string' },
      from_location: { type: 'string', enum: ['freezer', 'fridge', 'pantry'], description: 'Optional if it\'s only tracked in one location.' },
      to_location: { type: 'string', enum: ['freezer', 'fridge', 'pantry'] },
    }, ['ingredient', 'to_location']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const ingResolved = resolveOrFail(await resolveIngredient(String(input.ingredient)), r => r.name, 'ingredient', String(input.ingredient))
      if ('result' in ingResolved) return ingResolved.result
      const rows = await stockRowsForIngredient(ingResolved.row)
      const row = input.from_location ? rows.find(r => r.location === input.from_location) : rows[0]
      if (!row) return fail(`"${input.ingredient}" isn't tracked in stock.`)
      const res = await fetch(`${ctx.origin}/api/stock/${row.id}`, {
        method: 'PATCH', headers: authHeaders(ctx), body: JSON.stringify({ location: input.to_location }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return fail(body.error || 'Could not move that item.')
      }
      return ok(`Moved ${row.ingredient_name} to the ${input.to_location}.`)
    },
  },
  {
    name: 'delete_stock_item',
    description: 'Stop tracking a stock item entirely (removes it from stock, not just sets it to zero). Destructive — requires confirm_text.',
    input_schema: withConfirm({ ingredient: { type: 'string' }, location: { type: 'string', enum: ['freezer', 'fridge', 'pantry'] } }, ['ingredient']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const ingResolved = resolveOrFail(await resolveIngredient(String(input.ingredient)), r => r.name, 'ingredient', String(input.ingredient))
      if ('result' in ingResolved) return ingResolved.result
      const rows = await stockRowsForIngredient(ingResolved.row)
      const row = input.location ? rows.find(r => r.location === input.location) : rows[0]
      if (!row) return fail(`"${input.ingredient}" isn't tracked in stock.`)
      const res = await fetch(`${ctx.origin}/api/stock/${row.id}`, { method: 'DELETE', headers: authHeaders(ctx) })
      if (!res.ok) return fail('Could not remove that stock item.')
      return ok(`Removed ${row.ingredient_name} (${row.location}) from stock.`)
    },
  },

  // ------------------------------------------------------------------
  // Meal plan — app/api/meals/{week,reroll,plan/[id],cook-log,generate}
  // ------------------------------------------------------------------
  {
    name: 'query_meal_plan',
    description: 'Read what\'s planned for a date or date range (e.g. today, tomorrow, this week). Read-only, immediate. Pass ISO dates (YYYY-MM-DD).',
    input_schema: schema({ start_date: { type: 'string' }, end_date: { type: 'string', description: 'Optional — defaults to start_date for a single day.' } }, ['start_date']),
    requiresConfirmation: false,
    async execute(input) {
      const start = String(input.start_date)
      const end = String(input.end_date ?? input.start_date)
      const { data } = await supabase.from('meal_plans')
        .select('plan_date, slot, role, dish_name, skipped')
        .gte('plan_date', start).lte('plan_date', end).eq('skipped', false).not('dish_id', 'is', null)
        .order('plan_date')
      const rows = (data ?? []) as { plan_date: string; slot: string; dish_name: string | null }[]
      if (rows.length === 0) return ok(`Nothing planned between ${start} and ${end}.`)
      const byDate = new Map<string, string[]>()
      for (const r of rows) {
        const list = byDate.get(r.plan_date) ?? []
        list.push(`${r.slot}: ${r.dish_name}`)
        byDate.set(r.plan_date, list)
      }
      return ok([...byDate.entries()].map(([d, items]) => `${d} — ${items.join(', ')}`).join(' | '))
    },
  },
  {
    name: 'reroll_meal_slot',
    description: 'Change what\'s planned for a specific slot on a specific day — either to a named dish, or "surprise me" (random) if no dish is given. Changes the meal plan — requires confirm_text.',
    input_schema: withConfirm({
      date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
      slot: { type: 'string', enum: ['utama', 'kuah', 'sayuran', 'pelengkap', 'breakfast', 'desert'] },
      dish_name: { type: 'string', description: 'Optional — leave out for a random reroll.' },
    }, ['date', 'slot']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      let dish_id: string | undefined
      if (input.dish_name) {
        const resolved = resolveOrFail(await resolveDish(String(input.dish_name)), r => r.name, 'dish', String(input.dish_name))
        if ('result' in resolved) return resolved.result
        dish_id = resolved.row.id
      }
      const res = await fetch(`${ctx.origin}/api/meals/reroll`, {
        method: 'POST', headers: authHeaders(ctx),
        body: JSON.stringify({ plan_date: input.date, slot: input.slot, ...(dish_id ? { dish_id } : {}) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return fail(body.error || 'Could not change that slot.')
      }
      return ok(`Updated the ${input.slot} for ${input.date}${input.dish_name ? ` to ${input.dish_name}` : ' (rerolled)'}.`)
    },
  },
  {
    name: 'lock_meal_slot',
    description: 'Lock or unlock a meal-plan slot so it\'s protected from reroll/regenerate. Low-stakes, immediate.',
    input_schema: schema({ date: { type: 'string' }, slot: { type: 'string' }, locked: { type: 'boolean' } }, ['date', 'slot', 'locked']),
    requiresConfirmation: false,
    async execute(input, ctx) {
      const { data: row } = await supabase.from('meal_plans').select('id').eq('plan_date', input.date).eq('slot', input.slot).maybeSingle()
      if (!row) return fail(`Nothing planned in ${input.slot} on ${input.date}.`)
      const res = await fetch(`${ctx.origin}/api/meals/plan/${row.id}`, {
        method: 'PATCH', headers: authHeaders(ctx), body: JSON.stringify({ locked: input.locked }),
      })
      if (!res.ok) return fail('Could not update the lock.')
      return ok(`${input.locked ? 'Locked' : 'Unlocked'} ${input.slot} on ${input.date}.`)
    },
  },
  {
    name: 'mark_dish_cooked',
    description: 'Mark a specific dish, or the whole day, as cooked. This ACTUALLY DEPLETES STOCK for that dish\'s ingredients — requires confirm_text.',
    input_schema: withConfirm({
      date: { type: 'string' },
      slot: { type: 'string', description: 'Omit to mark the WHOLE DAY cooked.' },
    }, ['date']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      if (!input.slot) {
        const res = await fetch(`${ctx.origin}/api/meals/cook-log`, {
          method: 'POST', headers: authHeaders(ctx), body: JSON.stringify({ cook_date: input.date }),
        })
        if (!res.ok) return fail('Could not mark the day cooked.')
        return ok(`Marked ${input.date} cooked.`)
      }
      const { data: row } = await supabase.from('meal_plans').select('slot, role, dish_id, dish_name')
        .eq('plan_date', input.date).eq('slot', input.slot).maybeSingle()
      if (!row?.dish_id) return fail(`Nothing planned in ${input.slot} on ${input.date}.`)
      const res = await fetch(`${ctx.origin}/api/meals/cook-log`, {
        method: 'POST', headers: authHeaders(ctx),
        body: JSON.stringify({
          cook_date: input.date,
          entries: [{ slot: row.slot, role: row.role, planned_dish_id: row.dish_id, planned_dish_name: row.dish_name, actual_dish_id: row.dish_id, actual_dish_name: row.dish_name, cooked: true }],
        }),
      })
      if (!res.ok) return fail('Could not mark that dish cooked.')
      return ok(`Marked ${row.dish_name} (${input.date}) cooked.`)
    },
  },
  {
    name: 'generate_week',
    description: 'Regenerate the whole week\'s meal plan (replaces every non-locked slot). Big, week-altering change — requires confirm_text.',
    input_schema: withConfirm({ week_start: { type: 'string', description: 'ISO Monday date of the week to generate.' } }, ['week_start']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const res = await fetch(`${ctx.origin}/api/meals/generate`, {
        method: 'POST', headers: authHeaders(ctx), body: JSON.stringify({ weekStart: input.week_start }),
      })
      if (!res.ok) return fail('Could not generate that week.')
      return ok(`Generated the week of ${input.week_start}.`)
    },
  },

  // ------------------------------------------------------------------
  // Dishes — app/api/meals/dishes[/[id]] — kept deliberately minimal (see
  // build report: a full "edit any of 22 dish fields" tool isn't safe for
  // voice+LLM to pick reliably, so only add/delete are exposed).
  // ------------------------------------------------------------------
  {
    name: 'add_dish',
    description: 'Add a new dish to the Dishes list. Simple add, immediate.',
    input_schema: schema({ name: { type: 'string' }, slot: { type: 'string', enum: ['utama', 'kuah', 'sayuran', 'pelengkap', 'breakfast', 'desert', 'fruit'] } }, ['name', 'slot']),
    requiresConfirmation: false,
    async execute(input, ctx) {
      const res = await fetch(`${ctx.origin}/api/meals/dishes`, { method: 'POST', headers: authHeaders(ctx), body: JSON.stringify({ name: input.name, slot: input.slot }) })
      if (!res.ok) return fail('Could not add that dish.')
      return ok(`Added "${input.name}" as a new ${input.slot} dish.`)
    },
  },
  {
    name: 'delete_dish',
    description: 'Delete a dish entirely. Destructive — requires confirm_text.',
    input_schema: withConfirm({ name: { type: 'string' } }, ['name']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const resolved = resolveOrFail(await resolveDish(String(input.name)), r => r.name, 'dish', String(input.name))
      if ('result' in resolved) return resolved.result
      const dish = resolved.row
      // Same DELETE the Dishes-tab UI button calls — FK cleanup (meal_plans
      // references nulled/skipped, dish_ingredients cascaded) happens
      // exactly the way it already does for a manual delete, not reimplemented here.
      const res = await fetch(`${ctx.origin}/api/meals/dishes/${dish.id}`, { method: 'DELETE', headers: authHeaders(ctx) })
      if (!res.ok) return fail('Could not delete that dish.')
      return ok(`Deleted "${dish.name}".`)
    },
  },

  // ------------------------------------------------------------------
  // Ingredients — app/api/meals/ingredients
  // ------------------------------------------------------------------
  {
    name: 'add_ingredient',
    description: 'Add a new ingredient to the canonical ingredients catalog (used by dishes and stock). Simple add, immediate.',
    input_schema: schema({ name: { type: 'string' }, category: { type: 'string', enum: ['protein', 'veg', 'fruit', 'bumbu', 'pantry', 'other'] } }, ['name']),
    requiresConfirmation: false,
    async execute(input, ctx) {
      const res = await fetch(`${ctx.origin}/api/meals/ingredients`, {
        method: 'POST', headers: authHeaders(ctx), body: JSON.stringify({ name: input.name, category: input.category ?? 'other' }),
      })
      if (!res.ok) return fail('Could not add that ingredient.')
      return ok(`Added "${input.name}" as an ingredient.`)
    },
  },

  // ------------------------------------------------------------------
  // Expenses — see build report: NO existing add-expense action was found
  // anywhere in the codebase (ExpensesClient only reads/deletes) — these
  // call a NEW, minimal app/api/expenses route added for this build,
  // matching the exact `expenses` table shape the Expenses page already
  // reads (date, store, items, total, currency, logged_by, notes).
  // ------------------------------------------------------------------
  {
    name: 'log_expense',
    description: 'Log a new expense. Spends money — requires confirm_text.',
    input_schema: withConfirm({
      store: { type: 'string' },
      total: { type: 'number' },
      currency: { type: 'string', description: 'Defaults to IDR.' },
      notes: { type: 'string' },
    }, ['store', 'total']),
    requiresConfirmation: true,
    async execute(input, ctx) {
      const res = await fetch(`${ctx.origin}/api/expenses`, {
        method: 'POST', headers: authHeaders(ctx),
        body: JSON.stringify({
          date: jakartaToday(), store: input.store, total: input.total,
          currency: input.currency ?? 'IDR', notes: input.notes ?? null, logged_by: ctx.session?.name ?? null,
        }),
      })
      if (!res.ok) return fail('Could not log that expense.')
      return ok(`Logged ${input.currency ?? 'IDR'} ${input.total} at ${input.store}.`)
    },
  },
  {
    name: 'query_expenses',
    description: 'Read total spending over a date range (e.g. this month, today). Read-only, immediate. Pass ISO dates.',
    input_schema: schema({ start_date: { type: 'string' }, end_date: { type: 'string' } }, ['start_date', 'end_date']),
    requiresConfirmation: false,
    async execute(input) {
      const { data } = await supabase.from('expenses').select('store, total, currency, date')
        .gte('date', String(input.start_date)).lte('date', String(input.end_date)).order('date')
      const rows = (data ?? []) as { store: string | null; total: number; currency: string; date: string }[]
      if (rows.length === 0) return ok(`No expenses logged between ${input.start_date} and ${input.end_date}.`)
      const byCurrency = new Map<string, number>()
      for (const r of rows) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + Number(r.total))
      const totals = [...byCurrency.entries()].map(([c, t]) => `${c} ${t}`).join(', ')
      return ok(`${rows.length} expense(s) between ${input.start_date} and ${input.end_date}, total ${totals}.`)
    },
  },

  // ------------------------------------------------------------------
  // Backlog — app/api/backlog/items
  // ------------------------------------------------------------------
  {
    name: 'add_backlog_item',
    description: 'Add an item to the backlog (someday/maintenance list). Simple add, immediate.',
    input_schema: schema({ title: { type: 'string' }, category: { type: 'string', enum: ['car', 'kitchen', 'home_maint', 'outdoor', 'online', 'errand', 'other'] } }, ['title']),
    requiresConfirmation: false,
    async execute(input, ctx) {
      const res = await fetch(`${ctx.origin}/api/backlog/items`, {
        method: 'POST', headers: authHeaders(ctx), body: JSON.stringify({ title: input.title, category: input.category ?? 'other' }),
      })
      if (!res.ok) return fail('Could not add that to the backlog.')
      return ok(`Added "${input.title}" to the backlog.`)
    },
  },
]

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find(t => t.name === name)
}
