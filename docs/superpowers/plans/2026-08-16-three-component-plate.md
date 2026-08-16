# 3-Component Plate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a fixed 3-component plate (main + sayuran + conditional soup + optional desert), retire `pelengkap` from generation, and exclude `is_garnish`/inactive dishes.

**Architecture:** Rewrite `composeDay` in the TDD'd `lib/meals/engine.ts`; add a hard garnish exclusion to `passesHardRules` + last-resort; extend `validateWeek`; add an editor toggle. Routes pass the field through unchanged.

**Tech Stack:** Next.js 16.2.4, TypeScript (strict), Supabase JS (anon), lucide-react, Vitest.

## Global Constraints

- **Engine stays pure**; all rule/compose changes unit-tested.
- **Garnish + inactive are hard exclusions** (never relaxed): `dish.active && !dish.is_garnish`.
- **Do NOT** drop the pelengkap column or delete pelengkap dishes. Just stop generating that slot.
- Supabase via shared `supabase`, anon key. Design system unchanged.

---

## File Structure

**Modify:** `lib/meals/types.ts`, `lib/meals/engine.ts`, `lib/meals/engine.test.ts`,
`app/api/meals/dishes/route.ts`, `app/api/meals/dishes/[id]/route.ts`, `components/meals/DishesClient.tsx`.

---

## Task 1: Types + garnish exclusion

**Files:** `lib/meals/types.ts`, `lib/meals/engine.ts`, `lib/meals/engine.test.ts`

- [ ] **Step 1: Add the field to `Dish`**

In `lib/meals/types.ts`, in `Dish`, add:
```ts
  is_garnish: boolean
```

- [ ] **Step 2: Update the test `dish()` fixture**

In `lib/meals/engine.test.ts`, add to the `dish()` defaults:
```ts
    saltiness: 'normal', difficulty: 'medium', is_garnish: false, ...over,
```

- [ ] **Step 3: Write failing exclusion tests**

Append to `engine.test.ts` (near the `passesHardRules`/`candidates` area — add a new describe):
```ts
describe('garnish + inactive exclusion', () => {
  it('excludes garnish and inactive dishes from candidates', () => {
    const ok = dish({ id: 'ok', slot: 'sayuran' })
    const garnish = dish({ id: 'g', slot: 'sayuran', is_garnish: true })
    const inactive = dish({ id: 'i', slot: 'sayuran', active: false })
    const c = ctx({ date: '2026-08-13', slot: 'sayuran', dishes: [ok, garnish, inactive] })
    expect(passesHardRules(ok, c)).toBe(true)
    expect(passesHardRules(garnish, c)).toBe(false)
    expect(passesHardRules(inactive, c)).toBe(false)
    expect(candidates([ok, garnish, inactive], c).map(d => d.id)).toEqual(['ok'])
  })
  it('never picks a garnish dish even at last resort', () => {
    const garnish = dish({ id: 'g', slot: 'sayuran', is_garnish: true })
    const c = ctx({ date: '2026-08-13', slot: 'sayuran', dishes: [garnish] })
    expect(pickForSlot([garnish], c, seq([0.5])).dish_id).toBeNull()
  })
})
```
(`candidates` must be imported — add it to the engine import if not already.)

- [ ] **Step 4: Run to verify failure**

Run: `npm test -- engine` → FAIL (garnish still allowed).

- [ ] **Step 5: Add the exclusion to engine**

In `passesHardRules`, add `!dish.is_garnish`:
```ts
export function passesHardRules(dish: Dish, ctx: PickContext): boolean {
  return (
    dish.active &&
    !dish.is_garnish &&
    dish.slot === ctx.slot &&
    noRepeatOk(dish, ctx) &&
    proteinOk(dish, ctx) &&
    proteinClashOk(dish, ctx) &&
    specialOk(dish, ctx) &&
    friedOk(dish, ctx) &&
    spicyOk(dish, ctx) &&
    saltinessOk(dish, ctx) &&
    difficultyOk(dish, ctx)
  )
}
```
In `pickForSlot`'s last-resort filter, add `!d.is_garnish`:
```ts
  const anyActive = slotDishes.filter(d => d.active && !d.is_garnish && d.slot === ctx.slot && noRepeatOk(d, lastCtx) && saltinessOk(d, lastCtx))
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- engine` → PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/meals/types.ts lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): exclude garnish + inactive dishes from generation"
```

---

## Task 2: composeDay — 3-component plate

**Files:** `lib/meals/engine.ts`, `lib/meals/engine.test.ts`

**Interfaces:** `composeDay` output changes: main + sayuran + soup(or skipped) + desert; no pelengkap.

- [ ] **Step 1: Rewrite the composeDay compose tests**

Find the existing `describe('composeDay', …)` block in `engine.test.ts` and replace its body with:
```ts
describe('composeDay (3-component plate)', () => {
  function pools() {
    const mk = (slot: Slot, n: number, over: (i: number) => Partial<Dish> = () => ({})) =>
      Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over(i),
        protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
    return { utama: mk('utama', 12), kuah: mk('kuah', 8), pelengkap: mk('pelengkap', 9),
      sayuran: mk('sayuran', 8), desert: mk('desert', 8) }
  }
  const run = (dishesBySlot: Record<Slot, Dish[]>) => {
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    return composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
  }

  it('main that does NOT provide soup → main + sayuran + soup + desert, no pelengkap', () => {
    const p = pools(); p.utama.forEach(d => { d.provides_soup = false })
    const created = run(p)
    expect(created.some(x => x.role === 'main' && x.slot === 'utama')).toBe(true)
    expect(created.some(x => x.slot === 'sayuran' && x.dish_id)).toBe(true)
    expect(created.some(x => x.slot === 'kuah' && x.dish_id && !x.skipped)).toBe(true)
    expect(created.some(x => x.slot === 'desert' && x.role === 'optional')).toBe(true)
    expect(created.some(x => x.slot === 'pelengkap')).toBe(false)
  })
  it('main that provides soup → soup slot skipped, no soup dish, no pelengkap', () => {
    const p = pools(); p.utama.forEach(d => { d.provides_soup = true })
    const created = run(p)
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(kuah.skipped).toBe(true)
    expect(kuah.dish_id).toBeNull()
    expect(created.some(x => x.slot === 'kuah' && x.dish_id)).toBe(false)
    expect(created.some(x => x.slot === 'pelengkap')).toBe(false)
    expect(created.some(x => x.slot === 'sayuran' && x.dish_id)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- engine` → FAIL (still generates pelengkap / richness budget).

- [ ] **Step 3: Rewrite composeDay in engine.ts**

Replace the composeDay body from the MAIN pick through DESERT (steps "3 SOUP skip", "4a VEG", "4b/c", "5 DESERT") with:
```ts
  // 1. MAIN
  let main: Dish | undefined
  if (isLocked('utama')) {
    main = lockedDish('utama')
  } else {
    const p = pickForSlot(dishesBySlot.utama ?? [], mkCtx('utama', 'main', 1), rng)
    push(p)
    main = p.dish_id ? dishById.get(p.dish_id) : undefined
  }
  const providesSoup = main?.provides_soup ?? false

  // 2. SAYURAN — always
  if (!isLocked('sayuran')) {
    push(pickForSlot(dishesBySlot.sayuran ?? [], mkCtx('sayuran', 'support', providesSoup ? 0 : 1), rng))
  }

  // 3. SOUP — skipped when the main provides soup, otherwise picked
  if (!isLocked('kuah')) {
    if (providesSoup) {
      push({ plan_date: date, slot: 'kuah', dish_id: null, dish_name: null, locked: false, role: 'support', skipped: true })
    } else {
      push(pickForSlot(dishesBySlot.kuah ?? [], mkCtx('kuah', 'support', 0), rng))
    }
  }

  // 4. DESERT — optional
  if (!isLocked('desert')) {
    push(pickForSlot(dishesBySlot.desert ?? [], mkCtx('desert', 'optional', 0), rng))
  }

  return created
}
```
Remove the now-unused `const richness`/`const extra` lines and the entire `pickPreferNonFried` function (grep to confirm no other references).

- [ ] **Step 4: Fix the generateWeek integration tests**

The existing `generateWeek` tests assume 5-slot fills. Update any assertion that expects a pelengkap/side pick. Ensure the `generateWeek (saltiness + difficulty)` and compose tests assert **no pelengkap** and (where they check supports) sayuran+soup. Add to the main `generateWeek` invariants test:
```ts
    expect(picks.some(p => p.slot === 'pelengkap' && p.dish_id)).toBe(false)
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- engine` → PASS (all engine tests).

- [ ] **Step 6: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): compose a 3-component plate (main + sayuran + conditional soup)"
```

---

## Task 3: validateWeek — garnish + pelengkap checks

**Files:** `lib/meals/engine.ts`, `lib/meals/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the `describe('validateWeek', …)` block:
```ts
  it('flags a garnish dish and a pelengkap pick in the week', () => {
    const byId = new Map<string, Dish>([
      ['g', dish({ id: 'g', slot: 'sayuran', name: 'Teri krispi', is_garnish: true })],
      ['p', dish({ id: 'p', slot: 'pelengkap', name: 'Old side' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'g' },
      { plan_date: '2026-08-18', dish_id: 'p' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('garnish') && v.includes('Teri krispi'))).toBe(true)
    expect(report.some(v => v.includes('pelengkap'))).toBe(true)
  })
```

- [ ] **Step 2: Run to verify failure** — `npm test -- engine` → FAIL.

- [ ] **Step 3: Extend validateWeek**

Inside the per-date loop in `validateWeek`, after the fried check, add:
```ts
    const garnish = ds.filter(d => d.is_garnish)
    if (garnish.length) viol.push(`⚠️ ${date}: garnish dish planned (${garnish.map(d => d.name).join(', ')})`)
    const peleng = ds.filter(d => d.slot === 'pelengkap')
    if (peleng.length) viol.push(`⚠️ ${date}: pelengkap slot generated (${peleng.map(d => d.name).join(', ')})`)
```

- [ ] **Step 4: Run to verify pass** — `npm test -- engine` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): validateWeek flags garnish + pelengkap picks"
```

---

## Task 4: Routes — is_garnish default + PATCH field

**Files:** `app/api/meals/dishes/route.ts`, `app/api/meals/dishes/[id]/route.ts`

- [ ] **Step 1: POST default**

In `app/api/meals/dishes/route.ts` `insert({...})`, add:
```ts
    is_garnish: body.is_garnish ?? false,
```

- [ ] **Step 2: PATCH FIELDS**

In `app/api/meals/dishes/[id]/route.ts`, add `'is_garnish'` to `FIELDS`.

- [ ] **Step 3: Commit**

```bash
git add app/api/meals/dishes/route.ts app/api/meals/dishes/[id]/route.ts
git commit -m "feat(meals): accept is_garnish on dish create/edit"
```

---

## Task 5: Dishes editor — is_garnish toggle + label

**Files:** `components/meals/DishesClient.tsx`

- [ ] **Step 1: Add the header + colSpan**

After the `Active` header add:
```tsx
                    <th className="px-3 py-2 font-medium">Garnish</th>
```
Bump the empty-state `colSpan` from 11 to 12.

- [ ] **Step 2: Add the toggle cell (mirror the Active toggle)**

After the Active `<td>` in `DishRow`, add:
```tsx
      <td className="px-3 py-1.5">
        <button onClick={() => onPatch(dish.id, { is_garnish: !dish.is_garnish })} aria-label="Toggle garnish"
          className={`w-9 h-5 rounded-full transition-colors relative ${dish.is_garnish ? 'bg-stone-500' : 'bg-stone-200'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${dish.is_garnish ? 'left-4' : 'left-0.5'}`} />
        </button>
      </td>
```

- [ ] **Step 3: Add the "not auto-planned" label under the name**

In the Name cell, below the name `<input>` (inside the same flex-col or after the input's parent), show a muted label when garnish. Wrap the name input area so the label sits beneath it:
```tsx
          <div className="min-w-0 flex-1">
            <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
              placeholder="Dish name…"
              onBlur={() => name.trim() && name !== dish.name && onPatch(dish.id, { name: name.trim() })}
              className="w-full min-w-[11rem] bg-transparent text-stone-800 focus:outline-none focus:bg-stone-50 rounded px-1 py-0.5" />
            {dish.is_garnish && <div className="text-[10px] text-stone-400 px-1">garnish — not auto-planned</div>}
          </div>
```
(Adjust the surrounding `<div className="flex items-center gap-2">` to keep the `DishImage` + this block aligned; the DishImage stays first.)

- [ ] **Step 4: Manual check**

Run dev; `/meals/dishes`. Verify: Garnish toggle shows + persists (reload); garnish dishes (Teri krispi, Baby cumi pedas, Sambel tempe teri) show the "garnish — not auto-planned" label; toggling on/off works.

- [ ] **Step 5: Commit**

```bash
git add components/meals/DishesClient.tsx
git commit -m "feat(meals): add is_garnish toggle + label to dishes editor"
```

---

## Task 6: Verification + build + report

- [ ] **Step 1: Unit tests** — `npm test`; all green.
- [ ] **Step 2: Build** — `npm run build`; no type errors.
- [ ] **Step 3: Plan UI check** — generate a week; each plate shows main hero + sayuran + soup (or "🥣 broth from the main" note); **no pelengkap card**; desert row present. Confirm no PlanClient change was needed (it renders `role:'support'` generically).
- [ ] **Step 4: Validation report** — generate several fresh weeks; capture the `[meal-gen]` dev log. Expect `validation: clean ✓` (no salty/fried/difficulty/special/protein violations, no garnish, no pelengkap). Also run an independent DB scan confirming no pelengkap-slot or garnish dishes appear in a generated week.
- [ ] **Step 5: Commit any fixes**
```bash
git add -A && git commit -m "fix(meals): resolve issues from 3-component plate verification"
```

---

## Self-Review Notes (for the planner, not a task)

- **Spec coverage:** 3-component composeDay (T2), garnish/inactive hard exclusion (T1), validateWeek garnish+pelengkap (T3), routes (T4), editor toggle+label (T5), UI + report verification (T6). ✅
- **Dead code:** `pickPreferNonFried` and the `richness`/`extra` locals are removed in T2 Step 3 (grep to confirm no stragglers).
- **Rule-test pelengkap usages** (proteinClashOk/friedOk/spicyOk tests using `slot:'pelengkap'` as an arbitrary support) stay valid — pelengkap is still a `Slot`; only the composeDay/generateWeek composition tests change.
- **Reroll** needs no change: recompose calls `composeDay` (drops pelengkap); single-slot reroll + alternatives go through `passesHardRules`/last-resort, which now exclude garnish.
- **UI** likely unchanged: `PlanClient` renders support rows generically; post-regenerate a plate is sayuran + soup. T6 Step 3 verifies.
