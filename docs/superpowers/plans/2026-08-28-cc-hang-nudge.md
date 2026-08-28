# Claude Code Hang-Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Claude Code session is waiting on Kevin and he wanders off, send him a WhatsApp ping every ~15 min until he responds or the session ends.

**Architecture:** Claude Code hooks are the event source. A `Notification` hook POSTs a "pending" row to a Next.js endpoint in the homespace app; `UserPromptSubmit` / `PreToolUse` / `SessionEnd` hooks POST "resolve". A checker (`lib/cc/checker.ts`) selects pending rows past a grace period and sends WhatsApp via the existing relay; it runs both at a dedicated `GET /api/cc/check` and as a phase inside the existing `/api/wa/cron`. Supabase table `cc_pending_prompts`. No relay-side code (the relay source isn't on this machine).

**Tech Stack:** Next.js 16 App Router route handlers, `@supabase/supabase-js` (`lib/supabase.ts`), vitest, bash hook scripts, `jq` + `curl`.

**Spec:** `docs/superpowers/specs/2026-08-28-cc-hang-nudge-design.md`

## Global Constraints

- Supabase project: `eelcqdkkefhvoloiikka` ("Homespace"). Migrations applied via the Supabase MCP `apply_migration` tool (records history) AND kept as `migrations/*.sql`. Verify with MCP `execute_sql`.
- RLS policy pattern, copied verbatim: `create policy "Allow all access" on <table> for all to public using (true) with check (true);` — app uses bcrypt auth, not Supabase Auth.
- `/api/cc/*` routes authenticate on `?secret=` query param OR `x-cc-secret` header, compared to `process.env.CRON_SECRET` (already set in Vercel + `.env.local` — no new env var).
- Nudge recipient is **Kevin only** — `WA_NUMBERS.kevin` from `lib/wa/config.ts`. English. Sent via `sendWhatsapp` from `lib/wa/relay.ts`.
- Timing: 10-min grace before first nudge, 15-min spacing between nudges, give up after 3 h, lazy-prune rows after 24 h. All measured from `created_at` / `last_nudged_at`.
- Hook scripts must **never exit non-zero** and must **never block** — every fallible line is best-effort, every script ends `exit 0`. No `set -e`.
- Hook scripts live once at `/Users/kevinciang/.claude/hooks/`; registered in BOTH `/Users/kevinciang/.claude/settings.json` and `/Users/kevinciang/.claude-personal/settings.json` with absolute paths.
- Vitest covers `lib/**/*.test.ts` only (`vitest.config.ts`). No `app/api/**/*.test.ts` anywhere — routes are verified with curl + SQL.
- Run `npx tsc --noEmit` and `npm test` before every commit touching `.ts`. Both must be run with the command sandbox because Next dev/build need `dangerouslyDisableSandbox` (see the repo memory) but tsc + vitest do not.
- A homespace dev server is usually already running on `localhost:3001` (port 3000 is often taken by another project). Reuse it via curl/Playwright with `dangerouslyDisableSandbox: true`; do not start your own.
- End every commit message with: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `migrations/2026-08-28-cc-hang-nudge.sql` | `cc_pending_prompts` table + RLS |
| `lib/cc/types.ts` | `CcPendingRow` type |
| `lib/cc/auth.ts` | `ccAuthorized(request)` — shared secret check |
| `lib/cc/checker.ts` | `composeHangNudge` (pure), `runCcCheck` (I/O: select → send → mark → prune) |
| `lib/cc/checker.test.ts` | vitest unit tests for `composeHangNudge` |
| `app/api/cc/pending/route.ts` | `POST` — upsert a pending row |
| `app/api/cc/resolve/route.ts` | `POST` — mark a session resolved |
| `app/api/cc/check/route.ts` | `GET` — run the checker |
| `/Users/kevinciang/.claude/hooks/cc-hangnudge.env` | `CC_RELAY_URL` + `CC_SECRET` (chmod 600) |
| `/Users/kevinciang/.claude/hooks/cc-pending.sh` | `Notification` hook (chmod +x) |
| `/Users/kevinciang/.claude/hooks/cc-resolve.sh` | resolve hook (chmod +x) |

**Modified files:**

| File | Change |
|------|--------|
| `proxy.ts` | add `/api/cc/` to the public-path list |
| `app/api/wa/cron/route.ts` | new `runCcCheck()` phase before the due-sender |
| `/Users/kevinciang/.claude/settings.json` | register hooks (via `update-config` skill) |
| `/Users/kevinciang/.claude-personal/settings.json` | register hooks (via `update-config` skill) |

---

## Task 1: Migration — `cc_pending_prompts`

**Files:**
- Create: `migrations/2026-08-28-cc-hang-nudge.sql`

**Interfaces:**
- Produces: table `cc_pending_prompts(session_id pk, cwd, message, status, created_at, updated_at, last_nudged_at, resolved_at)` with RLS "Allow all access".

- [ ] **Step 1: Write the migration file**

`migrations/2026-08-28-cc-hang-nudge.sql`:

```sql
-- Claude Code "you left me hanging" nudge: one pending row per waiting session.
-- Spec: docs/superpowers/specs/2026-08-28-cc-hang-nudge-design.md

create table if not exists cc_pending_prompts (
  session_id     text primary key,      -- from hook payload; natural upsert key
  cwd            text,                   -- project path, for "which repo" in the nudge
  message        text,                   -- notification / last question text
  status         text not null default 'pending',   -- pending | resolved
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_nudged_at timestamptz,
  resolved_at    timestamptz
);

alter table cc_pending_prompts enable row level security;
create policy "Allow all access" on cc_pending_prompts for all to public using (true) with check (true);
```

- [ ] **Step 2: Apply it**

Supabase MCP `apply_migration`, `project_id: eelcqdkkefhvoloiikka`, `name: cc_hang_nudge`, the SQL above as `query`.

- [ ] **Step 3: Verify**

Supabase MCP `execute_sql`:
```sql
select count(*) as rows from cc_pending_prompts;
```
Expected: `0`.

```sql
select column_name, data_type from information_schema.columns
where table_name = 'cc_pending_prompts' order by ordinal_position;
```
Expected: 8 columns — `session_id` text, `cwd` text, `message` text, `status` text, `created_at`/`updated_at`/`last_nudged_at`/`resolved_at` timestamptz.

```sql
select polname from pg_policies where tablename = 'cc_pending_prompts';
```
Expected: `Allow all access`.

- [ ] **Step 4: Commit**

```bash
git add migrations/2026-08-28-cc-hang-nudge.sql
git commit -m "feat(cc-nudge): migration — cc_pending_prompts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `lib/cc/` — types, auth helper, checker (TDD for `composeHangNudge`)

**Files:**
- Create: `lib/cc/types.ts`, `lib/cc/auth.ts`, `lib/cc/checker.ts`
- Test: `lib/cc/checker.test.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `sendWhatsapp` from `@/lib/wa/relay`; `WA_NUMBERS` from `@/lib/wa/config`.
- Produces:
  - `CcPendingRow` (type)
  - `ccAuthorized(request: Request): boolean`
  - `composeHangNudge(cwd: string | null, message: string | null): string`
  - `runCcCheck(now?: Date): Promise<{ nudged: number; skipped: number }>`

- [ ] **Step 1: Write `lib/cc/types.ts`**

```ts
export type CcPendingRow = {
  session_id: string
  cwd: string | null
  message: string | null
  status: 'pending' | 'resolved'
  created_at: string
  updated_at: string
  last_nudged_at: string | null
  resolved_at: string | null
}
```

- [ ] **Step 2: Write `lib/cc/auth.ts`**

```ts
// Shared guard for /api/cc/* — reuses CRON_SECRET (already provisioned in Vercel + .env.local).
export function ccAuthorized(request: Request): boolean {
  const url = new URL(request.url)
  const provided = url.searchParams.get('secret') ?? request.headers.get('x-cc-secret')
  return !!provided && provided === process.env.CRON_SECRET
}
```

- [ ] **Step 3: Write the failing test**

`lib/cc/checker.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { composeHangNudge } from './checker'

describe('composeHangNudge', () => {
  it('uses the basename of cwd and the message, on two lines', () => {
    expect(composeHangNudge('/Users/k/Documents/Projects/homespace', 'Need your input on the migration'))
      .toBe('⏳ Claude Code is waiting on you in homespace\n   Need your input on the migration')
  })

  it('strips a trailing slash from cwd', () => {
    expect(composeHangNudge('/x/y/concourse/', 'q'))
      .toBe('⏳ Claude Code is waiting on you in concourse\n   q')
  })

  it('falls back to "a session" when cwd is null or blank', () => {
    expect(composeHangNudge(null, 'q')).toContain('waiting on you in a session')
    expect(composeHangNudge('   ', 'q')).toContain('waiting on you in a session')
  })

  it('falls back to a default when message is null or blank', () => {
    expect(composeHangNudge('/x/homespace', null))
      .toBe("⏳ Claude Code is waiting on you in homespace\n   It's been idle a while.")
    expect(composeHangNudge('/x/homespace', '   ')).toContain("It's been idle a while.")
  })

  it('trims the message', () => {
    expect(composeHangNudge('/x/homespace', '  hi  '))
      .toBe('⏳ Claude Code is waiting on you in homespace\n   hi')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- lib/cc/checker.test.ts`
Expected: FAIL — `Cannot find module './checker'`.

- [ ] **Step 5: Write `lib/cc/checker.ts`**

```ts
import { supabase } from '@/lib/supabase'
import { sendWhatsapp } from '@/lib/wa/relay'
import { WA_NUMBERS } from '@/lib/wa/config'
import type { CcPendingRow } from './types'

const GRACE_MIN = 10
const SPACING_MIN = 15
const GIVEUP_HOURS = 3
const PRUNE_HOURS = 24

// "⏳ Claude Code is waiting on you in <repo>\n   <message>"
export function composeHangNudge(cwd: string | null, message: string | null): string {
  const trimmedCwd = cwd?.trim().replace(/\/+$/, '') ?? ''
  const where = trimmedCwd ? (trimmedCwd.split('/').pop() || 'a session') : 'a session'
  const msg = message?.trim() || "It's been idle a while."
  return `⏳ Claude Code is waiting on you in ${where}\n   ${msg}`
}

// Selects pending rows past the grace period that haven't been nudged recently,
// sends one WhatsApp each, then lazily prunes stale rows.
export async function runCcCheck(now: Date = new Date()): Promise<{ nudged: number; skipped: number }> {
  const graceIso  = new Date(now.getTime() - GRACE_MIN * 60_000).toISOString()
  const giveupIso = new Date(now.getTime() - GIVEUP_HOURS * 3_600_000).toISOString()
  const spacingIso = new Date(now.getTime() - SPACING_MIN * 60_000).toISOString()

  const { data } = await supabase.from('cc_pending_prompts').select('*')
    .eq('status', 'pending')
    .lt('created_at', graceIso)
    .gt('created_at', giveupIso)

  // Filter the 15-min spacing in JS (tiny table; avoids PostgREST timestamp
  // quoting in .or()). ISO strings compare lexicographically.
  const rows = ((data ?? []) as CcPendingRow[])
    .filter(r => !r.last_nudged_at || r.last_nudged_at < spacingIso)

  let nudged = 0, skipped = 0
  for (const row of rows) {
    const res = await sendWhatsapp(WA_NUMBERS.kevin, composeHangNudge(row.cwd, row.message))
    if (res.ok) {
      await supabase.from('cc_pending_prompts')
        .update({ last_nudged_at: now.toISOString() }).eq('session_id', row.session_id)
      nudged++
    } else {
      skipped++
    }
  }

  // Lazy prune: resolved rows and abandoned-pending rows older than a day.
  const pruneIso = new Date(now.getTime() - PRUNE_HOURS * 3_600_000).toISOString()
  await supabase.from('cc_pending_prompts').delete().eq('status', 'resolved').lt('updated_at', pruneIso)
  await supabase.from('cc_pending_prompts').delete().eq('status', 'pending').lt('created_at', pruneIso)

  return { nudged, skipped }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- lib/cc/checker.test.ts`
Expected: PASS (5 assertions groups).

- [ ] **Step 7: Full typecheck + suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean; full suite green.

- [ ] **Step 8: Commit**

```bash
git add lib/cc/types.ts lib/cc/auth.ts lib/cc/checker.ts lib/cc/checker.test.ts
git commit -m "feat(cc-nudge): checker + auth helper + types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Endpoints + `proxy.ts`

**Files:**
- Create: `app/api/cc/pending/route.ts`, `app/api/cc/resolve/route.ts`, `app/api/cc/check/route.ts`
- Modify: `proxy.ts`

**Interfaces:**
- Consumes: `supabase`, `ccAuthorized`, `runCcCheck`.
- Produces:
  - `POST /api/cc/pending` `{ session_id, cwd?, message? }` → `{ ok: true }` (401 / 400 on failure)
  - `POST /api/cc/resolve` `{ session_id }` → `{ ok: true }`
  - `GET /api/cc/check` → `{ nudged, skipped }`

- [ ] **Step 1: Write `app/api/cc/pending/route.ts`**

```ts
import { supabase } from '@/lib/supabase'
import { ccAuthorized } from '@/lib/cc/auth'

export async function POST(request: Request) {
  if (!ccAuthorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { session_id, cwd, message } = await request.json()
  if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  // Upsert on session_id. created_at / last_nudged_at are intentionally NOT
  // passed — a re-notification for a still-pending session keeps its original
  // clock. resolved_at cleared in case this session was resolved earlier.
  const { error } = await supabase.from('cc_pending_prompts').upsert({
    session_id,
    cwd: cwd ?? null,
    message: message ?? null,
    status: 'pending',
    resolved_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'session_id' })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Write `app/api/cc/resolve/route.ts`**

```ts
import { supabase } from '@/lib/supabase'
import { ccAuthorized } from '@/lib/cc/auth'

export async function POST(request: Request) {
  if (!ccAuthorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { session_id } = await request.json()
  if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  const nowIso = new Date().toISOString()
  const { error } = await supabase.from('cc_pending_prompts')
    .update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso })
    .eq('session_id', session_id).eq('status', 'pending')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true }) // idempotent — ok even if no row matched
}
```

- [ ] **Step 3: Write `app/api/cc/check/route.ts`**

```ts
import { ccAuthorized } from '@/lib/cc/auth'
import { runCcCheck } from '@/lib/cc/checker'

export async function GET(request: Request) {
  if (!ccAuthorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const result = await runCcCheck()
  return Response.json(result)
}
```

- [ ] **Step 4: Update `proxy.ts`**

Change the `isPublic` line to add `/api/cc/`:

```ts
  const isPublic = pathname === '/login'
    || pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/wa/cron')
    || pathname.startsWith('/api/cc/')
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual verification (curl + SQL)**

Dev server assumed on `localhost:3001` (start with `dangerouslyDisableSandbox` only if not running). `S=$(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2)`.

```bash
# 401 without secret
curl -s -o /dev/null -w "%{http_code}\n" -XPOST localhost:3001/api/cc/pending \
  -H 'content-type: application/json' -d '{"session_id":"t1"}'
# -> 401

# 400 missing session_id
curl -s -o /dev/null -w "%{http_code}\n" -XPOST localhost:3001/api/cc/pending \
  -H "x-cc-secret: $S" -H 'content-type: application/json' -d '{}'
# -> 400

# create pending
curl -s -XPOST localhost:3001/api/cc/pending -H "x-cc-secret: $S" \
  -H 'content-type: application/json' \
  -d '{"session_id":"t1","cwd":"/Users/k/Projects/homespace","message":"need input on X"}'
# -> {"ok":true}

# re-notify with a new message
curl -s -XPOST localhost:3001/api/cc/pending -H "x-cc-secret: $S" \
  -H 'content-type: application/json' \
  -d '{"session_id":"t1","cwd":"/Users/k/Projects/homespace","message":"still need input"}'

# resolve
curl -s -XPOST localhost:3001/api/cc/resolve -H "x-cc-secret: $S" \
  -H 'content-type: application/json' -d '{"session_id":"t1"}'
# -> {"ok":true}

# check (nothing due — t1 is resolved)
curl -s "localhost:3001/api/cc/check?secret=$S"
# -> {"nudged":0,"skipped":0}
```

Then Supabase `execute_sql`:
```sql
select session_id, message, status, created_at = updated_at as same_ts,
       last_nudged_at, resolved_at is not null as resolved
from cc_pending_prompts where session_id = 't1';
```
Expected: `message` = "still need input" (updated), `status` = resolved, `last_nudged_at` null, `resolved` true. (`same_ts` false — updated_at moved.)

Confirm `created_at` was NOT bumped by the re-notify: the row's `created_at` should be within a second or two of the first POST, not the second. (Eyeball the two curl timings.)

Cleanup: `delete from cc_pending_prompts where session_id = 't1';`

- [ ] **Step 7: Commit**

```bash
git add app/api/cc proxy.ts
git commit -m "feat(cc-nudge): /api/cc/pending, /resolve, /check + proxy exemption

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `/api/wa/cron` piggyback phase

**Files:**
- Modify: `app/api/wa/cron/route.ts`

**Interfaces:**
- Consumes: `runCcCheck` from `@/lib/cc/checker`.
- Produces: the existing cron tick also runs the hang-nudge check.

- [ ] **Step 1: Add the import**

In `app/api/wa/cron/route.ts`, with the other imports:

```ts
import { runCcCheck } from '@/lib/cc/checker'
```

- [ ] **Step 2: Add the phase**

Immediately after the `if (settings.backlog_enabled) { ... }` block and before `const { data: due } = await supabase.from('wa_outbound')...`:

```ts
  try {
    const r = await runCcCheck()
    if (r.nudged || r.skipped) console.log('cc_hang_nudge:', r)
  } catch (err) {
    console.error('cc_hang_nudge check failed:', err)
  }
```

(Does not touch the `built` / `sent` / `skipped` / `failed` counters — cc nudges are separate from the wa_outbound queue.)

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean, green.

- [ ] **Step 4: Manual verification**

Insert a pending row that's past grace, via Supabase `execute_sql`:
```sql
insert into cc_pending_prompts (session_id, cwd, message, status, created_at)
values ('cron-test', '/Users/k/Projects/homespace', 'wa/cron piggyback test', 'pending', now() - interval '11 minutes');
```

Then hit the real cron (safe — nothing else is due; confirmed pattern from the backlog work):
```bash
S=$(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2)
curl -s "localhost:3001/api/wa/cron?secret=$S"
```

Expected: one WhatsApp to Kevin — `⏳ Claude Code is waiting on you in homespace\n   wa/cron piggyback test`.

```sql
select session_id, last_nudged_at from cc_pending_prompts where session_id = 'cron-test';
```
Expected: `last_nudged_at` now set.

Re-run the curl immediately → no second WhatsApp (15-min spacing).

Cleanup: `delete from cc_pending_prompts where session_id = 'cron-test';`

- [ ] **Step 5: Commit**

```bash
git add app/api/wa/cron/route.ts
git commit -m "feat(cc-nudge): run the hang-nudge check on every wa/cron tick

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Hook scripts + env file

**Files:**
- Create: `/Users/kevinciang/.claude/hooks/cc-hangnudge.env` (chmod 600)
- Create: `/Users/kevinciang/.claude/hooks/cc-pending.sh` (chmod +x)
- Create: `/Users/kevinciang/.claude/hooks/cc-resolve.sh` (chmod +x)

These live outside the repo — **not committed**. Filesystem writes under `~/.claude/` are outside the sandbox's writable set, so every command in this task needs `dangerouslyDisableSandbox: true`.

**Interfaces:**
- Consumes: `POST /api/cc/pending`, `POST /api/cc/resolve`, `CRON_SECRET` (read from `.env.local`).
- Produces: two executable hook scripts + their config, referenced by Task 6.

- [ ] **Step 1: Create the hooks dir and env file**

```bash
mkdir -p /Users/kevinciang/.claude/hooks/.cc-state
S=$(grep -E '^CRON_SECRET=' /Users/kevinciang/Documents/Projects/homespace/.env.local | cut -d= -f2-)
cat > /Users/kevinciang/.claude/hooks/cc-hangnudge.env <<EOF
CC_RELAY_URL=https://homespace-chi.vercel.app
CC_SECRET=$S
EOF
chmod 600 /Users/kevinciang/.claude/hooks/cc-hangnudge.env
```

- [ ] **Step 2: Write `cc-pending.sh`**

```bash
cat > /Users/kevinciang/.claude/hooks/cc-pending.sh <<'EOF'
#!/usr/bin/env bash
# Notification hook: mark this session as "waiting on Kevin". Never fails.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
[ -f "$DIR/cc-hangnudge.env" ] && . "$DIR/cc-hangnudge.env"
command -v jq   >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0
[ -n "$CC_RELAY_URL" ] && [ -n "$CC_SECRET" ] || exit 0

payload=$(cat)
sid=$(jq -r '.session_id // empty' <<<"$payload" 2>/dev/null)
[ -n "$sid" ] || exit 0
cwd=$(jq -r '.cwd // ""' <<<"$payload" 2>/dev/null)
msg=$(jq -r '.message // "Claude Code is waiting on you"' <<<"$payload" 2>/dev/null)

mkdir -p "$DIR/.cc-state" 2>/dev/null
rm -f "$DIR/.cc-state/$sid.resolved" 2>/dev/null
find "$DIR/.cc-state" -type f -mtime +2 -delete 2>/dev/null

curl -s -m 5 -X POST "$CC_RELAY_URL/api/cc/pending" \
  -H 'content-type: application/json' -H "x-cc-secret: $CC_SECRET" \
  -d "$(jq -n --arg s "$sid" --arg c "$cwd" --arg m "$msg" \
        '{session_id:$s,cwd:$c,message:$m}')" >/dev/null 2>&1
exit 0
EOF
chmod +x /Users/kevinciang/.claude/hooks/cc-pending.sh
```

- [ ] **Step 3: Write `cc-resolve.sh`**

```bash
cat > /Users/kevinciang/.claude/hooks/cc-resolve.sh <<'EOF'
#!/usr/bin/env bash
# UserPromptSubmit / PreToolUse / SessionEnd hook: Kevin is back (or session ended).
# Never fails, never blocks the tool call.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
[ -f "$DIR/cc-hangnudge.env" ] && . "$DIR/cc-hangnudge.env"
command -v jq   >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0
[ -n "$CC_RELAY_URL" ] && [ -n "$CC_SECRET" ] || exit 0

payload=$(cat)
sid=$(jq -r '.session_id // empty' <<<"$payload" 2>/dev/null)
[ -n "$sid" ] || exit 0
event=$(jq -r '.hook_event_name // ""' <<<"$payload" 2>/dev/null)
marker="$DIR/.cc-state/$sid.resolved"

if [ "$event" = "SessionEnd" ]; then
  rm -f "$marker" 2>/dev/null
else
  [ -f "$marker" ] && exit 0   # already resolved this walk-away — fast path, no network
fi

curl -s -m 5 -X POST "$CC_RELAY_URL/api/cc/resolve" \
  -H 'content-type: application/json' -H "x-cc-secret: $CC_SECRET" \
  -d "$(jq -n --arg s "$sid" '{session_id:$s}')" >/dev/null 2>&1

if [ "$event" != "SessionEnd" ]; then
  mkdir -p "$DIR/.cc-state" 2>/dev/null
  touch "$marker" 2>/dev/null
fi
exit 0
EOF
chmod +x /Users/kevinciang/.claude/hooks/cc-resolve.sh
```

- [ ] **Step 4: Smoke-test the scripts with fake payloads**

```bash
S=$(grep -E '^CRON_SECRET=' /Users/kevinciang/Documents/Projects/homespace/.env.local | cut -d= -f2-)

# pending
echo '{"session_id":"hooktest","cwd":"/Users/k/Projects/homespace","message":"hook smoke test","hook_event_name":"Notification"}' \
  | /Users/kevinciang/.claude/hooks/cc-pending.sh ; echo "exit $?"

# resolve (first call — should POST, create marker)
echo '{"session_id":"hooktest","hook_event_name":"PreToolUse"}' \
  | /Users/kevinciang/.claude/hooks/cc-resolve.sh ; echo "exit $?"
ls /Users/kevinciang/.claude/hooks/.cc-state/    # expect hooktest.resolved

# resolve (second call — marker present, fast path, still exit 0)
echo '{"session_id":"hooktest","hook_event_name":"PreToolUse"}' \
  | /Users/kevinciang/.claude/hooks/cc-resolve.sh ; echo "exit $?"

# SessionEnd — should POST and delete the marker
echo '{"session_id":"hooktest","hook_event_name":"SessionEnd"}' \
  | /Users/kevinciang/.claude/hooks/cc-resolve.sh ; echo "exit $?"
ls /Users/kevinciang/.claude/hooks/.cc-state/    # hooktest.resolved gone
```

All four must print `exit 0`.

Then Supabase `execute_sql`:
```sql
select session_id, message, status from cc_pending_prompts where session_id = 'hooktest';
```
Expected: one row, `message` = "hook smoke test", `status` = resolved.

Cleanup: `delete from cc_pending_prompts where session_id = 'hooktest';`

- [ ] **Step 5: Verify against production**

The hooks target `https://homespace-chi.vercel.app`, not localhost. Confirm Task 3 + 4 are deployed to production first (merge to `main` happens in the finishing step — so if testing now, temporarily point `CC_RELAY_URL` at `http://localhost:3001` in `cc-hangnudge.env`, re-run Step 4, then set it back to production). Note this in the finishing report so the final live test (Task 6 Step 3) runs against the deployed endpoints.

- [ ] **Step 6: No commit** (files are outside the repo).

---

## Task 6: Register hooks in both settings.json

**Files:**
- Modify: `/Users/kevinciang/.claude/settings.json`
- Modify: `/Users/kevinciang/.claude-personal/settings.json`

**Interfaces:**
- Consumes: the scripts from Task 5.
- Produces: `Notification` also runs `cc-pending.sh`; `UserPromptSubmit` / `PreToolUse` / `SessionEnd` run `cc-resolve.sh` — in both config dirs.

- [ ] **Step 1: Invoke the `update-config` skill**

Use the `update-config` skill to make the edits below. It knows how to write these files (they're outside the sandbox writable set). If it cannot, fall back to a `dangerouslyDisableSandbox` Bash step using a JSON merge (Step 2 shows the target shape).

- [ ] **Step 2: Target shape (both files)**

Both files already contain a `Notification` entry (afplay) and a `Stop` entry. **Merge, do not replace.**

`Notification` — append a second command hook to the existing object's `hooks` array:
```json
"Notification": [
  {
    "matcher": "",
    "hooks": [
      { "type": "command", "command": "afplay /System/Library/Sounds/Glass.aiff &" },
      { "type": "command", "command": "/Users/kevinciang/.claude/hooks/cc-pending.sh" }
    ]
  }
]
```
(In `~/.claude-personal/settings.json` the existing sound is `Hero.aiff` — keep whatever is there, just add the second entry.)

Add three new top-level keys inside `"hooks"`:
```json
"UserPromptSubmit": [
  { "hooks": [{ "type": "command", "command": "/Users/kevinciang/.claude/hooks/cc-resolve.sh" }] }
],
"PreToolUse": [
  { "matcher": "", "hooks": [{ "type": "command", "command": "/Users/kevinciang/.claude/hooks/cc-resolve.sh" }] }
],
"SessionEnd": [
  { "hooks": [{ "type": "command", "command": "/Users/kevinciang/.claude/hooks/cc-resolve.sh" }] }
]
```

- [ ] **Step 3: Verify the JSON is valid**

```bash
for f in /Users/kevinciang/.claude/settings.json /Users/kevinciang/.claude-personal/settings.json; do
  jq -e '.hooks.Notification[0].hooks | map(.command) | any(test("cc-pending"))' "$f" >/dev/null \
    && jq -e '.hooks.PreToolUse[0].hooks[0].command | test("cc-resolve")' "$f" >/dev/null \
    && jq -e '.hooks.SessionEnd[0].hooks[0].command | test("cc-resolve")' "$f" >/dev/null \
    && jq -e '.hooks.UserPromptSubmit[0].hooks[0].command | test("cc-resolve")' "$f" >/dev/null \
    && echo "$f OK" || echo "$f FAILED"
done
```
Expected: both `OK`. Also confirm the afplay hook is still present:
```bash
jq '.hooks.Notification[0].hooks | length' /Users/kevinciang/.claude/settings.json   # expect 2
```

- [ ] **Step 4: Live end-to-end test**

Requires Tasks 3–4 deployed to production (`homespace-chi.vercel.app`) and `cc-hangnudge.env` pointing there.

1. In a **separate** Claude Code session (any repo), submit a prompt then let it sit idle. After ~60 s a `Notification` fires.
2. Supabase `execute_sql`:
   ```sql
   select session_id, cwd, message, status, created_at from cc_pending_prompts order by created_at desc limit 3;
   ```
   Expected: a fresh `pending` row for that session.
3. Back in that session, submit a prompt (or approve a permission prompt). Within a moment:
   ```sql
   select session_id, status, resolved_at from cc_pending_prompts order by updated_at desc limit 3;
   ```
   Expected: that row flipped to `resolved`.
4. Optional full loop: create a `Notification`, wait 11+ min without responding, and confirm a WhatsApp arrives (only if a 5-min trigger is pointed at `/api/cc/check`, or wait for the next `/api/wa/cron` tick). Then respond and confirm the nudges stop.

- [ ] **Step 5: No commit** (files are outside the repo). Report what changed in the finishing summary.

---

## Task 7: Final verification

**Files:** none.

- [ ] **Step 1:** `npx tsc --noEmit && npm test` — clean, green (5 new `composeHangNudge` assertions).
- [ ] **Step 2:** `npm run lint` — no new errors in `lib/cc/**`, `app/api/cc/**` (the 2 pre-existing `WaSettingsClient.tsx` errors are not ours).
- [ ] **Step 3:** `npm run build` (needs `dangerouslyDisableSandbox`) — succeeds; `/api/cc/pending`, `/api/cc/resolve`, `/api/cc/check` listed as routes.
- [ ] **Step 4:** Confirm `cc_pending_prompts` has no leftover test rows:
  ```sql
  select session_id, status from cc_pending_prompts;
  ```
  Delete any `t1` / `cron-test` / `hooktest` rows still present.
- [ ] **Step 5:** Confirm the hook env file points at production:
  ```bash
  grep CC_RELAY_URL /Users/kevinciang/.claude/hooks/cc-hangnudge.env   # homespace-chi.vercel.app
  ```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|--------------|------|
| §1 deviations D1–D6 | D1/D2 → Tasks 3–4; D3 → Task 2 (`ccAuthorized`) + Task 3; D4 → Tasks 5–6; D5 → Task 5 (`cc-resolve.sh` marker); D6 → Task 5 (env file) |
| §2 table + RLS | Task 1 |
| §3.1 `CcPendingRow` | Task 2 Step 1 |
| §3.2 `composeHangNudge` | Task 2 Steps 3–6 (TDD) |
| §3.2 `runCcCheck` (select / send / mark / prune) | Task 2 Step 5 |
| §4.1 secret guard | Task 2 Step 2 (`ccAuthorized`) |
| §4.2 `POST /api/cc/pending` (upsert, no `created_at`/`last_nudged_at`) | Task 3 Step 1 |
| §4.3 `POST /api/cc/resolve` (guarded `status='pending'`, idempotent) | Task 3 Step 2 |
| §4.4 `GET /api/cc/check` | Task 3 Step 3 |
| §4.5 `/api/wa/cron` phase (no counter changes) | Task 4 |
| §4.6 `proxy.ts` public path | Task 3 Step 4 |
| §5.1 files + `cc-hangnudge.env` | Task 5 Step 1 |
| §5.2 `cc-pending.sh` | Task 5 Step 2 |
| §5.3 `cc-resolve.sh` + marker lifecycle | Task 5 Step 3 |
| §5.4 registration in both settings.json (merge, absolute paths, via update-config) | Task 6 |
| §6 timing model | encoded as `GRACE_MIN`/`SPACING_MIN`/`GIVEUP_HOURS` constants, Task 2 Step 5 |
| §7 unit + manual tests | Task 2 (unit), Tasks 3–6 (manual), Task 7 |

No gaps. One deliberate simplification vs spec §3.2: `runCcCheck` filters the 15-min spacing in JS and prunes with two `.delete()` calls instead of `.or()` / one combined delete — same result, avoids PostgREST timestamp-quoting. Noted inline in Task 2 Step 5.

**2. Placeholder scan:** No "TBD"/"handle errors"/"similar to". `<value of CRON_SECRET>` in the env file is resolved by a concrete `grep ... | cut` in Task 5 Step 1. Every code + script block is literal.

**3. Type consistency:**
- `ccAuthorized(request: Request): boolean` — Task 2 Step 2 def, used in all three routes (Task 3) with the same call.
- `composeHangNudge(cwd: string | null, message: string | null): string` — Task 2 def + tests + used inside `runCcCheck`.
- `runCcCheck(now?: Date): Promise<{ nudged: number; skipped: number }>` — Task 2 def; called with no args in `/api/cc/check` (Task 3 Step 3) and `/api/wa/cron` (Task 4 Step 2). Return shape `{ nudged, skipped }` consumed as `r.nudged` / `r.skipped` in Task 4.
- `CcPendingRow` fields ↔ table columns (Task 1) ↔ `select('*')` cast in `runCcCheck`.
- Hook payload fields (`session_id`, `cwd`, `message`, `hook_event_name`) — read in Task 5 scripts, written by Claude Code, matched against `/api/cc/pending` body keys (`session_id`, `cwd`, `message`) in Task 3 Step 1.
- `x-cc-secret` header — set by both scripts (Task 5), read by `ccAuthorized` (Task 2 Step 2).

Consistent.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-28-cc-hang-nudge.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.

**2. Inline Execution** — tasks in this session with checkpoints.

**Which approach?**
