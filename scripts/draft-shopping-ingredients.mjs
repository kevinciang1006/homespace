// Draft the SHOPPING-RELEVANT ingredients for each dish using AI: protein, fresh veg,
// and bumbu (instant spice packet) only — never shelf-stable pantry stuff. This is a
// DRAFT pass for human review, not final data: every write is tagged
// shop_ingredients_status = 'draft' so the app can show "AI draft — verify".
//
// Writes:
//   dishes.shop_ingredients      jsonb  [{ item, amount, unit, category }], category in
//                                       ('protein','veg','bumbu','other')
//   dishes.bumbu_packet          text   packet name, or null
//   dishes.shop_ingredients_status  text  'draft'
//
// Usage:
//   node --env-file=.env.local scripts/draft-shopping-ingredients.mjs --limit 30
//   node --env-file=.env.local scripts/draft-shopping-ingredients.mjs --limit 10 --force
//
// Requires GEMINI_API_KEY (free tier, https://aistudio.google.com/apikey) in .env.local.
import { createClient } from '@supabase/supabase-js'

const MODEL = 'gemini-2.5-flash'
const DELAY_MS = 4200 // free-tier gemini-2.5-flash is rate-limited to ~15 req/min

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const geminiKey = process.env.GEMINI_API_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — run with --env-file=.env.local')
  process.exit(1)
}
if (!geminiKey) {
  console.error('Missing GEMINI_API_KEY — get a free-tier key at https://aistudio.google.com/apikey and add it to .env.local')
  process.exit(1)
}
const supabase = createClient(url, key)

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2)
const force = args.includes('--force')
const limitArg = args.indexOf('--limit')
const limit = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity
if (limitArg !== -1 && (!Number.isFinite(limit) || limit <= 0)) {
  console.error('--limit must be a positive number')
  process.exit(1)
}

// Slots where a fresh-buy list is actually useful. Desert/fruit/breakfast are
// mostly pantry or already-fresh produce dishes — skip them for this draft pass.
const FOCUS_SLOTS = ['utama', 'sayuran', 'kuah']
const CATEGORIES = ['protein', 'veg', 'bumbu', 'other']
const QTY_UNITS = ['g', 'kg', 'pcs', 'slices', 'ekor', 'bunch', 'ml', 'pot']

// ---- prompt -------------------------------------------------------------------
const SYSTEM_PROMPT = `You draft the SHOPPING-RELEVANT ingredients for one Indonesian family dish (2 adults + 1 child).

Output ONLY these three buckets, as strict JSON, no prose, no markdown fences:
{
  "protein": { "item": string, "amount": number, "unit": string } | null,
  "veg": [ { "item": string, "amount": number, "unit": string } ],
  "bumbu": string | null
}

Rules:
- "protein": the dish's main protein + amount to buy, scaled for 2 adults + 1 child
  (e.g. chicken 500g, fish 2 ekor, pork 600g, shrimp 400g, crab 1 ekor). null if the
  dish has no protein (e.g. a plain vegetable side).
- "veg": ONLY vegetables central to the dish that must be bought fresh, with rough
  amounts (e.g. kangkung 400g, buncis 250g, tomat 3 pcs). Omit anything minor or
  garnish-only. Empty array if none.
- "bumbu": if the dish is commonly made with a store-bought Indonesian instant spice
  packet (rendang, gulai, kare/curry, opor, soto, ayam kalasan, bakar, rica, sate,
  tomyam, etc.), give the packet name exactly as sold, e.g. "Bumbu Rendang",
  "Bumbu Gulai", "Bumbu Bakar", "Bumbu Kalasan". If the dish is typically made from
  scratch, or is simple (steamed, plain fried, boiled), set this to null.

NEVER list (assume always on hand): cooking oil, salt, sugar, soy sauce/kecap,
shallots, garlic, ginger (unless ginger itself IS the dish), flour, cornstarch,
nestum, oats, water, everyday aromatics, MSG, pepper.

Prefer these units where they fit naturally: ${QTY_UNITS.join(', ')}.
Err toward FEWER ingredients — only the essential buy-fresh items. Better to
under-list than to list shelf-stable items.`

function dishPrompt(dish) {
  const qty = dish.qty_amount != null && dish.qty_unit ? `${dish.qty_amount}${dish.qty_unit}` : null
  return JSON.stringify({
    name: dish.name,
    slot: dish.slot,
    known_protein: dish.protein && dish.protein !== 'none' ? dish.protein : null,
    known_qty: qty,
    method: dish.method,
    spicy: dish.spicy,
  })
}

// ---- AI call -------------------------------------------------------------------
async function draftForDish(dish) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: dishPrompt(dish) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = await res.json()
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error(`No text in Gemini response: ${JSON.stringify(body).slice(0, 300)}`)
  return JSON.parse(text)
}

// Validate + flatten the AI's { protein, veg, bumbu } into the shop_ingredients shape.
function toShopIngredients(parsed) {
  if (typeof parsed !== 'object' || parsed === null) throw new Error('response is not an object')
  const { protein, veg, bumbu } = parsed
  if (protein !== null && protein !== undefined) {
    if (typeof protein.item !== 'string' || typeof protein.amount !== 'number' || typeof protein.unit !== 'string') {
      throw new Error(`invalid protein: ${JSON.stringify(protein)}`)
    }
  }
  if (veg !== undefined && !Array.isArray(veg)) throw new Error(`veg must be an array: ${JSON.stringify(veg)}`)
  for (const v of veg ?? []) {
    if (typeof v.item !== 'string' || typeof v.amount !== 'number' || typeof v.unit !== 'string') {
      throw new Error(`invalid veg item: ${JSON.stringify(v)}`)
    }
  }
  if (bumbu !== null && bumbu !== undefined && typeof bumbu !== 'string') {
    throw new Error(`invalid bumbu: ${JSON.stringify(bumbu)}`)
  }

  const shop_ingredients = []
  if (protein) shop_ingredients.push({ item: protein.item, amount: protein.amount, unit: protein.unit, category: 'protein' })
  for (const v of veg ?? []) shop_ingredients.push({ item: v.item, amount: v.amount, unit: v.unit, category: 'veg' })
  const bumbu_packet = bumbu || null
  if (bumbu_packet) shop_ingredients.push({ item: bumbu_packet, amount: 1, unit: 'pack', category: 'bumbu' })

  for (const s of shop_ingredients) {
    if (!CATEGORIES.includes(s.category)) throw new Error(`invalid category: ${s.category}`)
  }
  return { shop_ingredients, bumbu_packet }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function formatLine(s) {
  return `${s.item} ${s.amount}${s.unit === 'g' || s.unit === 'kg' || s.unit === 'ml' ? '' : ' '}${s.unit} [${s.category}]`
}

// ---- main -------------------------------------------------------------------
const { data: dishes, error } = await supabase
  .from('dishes')
  .select('id, name, slot, protein, qty_amount, qty_unit, method, spicy, shop_ingredients')
  .in('slot', FOCUS_SLOTS)
  .order('slot')
  .order('name')
if (error) { console.error('Failed to read dishes:', error.message); process.exit(1) }

const candidates = (force ? dishes : dishes.filter((d) => d.shop_ingredients == null)).slice(0, limit)

console.log(`Drafting shop ingredients for ${candidates.length} dish(es) (of ${dishes.length} in scope, model ${MODEL})${force ? ' [--force]' : ''}\n`)

const results = [] // { dish, shop_ingredients, bumbu_packet } | { dish, error }
for (const [i, dish] of candidates.entries()) {
  process.stdout.write(`[${i + 1}/${candidates.length}] ${dish.name} (${dish.slot})... `)
  try {
    const parsed = await draftForDish(dish)
    const { shop_ingredients, bumbu_packet } = toShopIngredients(parsed)

    const { error: upErr } = await supabase
      .from('dishes')
      .update({ shop_ingredients, bumbu_packet, shop_ingredients_status: 'draft' })
      .eq('id', dish.id)
    if (upErr) throw new Error(`write failed: ${upErr.message}`)

    console.log('✓')
    if (shop_ingredients.length === 0) console.log('    (nothing to buy fresh)')
    else for (const s of shop_ingredients) console.log(`    ${formatLine(s)}`)
    results.push({ dish, shop_ingredients, bumbu_packet })
  } catch (err) {
    console.log('✗')
    console.log(`    ${err.message}`)
    results.push({ dish, error: err.message })
  }
  if (i < candidates.length - 1) await sleep(DELAY_MS)
}

// ---- review table + summary -------------------------------------------------
console.log('\n--- Review ---')
console.log(
  ['Dish', 'Slot', 'Protein', 'Veg', 'Bumbu'].join(' | '),
)
for (const r of results) {
  if (r.error) { console.log(`${r.dish.name} | ${r.dish.slot} | ERROR: ${r.error}`); continue }
  const protein = r.shop_ingredients.find((s) => s.category === 'protein')
  const veg = r.shop_ingredients.filter((s) => s.category === 'veg')
  console.log([
    r.dish.name,
    r.dish.slot,
    protein ? formatLine(protein).replace(' [protein]', '') : '—',
    veg.length ? veg.map((v) => formatLine(v).replace(' [veg]', '')).join(', ') : '—',
    r.bumbu_packet ?? '—',
  ].join(' | '))
}

const ok = results.filter((r) => !r.error)
const failed = results.filter((r) => r.error)
console.log(`\nDone. Drafted ${ok.length}, failed ${failed.length}, skipped ${dishes.length - candidates.length} (already had shop_ingredients — use --force to redo).`)
if (failed.length) console.log(`Failed: ${failed.map((r) => r.dish.name).join(', ')}`)
console.log(`\nAll writes are marked shop_ingredients_status = 'draft' — review and confirm in the app before trusting the weekly shopping list.`)
