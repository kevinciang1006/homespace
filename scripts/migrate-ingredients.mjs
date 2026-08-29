// One-time migration: dishes.shop_ingredients (jsonb, [{item, amount, unit,
// category}]) -> the normalized `ingredients` + `dish_ingredients` tables, so
// the weekly shopping list can aggregate by canonical ingredient instead of
// by raw free-text string.
//
// Source: ONLY dishes.shop_ingredients (not the older dishes.ingredients
// jsonb column, which is a full recipe list including always-on-hand staples
// and isn't shopping-focused). Dishes with no shop_ingredients are skipped
// and listed in the report — run scripts/extract-ingredients-from-youtube.mjs
// on them first, or add ingredients by hand later via the /meals/ingredients
// page once it exists.
//
// Canonicalization: RAW_TO_CANONICAL below is a hand-built table mapping
// every raw `item` string seen in production shop_ingredients (as of
// 2026-08-29) to one canonical ingredient name, deduplicating synonyms and
// Indonesian/English variants (e.g. "wortel"/"carrot"/"carrots" -> "Wortel").
// CANONICAL_META carries each canonical's category/default_unit/shelf_stable.
// Any raw item NOT found in the table (a dish added after this table was
// built) falls back to Title-Casing the raw string as its own new canonical
// ingredient — the report flags these as "auto-created (unmapped)" so you
// can review and merge them via the Ingredients page if they're really a
// duplicate of something else.
//
// Idempotent: matches against ingredients already in the DB (by name or
// alias) before creating a new one, and replaces (not duplicates)
// dish_ingredients rows for any dish it processes. Safe to re-run.
//
// Does NOT touch dishes.shop_ingredients — kept as a backup.
//
// Env (.env.local, auto-loaded):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Usage:
//   node scripts/migrate-ingredients.mjs --dry-run   # print report, write nothing
//   node scripts/migrate-ingredients.mjs             # write for real
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

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
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, serviceRoleKey)

const DRY_RUN = process.argv.includes('--dry-run')

// ---- canonicalization table -------------------------------------------------
// key: raw `item` string, lowercased+trimmed. value: canonical ingredient name.
const RAW_TO_CANONICAL = {
  'chicken': 'Ayam', 'ayam': 'Ayam', 'chicken fillet': 'Ayam', 'ayam fillet': 'Ayam',
  'chicken legs': 'Ayam', 'chicken thigh': 'Ayam',
  "red bird's eye chilies": 'Cabai Rawit', "green bird's eye chilies": 'Cabai Rawit',
  "red bird's eye chili": 'Cabai Rawit', 'tomatoes': 'Tomat', 'tomat': 'Tomat', 'tomat merah': 'Tomat',
  'cabe hijau': 'Cabai Hijau', 'cabai hijau': 'Cabai Hijau',
  'tomat hijau': 'Tomat Hijau',
  'bumbu kalasan': 'Bumbu Kalasan',
  'onion': 'Bawang Bombay', 'bawang bombay': 'Bawang Bombay', 'bawang bombai': 'Bawang Bombay',
  'white onion': 'Bawang Bombay',
  'red bell pepper': 'Paprika Merah', 'green bell pepper': 'Paprika Hijau',
  'large green onion': 'Daun Bawang', 'small green onions': 'Daun Bawang', 'daun bawang': 'Daun Bawang',
  'daun bawang (scallion)': 'Daun Bawang', 'green onion whites': 'Daun Bawang',
  'ginger': 'Jahe', 'young ginger': 'Jahe', 'jahe': 'Jahe',
  'pork': 'Daging Babi', 'pork belly': 'Daging Babi', 'babi': 'Daging Babi',
  'pork (daging babi)': 'Daging Babi', 'samcan (pork belly)': 'Daging Babi',
  'papaya': 'Pepaya', 'choy sum': 'Choy Sum',
  'dried shiitake mushrooms': 'Jamur Shiitake Kering', 'bok choy': 'Pak Coi', 'shanghai bok choy': 'Pak Coi',
  'iga babi': 'Iga Babi', 'pork ribs': 'Iga Babi',
  'bumbu bak kut teh': 'Bumbu Bak Kut Teh',
  'bakso': 'Bakso', 'bakso ikan': 'Bakso Ikan', 'sawi putih': 'Sawi Putih',
  'kol (kubis)': 'Kol', 'kol': 'Kol', 'kubis': 'Kol',
  'wortel': 'Wortel', 'carrot': 'Wortel', 'carrots': 'Wortel',
  'tepung terigu': 'Tepung Terigu',
  'bayam': 'Bayam', 'spinach': 'Bayam',
  'brokoli': 'Brokoli',
  'telur': 'Telur', 'eggs': 'Telur', 'telur poach': 'Telur',
  'ebi': 'Ebi', 'buncis': 'Buncis',
  'cabe merah besar': 'Cabai Merah Besar', 'cabe merah': 'Cabai Merah Besar', 'cabai merah': 'Cabai Merah Besar',
  'cabe rawit merah': 'Cabai Rawit', 'cabe rawit': 'Cabai Rawit', 'cabai rawit': 'Cabai Rawit',
  "cabai rawit hijau": 'Cabai Rawit', 'cabai rawit merah': 'Cabai Rawit', 'cabe rawit/merah campur': 'Cabai Rawit',
  'ginjal babi': 'Ginjal Babi', 'pork liver': 'Hati Babi',
  'garlic': 'Bawang Putih', 'bawang putih': 'Bawang Putih',
  'snow peas': 'Kapri', 'baby corn': 'Jagung Muda', 'wood ear mushrooms (dried)': 'Jamur Kuping Kering',
  'sawi hijau': 'Sawi Hijau', 'sawi': 'Sawi Hijau',
  'cabai merah keriting': 'Cabai Merah Keriting', 'cabe merah keriting': 'Cabai Merah Keriting',
  'red chili (curly)': 'Cabai Merah Keriting', 'cabe keriting': 'Cabai Merah Keriting',
  'cumi-cumi': 'Cumi-Cumi', 'cumi': 'Cumi-Cumi',
  'jeruk nipis': 'Jeruk Nipis', 'lime': 'Jeruk Nipis',
  'daun kari': 'Daun Kari', 'sajiku tepung bumbu': 'Sajiku Tepung Bumbu',
  'telur asin (salted egg yolk)': 'Telur Asin',
  'santan': 'Santan', 'bumbu curry thailand': 'Bumbu Curry Thailand',
  'tahu tempe': 'Tahu Tempe', 'bumbu gulai': 'Bumbu Gulai',
  'ikan': 'Ikan', 'pronas saus barbeque': 'Pronas Saus Barbeque', 'bumbu bakar': 'Bumbu Bakar',
  'paprika': 'Paprika', 'nanas': 'Nanas',
  'ikan gurame': 'Ikan Gurame', 'gurame fish': 'Ikan Gurame',
  'indofood racik bumbu ikan goreng': 'Indofood Racik Bumbu Ikan Goreng', 'mangga muda': 'Mangga Muda',
  'jamur enoki': 'Jamur Enoki', 'jamur tiram': 'Jamur Tiram',
  'kacang hijau': 'Kacang Hijau',
  'daging sapi giling': 'Daging Sapi Giling', 'kacang merah': 'Kacang Merah', 'seledri': 'Seledri',
  'daun seledri': 'Seledri',
  'daging sapi sengkel': 'Daging Sapi Sengkel', 'jeruk limau': 'Jeruk Limau',
  'cengkih': 'Cengkih', 'pala': 'Pala',
  'kangkung': 'Kangkung', 'kepah (kerang)': 'Kepah',
  'bumbu kare': 'Bumbu Kare', 'kentang': 'Kentang',
  'daun bawang pre': 'Daun Bawang Prei', 'masako daging ayam': 'Masako Daging Ayam',
  'kepiting': 'Kepiting', 'chicken bones': 'Tulang Ayam', 'white radish': 'Lobak',
  'bamboe sop': 'Bamboe SOP', 'dried chilies': 'Cabai Kering',
  'rumput laut kering': 'Rumput Laut Kering', 'daging kepiting (crab meat)': 'Daging Kepiting',
  'sirip ikan imitasi (imitation shark fin)': 'Sirip Ikan Imitasi',
  'tofu': 'Tahu', 'tahu kuning': 'Tahu Kuning',
  'pare': 'Pare', 'tempe': 'Tempe', 'terong ungu': 'Terong Ungu',
  'tauge': 'Tauge', 'kucai': 'Kucai', 'lengkuas': 'Lengkuas', 'daun salam': 'Daun Salam',
  'bakso paket tomyam': 'Bakso Paket Tomyam', 'kepala ikan': 'Kepala Ikan', 'jamur': 'Jamur',
  'bumbu tomyam': 'Bumbu Tomyam', 'bumbu rendang': 'Bumbu Rendang',
  'udang': 'Udang', 'shrimp': 'Udang',
  'jagung manis': 'Jagung Manis', 'ayam kampung': 'Ayam Kampung',
  'bumbu sop obat ayam': 'Bumbu Sop Obat Ayam',
  'paket steamboat (isi campuran)': 'Paket Steamboat',
}

// Canonical -> { category, unit, shelfStable }. category must be one of
// ingredients.category's expected values: protein | veg | bumbu | pantry | other.
const CANONICAL_META = {
  'Ayam': { category: 'protein', unit: 'g', shelfStable: false },
  'Cabai Rawit': { category: 'veg', unit: 'g', shelfStable: false },
  'Tomat': { category: 'veg', unit: 'pcs', shelfStable: false },
  'Cabai Hijau': { category: 'veg', unit: 'g', shelfStable: false },
  'Tomat Hijau': { category: 'veg', unit: 'g', shelfStable: false },
  'Bumbu Kalasan': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Bawang Bombay': { category: 'veg', unit: 'pc', shelfStable: false },
  'Paprika Merah': { category: 'veg', unit: 'pc', shelfStable: false },
  'Paprika Hijau': { category: 'veg', unit: 'pc', shelfStable: false },
  'Daun Bawang': { category: 'veg', unit: 'g', shelfStable: false },
  'Jahe': { category: 'veg', unit: 'g', shelfStable: false },
  'Daging Babi': { category: 'protein', unit: 'g', shelfStable: false },
  'Pepaya': { category: 'veg', unit: 'pc', shelfStable: false },
  'Choy Sum': { category: 'veg', unit: 'g', shelfStable: false },
  'Jamur Shiitake Kering': { category: 'veg', unit: 'pcs', shelfStable: true },
  'Pak Coi': { category: 'veg', unit: 'g', shelfStable: false },
  'Iga Babi': { category: 'protein', unit: 'g', shelfStable: false },
  'Bumbu Bak Kut Teh': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Bakso': { category: 'protein', unit: 'g', shelfStable: false },
  'Bakso Ikan': { category: 'protein', unit: 'pcs', shelfStable: false },
  'Sawi Putih': { category: 'veg', unit: 'g', shelfStable: false },
  'Kol': { category: 'veg', unit: 'g', shelfStable: false },
  'Wortel': { category: 'veg', unit: 'pcs', shelfStable: false },
  'Tepung Terigu': { category: 'pantry', unit: 'g', shelfStable: true },
  'Bayam': { category: 'veg', unit: 'g', shelfStable: false },
  'Brokoli': { category: 'veg', unit: 'g', shelfStable: false },
  'Telur': { category: 'protein', unit: 'pcs', shelfStable: false },
  'Ebi': { category: 'protein', unit: 'g', shelfStable: true },
  'Buncis': { category: 'veg', unit: 'g', shelfStable: false },
  'Cabai Merah Besar': { category: 'veg', unit: 'g', shelfStable: false },
  'Ginjal Babi': { category: 'protein', unit: 'g', shelfStable: false },
  'Hati Babi': { category: 'protein', unit: 'g', shelfStable: false },
  'Bawang Putih': { category: 'veg', unit: 'g', shelfStable: false },
  'Kapri': { category: 'veg', unit: 'g', shelfStable: false },
  'Jagung Muda': { category: 'veg', unit: 'g', shelfStable: false },
  'Jamur Kuping Kering': { category: 'veg', unit: 'g', shelfStable: true },
  'Sawi Hijau': { category: 'veg', unit: 'g', shelfStable: false },
  'Cabai Merah Keriting': { category: 'veg', unit: 'pcs', shelfStable: false },
  'Cumi-Cumi': { category: 'protein', unit: 'g', shelfStable: false },
  'Jeruk Nipis': { category: 'veg', unit: 'pcs', shelfStable: false },
  'Daun Kari': { category: 'veg', unit: 'lembar', shelfStable: false },
  'Sajiku Tepung Bumbu': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Telur Asin': { category: 'other', unit: 'pcs', shelfStable: false },
  'Santan': { category: 'other', unit: 'ml', shelfStable: true },
  'Bumbu Curry Thailand': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Tahu Tempe': { category: 'other', unit: 'g', shelfStable: false },
  'Bumbu Gulai': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Ikan': { category: 'protein', unit: 'ekor', shelfStable: false },
  'Pronas Saus Barbeque': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Bumbu Bakar': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Paprika': { category: 'veg', unit: 'pcs', shelfStable: false },
  'Nanas': { category: 'veg', unit: 'g', shelfStable: false },
  'Ikan Gurame': { category: 'protein', unit: 'ekor', shelfStable: false },
  'Indofood Racik Bumbu Ikan Goreng': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Mangga Muda': { category: 'veg', unit: 'bh besar', shelfStable: false },
  'Jamur Enoki': { category: 'veg', unit: 'g', shelfStable: false },
  'Jamur Tiram': { category: 'protein', unit: 'g', shelfStable: false },
  'Kacang Hijau': { category: 'veg', unit: 'g', shelfStable: true },
  'Daging Sapi Giling': { category: 'protein', unit: 'g', shelfStable: false },
  'Kacang Merah': { category: 'veg', unit: 'g', shelfStable: true },
  'Seledri': { category: 'veg', unit: 'g', shelfStable: false },
  'Daging Sapi Sengkel': { category: 'protein', unit: 'g', shelfStable: false },
  'Jeruk Limau': { category: 'veg', unit: 'pc', shelfStable: false },
  'Cengkih': { category: 'veg', unit: 'pcs', shelfStable: true },
  'Pala': { category: 'veg', unit: 'pc', shelfStable: true },
  'Kangkung': { category: 'veg', unit: 'g', shelfStable: false },
  'Kepah': { category: 'protein', unit: 'g', shelfStable: false },
  'Bumbu Kare': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Kentang': { category: 'veg', unit: 'g', shelfStable: false },
  'Daun Bawang Prei': { category: 'veg', unit: 'g', shelfStable: false },
  'Masako Daging Ayam': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Kepiting': { category: 'protein', unit: 'ekor', shelfStable: false },
  'Tulang Ayam': { category: 'protein', unit: 'g', shelfStable: false },
  'Lobak': { category: 'veg', unit: 'g', shelfStable: false },
  'Bamboe SOP': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Cabai Kering': { category: 'veg', unit: 'pcs', shelfStable: true },
  'Rumput Laut Kering': { category: 'veg', unit: 'gram', shelfStable: true },
  'Daging Kepiting': { category: 'protein', unit: 'g', shelfStable: false },
  'Sirip Ikan Imitasi': { category: 'other', unit: 'g', shelfStable: true },
  'Tahu': { category: 'protein', unit: 'g', shelfStable: false },
  'Tahu Kuning': { category: 'protein', unit: 'pcs', shelfStable: false },
  'Pare': { category: 'veg', unit: 'g', shelfStable: false },
  'Tempe': { category: 'protein', unit: 'papan', shelfStable: false },
  'Terong Ungu': { category: 'veg', unit: 'g', shelfStable: false },
  'Tauge': { category: 'veg', unit: 'g', shelfStable: false },
  'Kucai': { category: 'veg', unit: 'g', shelfStable: false },
  'Lengkuas': { category: 'veg', unit: 'cm', shelfStable: false },
  'Daun Salam': { category: 'veg', unit: 'lembar', shelfStable: true },
  'Bakso Paket Tomyam': { category: 'other', unit: 'pack', shelfStable: false },
  'Kepala Ikan': { category: 'protein', unit: 'ekor', shelfStable: false },
  'Jamur': { category: 'veg', unit: 'g', shelfStable: false },
  'Bumbu Tomyam': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Bumbu Rendang': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Udang': { category: 'protein', unit: 'g', shelfStable: false },
  'Jagung Manis': { category: 'veg', unit: 'buah', shelfStable: false },
  'Ayam Kampung': { category: 'protein', unit: 'g', shelfStable: false },
  'Bumbu Sop Obat Ayam': { category: 'bumbu', unit: 'pack', shelfStable: true },
  'Paket Steamboat': { category: 'other', unit: 'pack', shelfStable: false },
}

function normalize(raw) {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

function titleCase(raw) {
  const base = raw.trim().replace(/\s+/g, ' ').replace(/\s*\([^)]*\)\s*$/, '')
  return base.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

const STAPLE_RE = /\b(tepung|minyak|garam|gula|kecap)\b/i

// Resolve a raw item string -> { canonicalName, category, unit, shelfStable }.
// Falls back to Title-Casing an unmapped item as its own new canonical.
function resolveCanonical(rawItem, sourceCategory) {
  const key = normalize(rawItem)
  const mapped = RAW_TO_CANONICAL[key]
  if (mapped) {
    const meta = CANONICAL_META[mapped]
    if (!meta) throw new Error(`RAW_TO_CANONICAL points "${rawItem}" -> "${mapped}" but CANONICAL_META has no entry for it`)
    return { canonicalName: mapped, ...meta, mappedFrom: rawItem }
  }
  const name = titleCase(rawItem)
  const isStaple = STAPLE_RE.test(rawItem)
  return {
    canonicalName: name,
    category: isStaple ? 'pantry' : (sourceCategory || 'other'),
    unit: null,
    shelfStable: isStaple,
    mappedFrom: rawItem,
    unmapped: true,
  }
}

async function main() {
  const { data: dishes, error } = await supabase
    .from('dishes')
    .select('id, name, shop_ingredients')
    .order('name')
  if (error) { console.error('Failed to fetch dishes:', error.message); process.exit(1) }

  const withIngredients = dishes.filter(d => Array.isArray(d.shop_ingredients) && d.shop_ingredients.length > 0)
  const skipped = dishes.filter(d => !Array.isArray(d.shop_ingredients) || d.shop_ingredients.length === 0)

  // canonicalName -> { category, unit, shelfStable, aliasesSeen: Set<string>, unmapped }
  const canonicalRegistry = new Map()
  // dishId -> [{ canonicalName, amount, unit }]
  const dishLinks = new Map()

  for (const dish of withIngredients) {
    const links = []
    for (const item of dish.shop_ingredients) {
      if (!item?.item) continue
      const resolved = resolveCanonical(item.item, item.category)
      if (!canonicalRegistry.has(resolved.canonicalName)) {
        canonicalRegistry.set(resolved.canonicalName, {
          category: resolved.category,
          unit: resolved.unit ?? item.unit ?? null,
          shelfStable: resolved.shelfStable,
          aliasesSeen: new Set(),
          unmapped: !!resolved.unmapped,
        })
      }
      const entry = canonicalRegistry.get(resolved.canonicalName)
      const rawTrimmed = item.item.trim()
      if (rawTrimmed.toLowerCase() !== resolved.canonicalName.toLowerCase()) {
        entry.aliasesSeen.add(rawTrimmed)
      }
      links.push({ canonicalName: resolved.canonicalName, amount: item.amount ?? null, unit: item.unit ?? entry.unit ?? null })
    }
    dishLinks.set(dish.id, links)
  }

  // ---- fetch existing ingredients to stay idempotent -----------------------
  const { data: existingIngredients, error: existingErr } = await supabase
    .from('ingredients').select('id, name, aliases')
  if (existingErr) { console.error('Failed to fetch existing ingredients:', existingErr.message); process.exit(1) }

  const byNameLower = new Map(existingIngredients.map(i => [i.name.toLowerCase(), i]))
  const byAliasLower = new Map()
  for (const ing of existingIngredients) {
    for (const alias of ing.aliases ?? []) byAliasLower.set(alias.toLowerCase(), ing)
  }

  const created = []
  const reused = []
  const canonicalNameToId = new Map()

  for (const [name, meta] of canonicalRegistry) {
    const existing = byNameLower.get(name.toLowerCase()) ?? byAliasLower.get(name.toLowerCase())
    if (existing) {
      canonicalNameToId.set(name, existing.id)
      reused.push({ name, id: existing.id })
      // Merge in any newly-seen aliases that aren't already recorded.
      const mergedAliases = Array.from(new Set([...(existing.aliases ?? []), ...meta.aliasesSeen]))
      if (!DRY_RUN && mergedAliases.length !== (existing.aliases ?? []).length) {
        const { error: updErr } = await supabase.from('ingredients').update({ aliases: mergedAliases }).eq('id', existing.id)
        if (updErr) console.error(`Failed to update aliases for "${name}":`, updErr.message)
      }
      continue
    }
    const row = {
      name,
      aliases: Array.from(meta.aliasesSeen),
      category: meta.category,
      default_unit: meta.unit,
      shelf_stable: meta.shelfStable,
    }
    if (DRY_RUN) {
      canonicalNameToId.set(name, `dry-run-${name}`)
    } else {
      const { data: inserted, error: insErr } = await supabase.from('ingredients').insert(row).select('id').single()
      if (insErr) { console.error(`Failed to create ingredient "${name}":`, insErr.message); process.exit(1) }
      canonicalNameToId.set(name, inserted.id)
    }
    created.push({ ...row, unmapped: meta.unmapped })
  }

  // ---- link dish_ingredients -------------------------------------------------
  let dishesLinked = 0
  let rowsWritten = 0
  for (const [dishId, links] of dishLinks) {
    if (links.length === 0) continue
    dishesLinked++
    rowsWritten += links.length
    if (DRY_RUN) continue
    const { error: delErr } = await supabase.from('dish_ingredients').delete().eq('dish_id', dishId)
    if (delErr) { console.error(`Failed to clear existing dish_ingredients for dish ${dishId}:`, delErr.message); process.exit(1) }
    const rows = links.map(l => ({
      dish_id: dishId,
      ingredient_id: canonicalNameToId.get(l.canonicalName),
      amount: l.amount,
      unit: l.unit,
    }))
    const { error: insErr } = await supabase.from('dish_ingredients').insert(rows)
    if (insErr) { console.error(`Failed to insert dish_ingredients for dish ${dishId}:`, insErr.message); process.exit(1) }
  }

  // ---- report -----------------------------------------------------------------
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Ingredient migration report`)
  console.log('='.repeat(60))
  console.log(`Dishes with shop_ingredients: ${withIngredients.length}`)
  console.log(`Dishes skipped (no shop_ingredients): ${skipped.length}`)
  console.log(`Canonical ingredients created: ${created.length}`)
  console.log(`Canonical ingredients reused (already existed): ${reused.length}`)
  console.log(`dish_ingredients rows written: ${rowsWritten} (across ${dishesLinked} dishes)`)

  const merged = created.filter(c => c.aliases.length > 0)
  console.log(`\n--- Merges made (canonical <- raw variants seen) ---`)
  if (merged.length === 0) console.log('(none)')
  for (const c of merged) console.log(`  ${c.name}  <-  ${c.aliases.join(', ')}`)

  const unmapped = created.filter(c => c.unmapped)
  if (unmapped.length > 0) {
    console.log(`\n--- Auto-created (not in the hand-built canonical table — review these) ---`)
    for (const c of unmapped) console.log(`  ${c.name}  [${c.category}]`)
  }

  console.log(`\n--- Full canonical ingredient list (${created.length + reused.length}) ---`)
  const all = [...created.map(c => c.name), ...reused.map(r => r.name)].sort()
  for (const name of all) console.log(`  ${name}`)

  if (skipped.length > 0) {
    console.log(`\n--- Dishes with NO shop_ingredients (not migrated) ---`)
    for (const d of skipped) console.log(`  ${d.name}`)
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete — nothing was written. Re-run without --dry-run to apply.' : 'Migration complete.'}`)
}

main()
