# Prep-first day page — design

## Goal

Invert `/meals/day/[date]`: lead with a checkable "what to prepare" list
(sourced from a real, persisted `prep_tasks` table instead of the current
on-the-fly computation), with today's finished meals moved below as
smaller, secondary reference. Auto-derive `prep_tasks` rows from the plan
when a week is generated, and as a lazy backfill when the day page loads
for a week that predates this feature.

## Non-goals

- Rerolling a single day/dish does not reconcile `prep_tasks` — a reroll
  can occasionally leave a task stale (for a dish that's no longer
  planned) or missing (for a newly-planned one) until the next full
  "Generate Week". Acceptable for now; a follow-up can tighten this.
- No WhatsApp integration in this batch (that's Batch 4) — the WA cron
  route's `buildPrepBatches` is untouched, on purpose, per the existing
  comment in `lib/meals/prep.ts` ("tested, already-shipped message
  composition code is never touched by this feature").
- No backfill migration script — the day page's lazy generation covers
  existing weeks (including the current and next real week, already
  generated under the old model) the first time each is viewed.
- `needs_thaw`/`needs_marinate` stay as they are (both effectively unused
  today — `needs_thaw` is `false` on every dish in the table). `prep_type`
  is the sole driver of the new generation logic; the two boolean columns
  are not read by it.

## Data already in place

- `dishes.prep_type`: `'thaw' | 'marinate' | 'cook_overnight' | 'cut' | 'portion' | 'thaw_marinate' | null`.
  Currently 9 dishes are `'marinate'`, 2 are `'cook_overnight'`, 98 are
  untagged (`null`) — same "tag more over time" situation as `cadence`/
  `produce_role` from the last batch.
- `dishes.shop_ingredients` (jsonb, same shape as `ingredients`): raw
  components with amounts. Populated for 15 dishes, `null` for the rest.
- `dishes.prep_lead_days`, `prep_note`, `protein`, `bumbu_packet`,
  `recipe_links` — all already used elsewhere in the app.
- `prep_tasks` table (already migrated, currently empty, no app code
  touches it yet):
  ```
  id uuid pk, cook_date date not null, prep_date date not null,
  dish_id uuid null references dishes(id), dish_name text,
  prep_type text, instruction text, assigned_to text default 'Wife',
  done boolean default false, done_at timestamptz, created_at timestamptz
  ```
  `dish_id` is nullable specifically so the weekend batch-thaw task (which
  covers multiple dishes) can have one row with no single owning dish.
  No unique constraint beyond the primary key — dedup is an application
  concern (see below).

## `lib/meals/prepTasks.ts` (new, pure — no DB access)

### Types

```ts
export type PlannedDish = {
  cook_date: string
  dish_id: string
  dish_name: string
  prep_type: string | null
  prep_lead_days: number | null
  prep_note: string | null
  protein: string
}

export type PrepTaskDraft = {
  cook_date: string          // the dish's cook_date, or weekStart for the weekend batch
  prep_date: string
  dish_id: string | null     // null only for the weekend batch-thaw task
  dish_name: string | null   // null for the batch task (its instruction lists everything)
  prep_type: string          // 'thaw' | 'marinate' | 'cook_overnight' | 'cut' | 'portion' | 'thaw_batch'
  instruction: string
  assigned_to: string
}
```

`'thaw_batch'` is a new `prep_type` value used ONLY for the consolidated
weekend row — distinct from `'thaw'` so the day page can render it with
its own icon/copy and so dedup lookups don't confuse it with a per-dish
thaw task (which this design never actually emits — see below).

### Instruction templates

`prep_note` on the dish, when set, always overrides the templated text
(same convention as today's `prepPhrase` in `lib/meals/prep.ts`):

```ts
function templateFor(prepType: string, dish: { dish_name: string; protein: string }): string {
  switch (prepType) {
    case 'marinate': return `Marinate ${dish.dish_name}`
    case 'cook_overnight': return `Masak ${dish.dish_name} malam ini (untuk besok)`
    case 'cut': return `Potong ${dish.dish_name}`
    case 'portion': return `Porsi ${dish.dish_name}`
    default: return `Siapkan ${dish.dish_name}`
  }
}
```

### `deriveDishTasks` — per-dish tasks (marinate / cook_overnight / cut / portion / thaw_marinate's marinate half)

```ts
import { prepDateFor } from './dates'

export function deriveDishTasks(planned: PlannedDish[]): PrepTaskDraft[] {
  const drafts: PrepTaskDraft[] = []
  for (const d of planned) {
    if (!d.prep_type) continue
    // The thaw half of thaw_marinate is handled by the weekend batch instead;
    // its marinate half still runs as a normal per-day task.
    const effectiveType = d.prep_type === 'thaw_marinate' ? 'marinate' : d.prep_type
    if (effectiveType === 'thaw') continue // pure-thaw dishes are batch-only, no per-day task
    const prep_date = prepDateFor(d.cook_date, d.prep_lead_days)
    const instruction = d.prep_note?.trim() || templateFor(effectiveType, d)
    drafts.push({
      cook_date: d.cook_date, prep_date, dish_id: d.dish_id, dish_name: d.dish_name,
      prep_type: effectiveType, instruction, assigned_to: 'Wife',
    })
  }
  return drafts
}
```

### `deriveWeekendBatch` — the consolidated thaw task

```ts
import { mondayOf, shiftWeek } from './dates'

// One task covering every 'thaw'/'thaw_marinate' dish planned for the
// week, dated the Sunday immediately before the week starts.
export function deriveWeekendBatch(weekStart: string, planned: PlannedDish[]): PrepTaskDraft | null {
  const thawDishes = planned.filter(d => d.prep_type === 'thaw' || d.prep_type === 'thaw_marinate')
  if (thawDishes.length === 0) return null
  const prep_date = shiftWeek(mondayOf(weekStart), -1) // the Sunday before
  const parts = thawDishes.map(d => `${d.protein || d.dish_name} (${shortDayName(d.cook_date)})`)
  return {
    cook_date: weekStart, prep_date, dish_id: null, dish_name: null,
    prep_type: 'thaw_batch', instruction: `Pindah ke chiller: ${parts.join(', ')}`, assigned_to: 'Wife',
  }
}
```

(`shortDayName` — a small local date→weekday-abbreviation helper, same
approach already used in `app/meals/day/[date]/page.tsx`.)

### `deriveWeekPrepTasks` — the combined entry point

```ts
export function deriveWeekPrepTasks(weekStart: string, planned: PlannedDish[]): PrepTaskDraft[] {
  const batch = deriveWeekendBatch(weekStart, planned)
  return [...deriveDishTasks(planned), ...(batch ? [batch] : [])]
}
```

## Persistence & dedup (route layer)

A small shared helper, `upsertPrepTasks(weekStart, drafts)`, used by both
trigger points:

1. Query existing `prep_tasks` rows for the relevant window (`prep_date`
   between the weekend-before and the week's last day).
2. For each draft, check whether a matching row already exists:
   - per-dish: same `(cook_date, dish_id, prep_type)`
   - weekend batch: same `(prep_date, prep_type = 'thaw_batch')`
3. Insert only the drafts with no match. **Never update or delete an
   existing row here** — that's what keeps a checked `done` from being
   silently reset when the same week is viewed/generated again.

## Trigger points

- `app/api/meals/generate/route.ts`: after composing and persisting the
  week's `meal_plans` (and dessert batches), fetch the joined dish fields
  needed for `PlannedDish`, call `deriveWeekPrepTasks`, then
  `upsertPrepTasks`.
- `app/meals/day/[date]/page.tsx`: before rendering, check whether any
  `prep_tasks` rows exist with `prep_date` in the surrounding window; if
  the day (or its lookahead window) has planned dishes but no matching
  prep tasks at all, run the same derive+upsert as a backfill. This is
  what makes the current and next real week (already generated under the
  old model) get correct prep tasks the first time their day pages are
  opened after this ships.

## API

New `app/api/meals/prep-tasks/[id]/route.ts`:
```ts
PATCH { done: boolean } → sets done and done_at (now() when true, null when false), returns the updated row.
```

## Day page redesign (`DayView.tsx`)

Top to bottom:

1. **🔪 Persiapan hari ini** — prep tasks where `prep_date` = this page's
   date. Warm accent background (`bg-amber-50 border-amber-200`),
   prominent placement (first section, right under the day header).
   Each task is one big vertically-stacked, tappable row:
   - checkbox (large tap target, ~44px) → `PATCH` toggles `done`
   - icon by `prep_type`: 🧊 thaw_batch, 🫙 marinate, 🍲 cook_overnight,
     🔪 cut, 📦 portion
   - instruction text + target-day context, e.g. "🧊 Pindah ke chiller:
     ayam (Senin), udang (Rabu)" or "🫙 Marinate Ayam bumbu bakar (untuk
     besok, Selasa)"
   - a small raw-amount chip when resolvable from the dish's
     `shop_ingredients` (only for per-dish tasks with a `dish_id`)
   - done tasks show checked + dimmed (strikethrough), stay in the list
     (not removed) so she can see what's already handled
   - empty state: "Tidak ada persiapan khusus hari ini 👍"
   No horizontal scrolling, no side-by-side arrows — one column, stacked.
2. **Raw ingredients glance** (optional) — only rendered when at least one
   of today's planned dishes has non-null `shop_ingredients`; a compact
   chip row per dish: protein + veg + bumbu components with amounts.
3. **Today's meals** — same dishes as today's page, kept but visually
   de-emphasized: smaller thumbnails than the current `DishCard`,
   tightened spacing, clearly reads as "reference" below the prep focus.
   Recipe links, `bumbu_packet` tag, and quantities stay as they are today.

## `components/meals/DishesClient.tsx`

Add a `prep_type` dropdown (blank / thaw / marinate / cook_overnight /
cut / portion / thaw_marinate), shown for every slot (prep can apply to
any dish, not just fruit/desert like the last batch's fields) — next to
the existing cadence/produce_role/fruit_context dropdowns. `PATCH
/api/meals/dishes/[id]` FIELDS whitelist gains `prep_type`.

## Testing

- `lib/meals/prepTasks.test.ts` (new): `deriveDishTasks` (template per
  prep_type, `prep_note` override, `thaw_marinate` emits only the
  marinate half, plain `thaw` emits nothing), `deriveWeekendBatch` (empty
  when no thaw dishes, consolidates multiple, correct weekend date,
  instruction lists every dish), `deriveWeekPrepTasks` (combines both).
- Route-level dedup logic (`upsertPrepTasks`) verified manually against
  the live DB (generate a week, confirm rows; generate again, confirm no
  duplicates and an already-checked task stays checked) — this touches
  Supabase directly so it isn't unit-tested, consistent with how the rest
  of this codebase treats route-layer persistence.

## Files touched

**New:** `lib/meals/prepTasks.ts` (+ test), `app/api/meals/prep-tasks/[id]/route.ts`.

**Modified:** `app/api/meals/generate/route.ts`, `app/meals/day/[date]/page.tsx`,
`components/meals/DayView.tsx`, `components/meals/DishesClient.tsx`,
`app/api/meals/dishes/[id]/route.ts`.
