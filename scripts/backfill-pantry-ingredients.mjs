// One-time backfill: the Part-1 ingredients migration deliberately sourced
// only from dishes.shop_ingredients, which itself deliberately EXCLUDES
// always-on-hand staples (salt, oil, soy sauce...) — so the ingredients
// table was never a *complete* ingredient list, just a shopping list. This
// script mines the older dishes.ingredients jsonb (the full recipe list,
// which DOES include staples) for common pantry/bumbu items, creates them
// as shelf_stable=true canonical ingredients, and links them to every dish
// that uses them — so opening a dish shows its complete ingredient list,
// while the shopping list (which filters shelf_stable=true) stays unaffected.
//
// Scope: the ~15 staples below cover every pantry item that recurs across
// 2+ dishes in dishes.ingredients as of 2026-08-29 (hand-audited, not a
// generic keyword scanner — see PANTRY_INGREDIENTS/LINKS). One-off exotic
// items (five spice powder, star anise, tamarind, terasi, curry pastes...)
// are intentionally left out; add them via /meals/ingredients if you want
// them tracked too.
//
// Idempotent: skips any (dish, ingredient) pair that already has a
// dish_ingredients row (relevant for Santan/Tepung Terigu, which the Part-1
// migration already linked to some of these dishes from shop_ingredients).
//
// Env (.env.local, auto-loaded):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Usage:
//   node scripts/backfill-pantry-ingredients.mjs --dry-run
//   node scripts/backfill-pantry-ingredients.mjs
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

// ---- new pantry canonical ingredients --------------------------------------
const PANTRY_INGREDIENTS = [
  { name: 'Garam', unit: null },
  { name: 'Merica', unit: null },
  { name: 'Saus Tiram', unit: 'tbsp' },
  { name: 'Kecap Manis', unit: 'tbsp' },
  { name: 'Kecap Asin', unit: 'tbsp' },
  { name: 'Minyak Goreng', unit: null },
  { name: 'Gula', unit: null },
  { name: 'Gula Merah', unit: 'tbsp' },
  { name: 'Tepung Maizena', unit: 'g' },
  { name: 'Bawang Putih Bubuk', unit: 'tsp' },
  { name: 'Kaldu Ayam Bubuk', unit: 'L' },
  { name: 'Minyak Wijen', unit: 'tsp' },
  { name: 'Saus Tomat', unit: 'tbsp' },
  { name: 'Cuka', unit: 'tbsp' },
  { name: 'Tauco', unit: 'tbsp' },
]

// Ingredients that already exist from the Part-1 migration — reused here by
// name, not recreated.
const EXISTING_REUSED = ['Tepung Terigu', 'Santan']

// ---- dish -> pantry ingredient links (hand-audited from dishes.ingredients) -
// [dishId, canonicalName, amount, unit]. amount null + a descriptive unit
// ("to taste", "as needed", "a pinch") for non-numeric recipe quantities.
const LINKS = [
  ['31d032e6-9236-42cb-8ff1-0b9db5252cae', 'Kecap Manis', 3, 'tbsp'],
  ['31d032e6-9236-42cb-8ff1-0b9db5252cae', 'Garam', null, 'to taste'],
  ['31d032e6-9236-42cb-8ff1-0b9db5252cae', 'Gula', null, 'to taste'],
  ['ec3ff894-1907-42c6-a5ee-990226b9ac96', 'Garam', null, 'to taste'],
  ['ec3ff894-1907-42c6-a5ee-990226b9ac96', 'Minyak Goreng', null, 'as needed'],
  ['c06e9e8c-5448-44cb-ad34-615831ac9409', 'Gula Merah', 2, 'tbsp'],
  ['c06e9e8c-5448-44cb-ad34-615831ac9409', 'Garam', null, 'to taste'],
  ['c06e9e8c-5448-44cb-ad34-615831ac9409', 'Minyak Goreng', null, 'as needed'],
  ['fef7d191-4ce1-479e-b37b-5ef7eabaad3e', 'Tepung Terigu', 100, 'g'],
  ['fef7d191-4ce1-479e-b37b-5ef7eabaad3e', 'Garam', null, 'to taste'],
  ['fef7d191-4ce1-479e-b37b-5ef7eabaad3e', 'Merica', null, 'to taste'],
  ['fef7d191-4ce1-479e-b37b-5ef7eabaad3e', 'Minyak Goreng', null, 'as needed'],
  ['dc987a38-fd5c-45b0-9f3a-23e6b3f3e9f6', 'Merica', 2, 'tbsp'],
  ['dc987a38-fd5c-45b0-9f3a-23e6b3f3e9f6', 'Saus Tiram', 2, 'tbsp'],
  ['dc987a38-fd5c-45b0-9f3a-23e6b3f3e9f6', 'Kecap Manis', 1, 'tbsp'],
  ['09b7f40c-e9a1-4e18-a439-93ae63711d2c', 'Saus Tiram', 2, 'tbsp'],
  ['09b7f40c-e9a1-4e18-a439-93ae63711d2c', 'Minyak Wijen', 1, 'tsp'],
  ['5e78b5c7-1bad-4512-badb-e1a9082347d6', 'Kecap Manis', 4, 'tbsp'],
  ['5e78b5c7-1bad-4512-badb-e1a9082347d6', 'Garam', null, 'to taste'],
  ['5e78b5c7-1bad-4512-badb-e1a9082347d6', 'Merica', null, 'to taste'],
  ['50cfb20b-1ace-48f4-aaeb-9d5129d9ff43', 'Tepung Maizena', 100, 'g'],
  ['50cfb20b-1ace-48f4-aaeb-9d5129d9ff43', 'Bawang Putih Bubuk', 1, 'tsp'],
  ['50cfb20b-1ace-48f4-aaeb-9d5129d9ff43', 'Garam', null, 'to taste'],
  ['50cfb20b-1ace-48f4-aaeb-9d5129d9ff43', 'Merica', null, 'to taste'],
  ['50cfb20b-1ace-48f4-aaeb-9d5129d9ff43', 'Minyak Goreng', null, 'as needed'],
  ['3ff8fb21-cab9-4775-afbf-f53c24c5726c', 'Kecap Manis', 3, 'tbsp'],
  ['3ff8fb21-cab9-4775-afbf-f53c24c5726c', 'Garam', null, 'to taste'],
  ['3ff8fb21-cab9-4775-afbf-f53c24c5726c', 'Gula', null, 'to taste'],
  ['16ce7478-b05b-4750-bd81-434f5423f6b9', 'Kecap Manis', 4, 'tbsp'],
  ['7e7fda22-e2fa-4ad2-b900-5e507bf8ae80', 'Kecap Manis', 2, 'tbsp'],
  ['7e7fda22-e2fa-4ad2-b900-5e507bf8ae80', 'Garam', null, 'to taste'],
  ['7e7fda22-e2fa-4ad2-b900-5e507bf8ae80', 'Gula', null, 'to taste'],
  ['4a1e2bfc-396d-4315-9866-8707dd260674', 'Merica', 1, 'tbsp'],
  ['4a1e2bfc-396d-4315-9866-8707dd260674', 'Kecap Asin', 3, 'tbsp'],
  ['345200e8-eb8e-4467-8231-1c965129ee49', 'Kaldu Ayam Bubuk', 1.5, 'L'],
  ['345200e8-eb8e-4467-8231-1c965129ee49', 'Merica', 1, 'tsp'],
  ['345200e8-eb8e-4467-8231-1c965129ee49', 'Garam', null, 'to taste'],
  ['74dfe303-7551-4f6a-bf11-17fb0132287b', 'Tepung Terigu', 250, 'g'],
  ['74dfe303-7551-4f6a-bf11-17fb0132287b', 'Gula', 180, 'g'],
  ['57d92e9f-564a-4cf4-88cc-6347b787cf4a', 'Gula', null, 'to taste'],
  ['a0ad154f-918f-452a-897a-afa077adaaf4', 'Garam', 1, 'tbsp'],
  ['ad441e8a-9303-4ab0-baca-870b9a20c3a1', 'Gula', 180, 'g'],
  ['ad441e8a-9303-4ab0-baca-870b9a20c3a1', 'Tepung Terigu', 120, 'g'],
  ['d51b6d2f-08b4-4622-a11a-1be311d9a965', 'Saus Tiram', 2, 'tbsp'],
  ['d51b6d2f-08b4-4622-a11a-1be311d9a965', 'Tepung Maizena', 1, 'tbsp'],
  ['d51b6d2f-08b4-4622-a11a-1be311d9a965', 'Garam', null, 'to taste'],
  ['d51b6d2f-08b4-4622-a11a-1be311d9a965', 'Merica', null, 'to taste'],
  ['2474e417-7cac-4f26-bc50-3be29378c614', 'Saus Tiram', 2, 'tbsp'],
  ['2474e417-7cac-4f26-bc50-3be29378c614', 'Tepung Maizena', 1, 'tbsp'],
  ['2474e417-7cac-4f26-bc50-3be29378c614', 'Garam', null, 'to taste'],
  ['2474e417-7cac-4f26-bc50-3be29378c614', 'Merica', null, 'to taste'],
  ['217355cb-2357-47a6-8d9b-3b78d5c76c17', 'Saus Tiram', 1.5, 'tbsp'],
  ['217355cb-2357-47a6-8d9b-3b78d5c76c17', 'Garam', null, 'to taste'],
  ['784c2906-ffdc-460a-b891-30269aa4edd7', 'Saus Tiram', 1, 'tbsp'],
  ['784c2906-ffdc-460a-b891-30269aa4edd7', 'Garam', null, 'to taste'],
  ['d90811f6-ec4d-44a0-a39f-4a6f860dc07b', 'Minyak Wijen', 1, 'tsp'],
  ['a88becdd-c2cd-4e2e-af02-20a18df4ea11', 'Saus Tiram', 1, 'tbsp'],
  ['22c28b3b-ee9a-4d4a-9118-8256f1649bc7', 'Saus Tiram', 1, 'tbsp'],
  ['22c28b3b-ee9a-4d4a-9118-8256f1649bc7', 'Garam', null, 'to taste'],
  ['5eafdde9-440a-4d60-8733-137489b61a90', 'Garam', null, 'to taste'],
  ['91d6e70b-b2c9-4648-b45a-09223ab47b6b', 'Saus Tiram', 1, 'tbsp'],
  ['91d6e70b-b2c9-4648-b45a-09223ab47b6b', 'Garam', null, 'to taste'],
  ['a8c5a749-7f38-4f30-89d8-d026f5a2ddd8', 'Garam', null, 'to taste'],
  ['a8c5a749-7f38-4f30-89d8-d026f5a2ddd8', 'Gula', null, 'to taste'],
  ['2e9fa9ff-a042-464a-b219-246d4e764359', 'Tepung Maizena', 100, 'g'],
  ['2e9fa9ff-a042-464a-b219-246d4e764359', 'Bawang Putih Bubuk', 1, 'tsp'],
  ['2e9fa9ff-a042-464a-b219-246d4e764359', 'Garam', null, 'to taste'],
  ['2e9fa9ff-a042-464a-b219-246d4e764359', 'Merica', null, 'to taste'],
  ['2e9fa9ff-a042-464a-b219-246d4e764359', 'Minyak Goreng', null, 'as needed'],
  ['5fada4e9-fa50-4b3f-b7bd-4b171e493569', 'Tepung Maizena', 50, 'g'],
  ['ad47136f-f463-4edc-a576-96ac79f465dd', 'Tepung Maizena', 50, 'g'],
  ['00db5b7d-8186-4370-b80e-2fdabebcec0d', 'Tepung Terigu', 100, 'g'],
  ['a3c6b759-e4a2-4163-b873-ee2db578a2b1', 'Kecap Manis', 4, 'tbsp'],
  ['22c1a93c-78ec-43d5-b153-e6813f5c0af5', 'Kecap Manis', 3, 'tbsp'],
  ['c2fbee6f-8057-4e9a-a54a-244685f9a52c', 'Saus Tomat', 4, 'tbsp'],
  ['c2fbee6f-8057-4e9a-a54a-244685f9a52c', 'Gula', 2, 'tbsp'],
  ['c2fbee6f-8057-4e9a-a54a-244685f9a52c', 'Tepung Maizena', 1, 'tbsp'],
  ['c2fbee6f-8057-4e9a-a54a-244685f9a52c', 'Cuka', 2, 'tbsp'],
  ['46601395-cc43-4c8b-97e7-f2573bf26095', 'Garam', null, 'to taste'],
  ['3959ae69-99cf-4fbb-bffd-9d7d8cc582aa', 'Kecap Asin', 1, 'tbsp'],
  ['6d1414ed-2816-4e55-badf-6f924b2afa45', 'Kecap Asin', 3, 'tbsp'],
  ['6d1414ed-2816-4e55-badf-6f924b2afa45', 'Minyak Goreng', 2, 'tbsp'],
  ['93703853-625a-4fc9-8c75-8daaef3bb419', 'Kecap Asin', 2, 'tbsp'],
  ['f28d02ac-f91f-40e6-a09a-0ab5b19b8c23', 'Gula', null, 'to taste'],
  ['17ad0dca-0db8-4db0-9a03-a8d378d1435a', 'Santan', 400, 'ml'],
  ['17ad0dca-0db8-4db0-9a03-a8d378d1435a', 'Gula Merah', 150, 'g'],
  ['17ad0dca-0db8-4db0-9a03-a8d378d1435a', 'Garam', null, 'a pinch'],
  ['a7b78d08-c9db-429e-adfb-8aaa2493eb57', 'Garam', null, 'to taste'],
  ['5a7912e2-0953-4022-a614-bc777d8607a9', 'Garam', null, 'to taste'],
  ['c4c196ff-7d22-4dfa-8a48-2ec69aa7504f', 'Saus Tiram', 1, 'tbsp'],
  ['a92b3c25-4373-4838-9277-8edda97dc708', 'Saus Tomat', 3, 'tbsp'],
  ['a92b3c25-4373-4838-9277-8edda97dc708', 'Saus Tiram', 2, 'tbsp'],
  ['4f2891b1-7392-4b72-af91-2bd53116932d', 'Kecap Manis', 2, 'tbsp'],
  ['4f2891b1-7392-4b72-af91-2bd53116932d', 'Garam', null, 'to taste'],
  ['e657ecb2-fd52-4259-b625-82e56918b122', 'Garam', null, 'to taste'],
  ['e657ecb2-fd52-4259-b625-82e56918b122', 'Merica', null, 'to taste'],
  ['e2802e9e-0d87-461e-b9c7-2644ae37d3e9', 'Saus Tiram', 2, 'tbsp'],
  ['a7dc5bb6-eb50-40c1-9f5f-d36c9f2c64f0', 'Saus Tomat', 4, 'tbsp'],
  ['a7dc5bb6-eb50-40c1-9f5f-d36c9f2c64f0', 'Saus Tiram', 2, 'tbsp'],
  ['5528b580-fa07-449a-958c-0eb8bb187a82', 'Merica', 1, 'tsp'],
  ['5528b580-fa07-449a-958c-0eb8bb187a82', 'Garam', null, 'to taste'],
  ['277a2054-5a20-41a5-a1f6-f27a639123ac', 'Saus Tiram', 1, 'tbsp'],
  ['277a2054-5a20-41a5-a1f6-f27a639123ac', 'Garam', null, 'to taste'],
  ['b2e53a32-3add-49b6-9876-6cc69f0c1cfa', 'Garam', null, 'to taste'],
  ['ebfc4749-09e4-4900-a175-61aa246351aa', 'Minyak Wijen', 1, 'tsp'],
  ['ebfc4749-09e4-4900-a175-61aa246351aa', 'Garam', null, 'to taste'],
  ['cee47edb-80e2-468f-81e2-60ce7a21c432', 'Gula Merah', 1, 'tbsp'],
  ['86f2dae2-a033-4fb3-a55d-cec8f5c93afb', 'Gula Merah', null, 'to taste'],
  ['86f2dae2-a033-4fb3-a55d-cec8f5c93afb', 'Garam', null, 'to taste'],
  ['fb8f2f22-6e57-4dc5-97db-7a63a805842d', 'Gula Merah', 1, 'tbsp'],
  ['a3fc5c41-53cd-40c8-bae4-14995476d96b', 'Kecap Manis', 4, 'tbsp'],
  ['a3fc5c41-53cd-40c8-bae4-14995476d96b', 'Garam', null, 'to taste'],
  ['a3fc5c41-53cd-40c8-bae4-14995476d96b', 'Merica', null, 'to taste'],
  ['244b0692-8abe-4476-9606-03331f0d6258', 'Garam', 1, 'tbsp'],
  ['244b0692-8abe-4476-9606-03331f0d6258', 'Gula', 1, 'tsp'],
  ['244b0692-8abe-4476-9606-03331f0d6258', 'Cuka', 2, 'tbsp'],
  ['04aee5af-49c9-4b8a-aebf-6d719ee0a26d', 'Garam', null, 'to taste'],
  ['e277000f-d105-410e-8020-041599289a3a', 'Garam', null, 'to taste'],
  ['1cb3c0a7-d5fa-40c1-a8fc-687c82301008', 'Kaldu Ayam Bubuk', 1.5, 'L'],
  ['1cb3c0a7-d5fa-40c1-a8fc-687c82301008', 'Garam', null, 'to taste'],
  ['1cb3c0a7-d5fa-40c1-a8fc-687c82301008', 'Merica', null, 'to taste'],
  ['51d0ae10-a6c0-409c-9fee-bdc11017c5a7', 'Kaldu Ayam Bubuk', 1.5, 'L'],
  ['51d0ae10-a6c0-409c-9fee-bdc11017c5a7', 'Tepung Maizena', 2, 'tbsp'],
  ['51d0ae10-a6c0-409c-9fee-bdc11017c5a7', 'Merica', 1, 'tsp'],
  ['fb26e990-68bc-4285-afa3-102a1951b82f', 'Kaldu Ayam Bubuk', 1.5, 'L'],
  ['fb26e990-68bc-4285-afa3-102a1951b82f', 'Garam', null, 'to taste'],
  ['fb26e990-68bc-4285-afa3-102a1951b82f', 'Merica', null, 'to taste'],
  ['59fe8dd9-009c-4ba9-b062-b59db2153f59', 'Garam', 1, 'tsp'],
  ['59fe8dd9-009c-4ba9-b062-b59db2153f59', 'Minyak Goreng', null, 'as needed'],
  ['47442753-9617-4c22-9c6a-41bd0c3387b6', 'Garam', null, 'to taste'],
  ['47442753-9617-4c22-9c6a-41bd0c3387b6', 'Merica', null, 'to taste'],
  ['5bf12519-9ab7-44bc-a398-de455ff4eb09', 'Tauco', 3, 'tbsp'],
  ['0f8d32e2-6823-4670-a727-e4307d97e7e7', 'Tauco', 3, 'tbsp'],
  ['158db1cb-af04-46b3-b91c-5f2f9aeb4864', 'Kecap Manis', 2, 'tbsp'],
  ['158db1cb-af04-46b3-b91c-5f2f9aeb4864', 'Garam', null, 'to taste'],
  ['158db1cb-af04-46b3-b91c-5f2f9aeb4864', 'Merica', null, 'to taste'],
  ['1835adc5-691c-47ef-99fd-8280e688a6e6', 'Garam', 1, 'tsp'],
  ['1835adc5-691c-47ef-99fd-8280e688a6e6', 'Minyak Goreng', null, 'as needed'],
  ['e3457761-ec03-42ea-86a2-9a0dc2595ae3', 'Gula', 1, 'tsp'],
  ['e3457761-ec03-42ea-86a2-9a0dc2595ae3', 'Minyak Goreng', null, 'as needed'],
  ['3e4801b8-76bd-44e1-a187-f0c33b4f713e', 'Gula Merah', 1, 'tbsp'],
  ['69b61242-86be-4f89-ad07-510ed47cfada', 'Kaldu Ayam Bubuk', 300, 'ml'],
  ['69b61242-86be-4f89-ad07-510ed47cfada', 'Kecap Asin', 1, 'tbsp'],
  ['69b61242-86be-4f89-ad07-510ed47cfada', 'Minyak Wijen', 1, 'tsp'],
  ['6fe7605c-4783-4010-98e5-968700c3fcdb', 'Garam', null, 'to taste'],
  ['6fe7605c-4783-4010-98e5-968700c3fcdb', 'Merica', null, 'to taste'],
  ['bb1e4977-0e73-4d5c-a680-bd0b776e8298', 'Tepung Maizena', 50, 'g'],
  ['72aba466-fc85-43b5-aaf9-f832e141c6f4', 'Kecap Manis', 3, 'tbsp'],
  ['72aba466-fc85-43b5-aaf9-f832e141c6f4', 'Saus Tomat', 2, 'tbsp'],
  ['fd6b3e15-2ec5-4bcc-b85b-6fb90e9b2ea3', 'Tepung Maizena', 50, 'g'],
]

async function main() {
  // ---- ensure the 15 new pantry ingredients exist ----------------------------
  const { data: existingIngredients, error: exErr } = await supabase.from('ingredients').select('id, name')
  if (exErr) { console.error('Failed to fetch ingredients:', exErr.message); process.exit(1) }
  const idByName = new Map(existingIngredients.map(i => [i.name, i.id]))

  for (const name of EXISTING_REUSED) {
    if (!idByName.has(name)) {
      console.error(`Expected "${name}" to already exist from the Part-1 migration — not found. Aborting.`)
      process.exit(1)
    }
  }

  const created = []
  for (const { name, unit } of PANTRY_INGREDIENTS) {
    if (idByName.has(name)) continue
    if (DRY_RUN) { idByName.set(name, `dry-run-${name}`); created.push(name); continue }
    const { data, error } = await supabase.from('ingredients').insert({
      name, aliases: [], category: 'pantry', default_unit: unit, shelf_stable: true,
    }).select('id').single()
    if (error) { console.error(`Failed to create ingredient "${name}":`, error.message); process.exit(1) }
    idByName.set(name, data.id)
    created.push(name)
  }

  // ---- idempotency: fetch existing dish_ingredients for the affected dishes --
  const dishIds = [...new Set(LINKS.map(l => l[0]))]
  const { data: existingLinksRaw, error: linksErr } = await supabase.from('dish_ingredients')
    .select('dish_id, ingredient_id').in('dish_id', dishIds)
  if (linksErr) { console.error('Failed to fetch existing dish_ingredients:', linksErr.message); process.exit(1) }
  const existingLinkKeys = new Set(existingLinksRaw.map(l => `${l.dish_id}|${l.ingredient_id}`))

  let inserted = 0
  let skippedExisting = 0
  const rowsToInsert = []
  for (const [dishId, canonicalName, amount, unit] of LINKS) {
    const ingredientId = idByName.get(canonicalName)
    if (!ingredientId) { console.error(`No ingredient id resolved for "${canonicalName}" — skipping link for dish ${dishId}`); continue }
    const key = `${dishId}|${ingredientId}`
    if (existingLinkKeys.has(key)) { skippedExisting++; continue }
    existingLinkKeys.add(key) // guard against dupes within LINKS itself
    rowsToInsert.push({ dish_id: dishId, ingredient_id: ingredientId, amount, unit })
    inserted++
  }

  if (!DRY_RUN && rowsToInsert.length) {
    const { error } = await supabase.from('dish_ingredients').insert(rowsToInsert)
    if (error) { console.error('Failed to insert dish_ingredients:', error.message); process.exit(1) }
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Pantry ingredients backfill report`)
  console.log('='.repeat(60))
  console.log(`Pantry ingredients created: ${created.length}${created.length ? ' (' + created.join(', ') + ')' : ''}`)
  console.log(`dish_ingredients rows to insert: ${inserted}`)
  console.log(`Skipped (already linked, e.g. Santan/Tepung Terigu from Part 1): ${skippedExisting}`)
  console.log(`Dishes touched: ${new Set(rowsToInsert.map(r => r.dish_id)).size}`)
  console.log(`\n${DRY_RUN ? 'Dry run complete — nothing was written.' : 'Backfill complete.'}`)
}

main()
