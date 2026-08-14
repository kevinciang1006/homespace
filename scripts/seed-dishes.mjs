// Populate dishes.ingredients + dishes.recipe_steps from scripts/dish-seed.json.
//
// Prereq: the recipe_steps + image_url columns exist (see migrations/2026-08-13-dish-content-columns.sql).
//
// Usage:
//   node --env-file=.env.local scripts/seed-dishes.mjs          # seed dishes that have no content yet
//   node --env-file=.env.local scripts/seed-dishes.mjs --force  # overwrite existing content too
//   node --env-file=.env.local scripts/seed-dishes.mjs --list   # print all dishes as JSON (no writes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — run with --env-file=.env.local')
  process.exit(1)
}
const supabase = createClient(url, key)

const force = process.argv.includes('--force')
const listOnly = process.argv.includes('--list')

const { data: dishes, error } = await supabase.from('dishes').select('*').order('slot').order('name')
if (error) { console.error('Failed to read dishes:', error.message); process.exit(1) }

if (listOnly) {
  console.log(JSON.stringify(
    dishes.map(d => ({ name: d.name, slot: d.slot, protein: d.protein, method: d.method, spicy: d.spicy, tier: d.tier })),
    null, 2,
  ))
  process.exit(0)
}

const here = dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(readFileSync(join(here, 'dish-seed.json'), 'utf8'))
const byName = new Map(Object.entries(seed).map(([k, v]) => [k.trim().toLowerCase(), v]))

let updated = 0, skipped = 0
const unmatched = []
for (const d of dishes) {
  const s = byName.get(d.name.trim().toLowerCase())
  if (!s) { unmatched.push(d.name); continue }
  const hasContent =
    (Array.isArray(d.ingredients) && d.ingredients.length > 0) ||
    (Array.isArray(d.recipe_steps) && d.recipe_steps.length > 0)
  if (hasContent && !force) { skipped++; continue }
  const patch = {}
  if (s.ingredients) patch.ingredients = s.ingredients
  if (s.recipe_steps) patch.recipe_steps = s.recipe_steps
  const { error: upErr } = await supabase.from('dishes').update(patch).eq('id', d.id)
  if (upErr) { console.error(`✗ ${d.name}: ${upErr.message}`); continue }
  updated++
  console.log(`✓ ${d.name}`)
}

console.log(`\nDone. Updated ${updated}, skipped ${skipped} (already had content).`)
if (unmatched.length) console.log(`No seed entry for ${unmatched.length} dish(es): ${unmatched.join(', ')}`)
