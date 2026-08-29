// Extract the SHOPPING-RELEVANT ingredients for a dish straight from its linked
// YouTube recipe video, using Gemini's native video understanding (the video URL
// is passed directly to the API as file_data/fileUri — never downloaded, no
// browser). This is a DRAFT pass for human review, not final data: every write
// is tagged shop_ingredients_status = 'draft' so the app can show "AI draft —
// verify". The script never sets 'verified' — that happens only when you
// confirm it in the app.
//
// Which dishes: only dishes with a YouTube link in recipe_links AND that don't
// already have shop_ingredients_status = 'verified'. This deliberately RE-DRAFTS
// dishes that already have shop_ingredients from elsewhere (e.g. the metadata-only
// guess in draft-shopping-ingredients.mjs) — watching the actual video is more
// accurate than a name/slot/protein guess, so it overwrites. The only way to keep
// a dish out of future runs is to mark it 'verified' in the app.
//
// Writes:
//   dishes.shop_ingredients      jsonb  [{ item, amount, unit, category }], category in
//                                       ('protein','veg','bumbu')
//   dishes.bumbu_packet          text   packet name, or null
//   dishes.shop_ingredients_status  text  'draft'
//
// Env (.env.local, auto-loaded — no --env-file needed):
//   GEMINI_API_KEY               free tier at https://aistudio.google.com/apikey
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    (service role, not anon — this writes drafts server-side)
//
// Usage:
//   node scripts/extract-ingredients-from-youtube.mjs --limit 20
//   node scripts/extract-ingredients-from-youtube.mjs --limit 20 --delay 10000
//
// Free tier is rate-limited (~10-15 RPM, 250k tokens/min) — dishes are processed
// SEQUENTIALLY with a delay between calls (default 8s, --delay in ms). A 429
// waits 60s and retries once before giving up on that dish.
//
// NOT idempotent by content: re-running re-drafts any non-verified dish again
// (it will re-call Gemini and overwrite the previous draft each time). Use
// --limit to batch through your backlog a few at a time; mark a dish 'verified'
// in the app once you've checked it so future runs skip it for good.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const MODEL = 'gemini-2.5-flash' // swap here if the free-tier model changes

// ---- .env.local (manual, dependency-free — mirrors dotenv's "don't clobber
// an already-set env var" behavior) -------------------------------------------
function loadEnvLocal() {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  if (!existsSync(envPath)) return
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}
loadEnvLocal()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const geminiKey = process.env.GEMINI_API_KEY
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!geminiKey) {
  console.error('Missing GEMINI_API_KEY — get a free-tier key at https://aistudio.google.com/apikey and add it to .env.local')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, serviceRoleKey)

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2)
function intArg(flag, fallback) {
  const i = args.indexOf(flag)
  if (i === -1) return fallback
  const n = Number(args[i + 1])
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${flag} must be a positive number`)
    process.exit(1)
  }
  return n
}
const limit = intArg('--limit', Infinity)
const DELAY_MS = intArg('--delay', 8000)

const CATEGORIES = ['protein', 'veg', 'bumbu']

// ---- prompt -------------------------------------------------------------------
const SYSTEM_PROMPT = `You watch one Indonesian family recipe video and extract ONLY the
SHOPPING-RELEVANT ingredients someone would need to buy fresh, scaled for 2 adults + 1 child.

Output ONLY strict JSON, no prose, no markdown fences:
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
- "bumbu": if the video uses a store-bought Indonesian instant spice packet
  (rendang, gulai, kare/curry, opor, soto, ayam kalasan, bakar, rica, sate, tomyam,
  etc.), give the packet name exactly as shown/sold, e.g. "Bumbu Rendang". If the
  recipe is made from scratch, set this to null.

EXCLUDE always (assume already on hand): cooking oil, salt, sugar, kecap/soy sauce,
shallots, garlic, ginger (unless ginger itself IS the dish), flour, water, pepper, MSG.

If the video is unavailable, private, or you cannot make out the ingredients, still
return the JSON shape above with protein: null, veg: [], bumbu: null — do not return
prose explaining why.`

function dishPrompt(dish) {
  return `Dish name: ${dish.name}\nExtract the shopping-relevant ingredients from this recipe video.`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- AI call -------------------------------------------------------------------
async function callGemini(dish, videoUrl, attempt = 1) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [
            { fileData: { fileUri: videoUrl } },
            { text: dishPrompt(dish) },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    },
  )
  if (res.status === 429) {
    if (attempt >= 2) throw new Error('rate-limited (429) after one retry')
    console.log('    (429 rate-limited — waiting 60s, retrying once)')
    await sleep(60_000)
    return callGemini(dish, videoUrl, attempt + 1)
  }
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = await res.json()
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error(`no text in Gemini response: ${JSON.stringify(body).slice(0, 300)}`)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`invalid JSON from Gemini: ${text.slice(0, 300)}`)
  }
  return parsed
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

function formatLine(s) {
  return `${s.item} ${s.amount}${s.unit} [${s.category}]`
}

function youtubeLink(dish) {
  return (dish.recipe_links ?? []).find((l) => l?.source === 'youtube') ?? null
}

// Real pasted links (esp. from the mobile share sheet) often carry a `pp=` tracking
// param or other cruft. Gemini's fileUri matcher is strict about this — an unrecognized
// URL shape makes it fall back to fetching the page as plain HTML (400: Unsupported MIME
// type: text/html), instead of ingesting it as a video. Canonicalize to bare
// https://www.youtube.com/watch?v=<id> (or youtu.be/<id> -> the same form) before sending.
function canonicalYoutubeUrl(rawUrl) {
  const u = new URL(rawUrl)
  let id = u.searchParams.get('v')
  if (!id && u.hostname.includes('youtu.be')) id = u.pathname.slice(1)
  if (!id) return rawUrl // unrecognized shape — pass through, let Gemini's error surface as-is
  return `https://www.youtube.com/watch?v=${id}`
}

// ---- main -------------------------------------------------------------------
const { data: dishes, error } = await supabase
  .from('dishes')
  .select('id, name, recipe_links, shop_ingredients, shop_ingredients_status')
  .not('recipe_links', 'is', null)
  .or('shop_ingredients_status.is.null,shop_ingredients_status.neq.verified')
  .order('name')
if (error) { console.error('Failed to read dishes:', error.message); process.exit(1) }

const withYoutube = dishes.filter((d) => youtubeLink(d) !== null)
const candidates = withYoutube.slice(0, limit)

console.log(`Extracting shopping ingredients from YouTube for ${candidates.length} dish(es) (of ${withYoutube.length} eligible, model ${MODEL})\n`)

let drafted = 0
const skipped = [] // { dish, reason }
for (const [i, dish] of candidates.entries()) {
  const link = youtubeLink(dish)
  const videoUrl = canonicalYoutubeUrl(link.url)
  console.log(`[${i + 1}/${candidates.length}] ${dish.name} — ${videoUrl}`)
  try {
    const parsed = await callGemini(dish, videoUrl)
    const { shop_ingredients, bumbu_packet } = toShopIngredients(parsed)

    const { error: upErr } = await supabase
      .from('dishes')
      .update({ shop_ingredients, bumbu_packet, shop_ingredients_status: 'draft' })
      .eq('id', dish.id)
    if (upErr) throw new Error(`write failed: ${upErr.message}`)

    console.log(`  ✓ ${JSON.stringify({ shop_ingredients, bumbu_packet })}`)
    drafted++
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.log(`  ✗ skipped — ${reason}`)
    skipped.push({ dish, reason })
  }
  if (i < candidates.length - 1) await sleep(DELAY_MS)
}

console.log(`\nDone. Processed ${candidates.length}, drafted ${drafted}, skipped ${skipped.length}.`)
if (skipped.length) {
  console.log('Skipped:')
  for (const s of skipped) console.log(`  - ${s.dish.name}: ${s.reason}`)
}
console.log(`\nAll writes are marked shop_ingredients_status = 'draft' — review and confirm in the app before trusting the weekly shopping list.`)
