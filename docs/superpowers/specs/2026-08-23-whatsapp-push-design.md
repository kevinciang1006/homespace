# WhatsApp PUSH layer — design

## Goal

Scheduled outbound WhatsApp messages to Kevin's wife (and optionally Kevin),
sent via the existing Mac Mini relay: a weekly shopping list, a daily
meal reminder (evening before), and a smart prep/thaw batch reminder. All
messages are Indonesian, warm, short, and end with the Homespace link — the
recipient should never need to open the app. Driven by a cron endpoint an
external scheduler hits every ~30 min; the endpoint is idempotent and safe
to call repeatedly.

## Non-goals

- No in-app notification center, no delivery-status webhook from the relay.
- No per-recipient send tracking on one `wa_outbound` row — a row is one
  atomic send to all its recipients (see Error handling).
- No arbitrary/user-editable recipient list — Kevin's and wife's numbers are
  fixed infra constants; settings only toggles whether Kevin's is included.
- Not scoping any cron *scheduler* — Kevin triggers the endpoint externally.

## Data

### `wa_settings` (new, singleton row)

| column | type | default |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `weekly_enabled` | bool | `true` |
| `weekly_time` | text `HH:MM` | `'09:00'` |
| `daily_enabled` | bool | `true` |
| `daily_time` | text `HH:MM` | `'17:30'` |
| `prep_enabled` | bool | `true` |
| `prep_time` | text `HH:MM` | `'19:30'` |
| `include_kevin` | bool | `false` |
| `updated_at` | timestamptz | `now()` |

All times are Asia/Jakarta (fixed UTC+7, no DST) wall-clock. Migration seeds
exactly one row; the app always reads/updates the first (only) row, never
inserts a second.

### `wa_outbound` (existing — add one constraint)

```sql
alter table wa_outbound add constraint wa_outbound_kind_ref_date_key unique (kind, ref_date);
```

`kind` ∈ `'weekly_shopping' | 'daily_reminder' | 'prep_thaw'`. `ref_date` is
the date the message is *about*: the Saturday for weekly, tomorrow's date
for daily, the prep evening's date for prep/thaw. This pair is the dedupe
key — see Cron logic.

## Recipients

Fixed constants (`lib/wa/config.ts`), not stored in settings:

```ts
export const WA_NUMBERS = { wife: '+6283194111119', kevin: '+6282242382604' }
export const HOMESPACE_URL = 'https://homespace-chi.vercel.app'
```

Resolved recipient list for a build = `[wife]` plus `[kevin]` if
`include_kevin`. Recipients are stored in `wa_outbound.recipients` (jsonb
array of phone strings) at build time and refreshed on every unsent-row
rebuild, so toggling the setting before send time takes effect.

## Message composition (`lib/wa/messages.ts`, pure + unit-tested)

### Weekly shopping (`kind: 'weekly_shopping'`)

- Target week = the Monday-start week following the Saturday's own week
  (`shiftWeek(mondayOf(refDate), 7)`).
- Primary source: `meal_shopping_lists`/`meal_shopping_items` for that
  `week_start`, filtered to `checked = false && already_have = false`.
- Fallback (no list row yet): build directly from `dishes.shop_ingredients`
  (`{item, amount, unit, category}`, category ∈ `protein|veg|bumbu|other`)
  across that week's `meal_plans`, summing duplicate items by name.
- Grouped into **Protein / Sayur / Bumbu / Lainnya** — category mapping:
  `protein→Protein`, `vegetable|veg→Sayur`, `bumbu→Bumbu`,
  `pantry|other|dish→Lainnya`. Every group heading (all four) is omitted
  entirely when it has zero items that week — an empty "Bumbu: -" line adds
  no value and the message should stay short.
- Message shape: warm one-line opener, then the non-empty groups as short
  bullet lines, closing with the Homespace link.

### Daily meal reminder (`kind: 'daily_reminder'`)

- `ref_date` = tomorrow. Reads `meal_plans` for that date:
  breakfast (`slot='breakfast'`), dinner main (`role='main'`), supporting
  (`role='support'` only — `optional`/garnish rows are dropped to keep the
  message short), fruit (`slot='fruit'`).
- Skips a section entirely if nothing's planned there (e.g. no plan for
  tomorrow yet → message says so plainly rather than being sent empty; if
  there's truly nothing planned at all for that date, no row is built).

### Prep/thaw reminder (`kind: 'prep_thaw'`)

- Scans `meal_plans` (dish_id set, not skipped) 14 days out, joined to
  `dishes` for `needs_thaw`/`needs_marinate`.
- Prep date per dish = `cook_date - max(prep_lead_days, 1)` (a dish flagged
  thaw/marinate always gets at least one evening's notice, even if
  `prep_lead_days` is unset/0).
- Batches all dishes sharing the same prep date into one `wa_outbound` row
  (`ref_date` = that prep date), one clause per dish using `prep_note` when
  present, else a generic "thaw + marinate" / "thaw" / "marinate" phrase
  derived from the two flags, with the cook day name in parentheses.

All three: Indonesian, warm, short, always end with `HOMESPACE_URL`.

## Cron endpoint (`app/api/wa/cron/route.ts`, GET)

`?secret=` must equal `CRON_SECRET` (new env var, Kevin sets it in Vercel;
add to `.env.example` too) or the route 404s/401s without leaking anything.

**Normal mode** — two phases, always both run:

1. **Build** — for each kind enabled in `wa_settings`:
   - `weekly_shopping`: compute the upcoming Saturday (today if today *is*
     Saturday, else the next one) → `send_at` from `weekly_time` (Asia/Jakarta).
   - `daily_reminder`: tomorrow → `send_at` from `daily_time`, on *today's*
     date (the reminder fires the evening before).
   - `prep_thaw`: every distinct prep date found in the 14-day scan →
     `send_at` from `prep_time` on that prep date.
   - For each computed `(kind, ref_date)`: upsert on that unique pair —
     insert if absent; if present and `sent = false`, refresh `message`,
     `recipients`, `send_at` (content and recipients may have changed since
     last build); if present and `sent = true`, leave untouched.
2. **Send** — select `wa_outbound where sent = false and send_at <= now()`;
   for each row, re-check its kind is still enabled in `wa_settings` (skip
   silently if disabled — leaves the row pending, never sent, never
   rebuilt further since the build phase also honors the same flag); POST
   `{token: WHATSAPP_RELAY_SECRET, phone, message}` to
   `${WHATSAPP_RELAY_URL}/send-whatsapp` once per recipient in
   `row.recipients`. If every recipient call returns `{ok:true}`, mark
   `sent = true, sent_at = now()`. If any call fails, leave `sent = false`
   (retried whole next tick — see Error handling for the trade-off this implies).

Returns `{ built: number, sent: number, skipped: number, failed: number }`.

**Test mode** — `&test=1&to=+62...`: bypasses `wa_outbound` completely.
Composes all three message types from current real data using the same
`lib/wa/messages.ts` functions (next Saturday's target week / tomorrow's
plan / the next real prep batch found in the 14-day scan), falling back to
one clearly-labeled sample line per type (e.g. "🧊 *(contoh, belum ada
data prep minggu ini)*") when there's nothing real to show, so all three
formats are always previewable. Sends each straight to `to`, ignoring
`wa_settings` and the schedule entirely. Returns
`{ sent: ['weekly_shopping', 'daily_reminder', 'prep_thaw'] }` (or per-type
error detail on relay failure).

## Error handling

- Relay call failure (network error, non-`{ok:true}` response): logged,
  row stays `sent = false`, retried next tick. Known trade-off: if a row
  has 2 recipients and one relay call succeeds while the other fails, the
  next tick resends to *both* (relay has no dedupe, and `wa_outbound` only
  tracks row-level sent state). Acceptable for a 2-person household; not
  worth a per-recipient status column.
- Missing/wrong `secret`: `401` with a generic body, no details.
- Build phase reading `meal_plans`/`dishes` errors: that kind's build is
  skipped for this tick (counted in `skipped`), other kinds still proceed;
  next tick retries.

## Settings page

- `app/api/wa/settings/route.ts` — `GET` (returns the singleton row, lazily
  inserting the default row if somehow missing), `PATCH` (whitelisted
  fields: the three `*_enabled`, three `*_time`, `include_kevin`).
- `app/settings/page.tsx` + `components/settings/WaSettingsClient.tsx` —
  three toggle+time rows (Weekly shopping list / Daily meal reminder /
  Prep-thaw reminder) and an "Also send to Kevin" toggle. Same
  fetch-and-PATCH-on-change pattern as `DishEditorPanel`'s inline fields.
- New tile on the home page (`app/page.tsx`) linking to `/settings`
  ("Notifications" / bell icon, `lucide-react` already a dependency).

## Testing

- `lib/wa/messages.test.ts` — weekly grouping (including the Lainnya-only-
  when-nonempty rule and the checked/already-have filter), daily reminder
  section composition (including a missing section), prep/thaw batching
  (same-evening grouping, `prep_note` override, the `max(lead,1)` floor).
- `lib/wa/schedule.test.ts` — upcoming-Saturday computation (today-is-
  Saturday edge case), tomorrow's date, Asia/Jakarta `HH:MM` → UTC
  `send_at` conversion.
- No live-relay tests (network I/O) — mirrors the rest of the repo, which
  keeps external calls (Google Calendar, relay) untested and confines unit
  tests to pure `lib/` logic.

## Files touched

**New:** `migrations/2026-08-23-wa-push.sql`, `lib/wa/config.ts`,
`lib/wa/messages.ts` (+ test), `lib/wa/schedule.ts` (+ test),
`lib/wa/relay.ts`, `app/api/wa/cron/route.ts`,
`app/api/wa/settings/route.ts`, `app/settings/page.tsx`,
`components/settings/WaSettingsClient.tsx`.

**Modified:** `app/page.tsx` (new tile), `.env.example` (`CRON_SECRET`).
