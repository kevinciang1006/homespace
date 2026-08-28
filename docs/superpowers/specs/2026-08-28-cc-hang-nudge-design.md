# Claude Code "you left me hanging" nudge — Design Spec

**Date:** 2026-08-28
**Brief:** pasted in-session (`Claude Code — "you left me hanging" WhatsApp nudge (build brief)`)
**Status:** approved for planning

When a Claude Code session is waiting on Kevin and he wanders off, send a WhatsApp
ping, repeated every ~15 min until he responds or the session ends. Claude Code
**hooks** are the event source. Reuses the existing WhatsApp relay (`sendWhatsapp`
→ relay `/send-whatsapp`) and Supabase project `eelcqdkkefhvoloiikka`. Separate
table and endpoints from the Backlog module.

**Key idea:** `Notification` hook = "I need you" → write a pending row.
`UserPromptSubmit` / `PreToolUse` / `SessionEnd` = "you're back" or "done" →
resolve. Resolving on `PreToolUse` is what catches permission approvals, which
don't fire `UserPromptSubmit`.

---

## 1. Deviations from the brief

The brief assumes the `homespace-relay` source is editable and that it runs its
own cron. Neither holds on this machine, so:

| # | Brief | This design |
|---|-------|-------------|
| D1 | `POST /cc/pending`, `/cc/resolve` on the relay | Next.js route handlers in this repo: `/api/cc/pending`, `/api/cc/resolve` |
| D2 | Checker cron *on the relay*, every 5 min | Checker logic in `lib/cc/checker.ts`, exposed at `GET /api/cc/check` (secret-guarded) **and** run as a new phase inside the existing `app/api/wa/cron/route.ts`. The 5-min trigger stays user-managed (same as `/api/wa/cron` today). |
| D3 | Endpoints unauthenticated | All `/api/cc/*` routes guard on `?secret=` / `x-cc-secret` header == `process.env.CRON_SECRET` (already provisioned in Vercel + `.env.local`; no new env var) |
| D4 | Hooks in `~/.claude/hooks/`, registered in `~/.claude/settings.json` | Scripts live once at `~/.claude/hooks/`; registered in **both** `~/.claude/settings.json` and `~/.claude-personal/settings.json` (the active `CLAUDE_CONFIG_DIR` on this machine is `~/.claude-personal`) |
| D5 | `cc-resolve.sh` always curls | `cc-resolve.sh` fast-paths on a local marker file — only the first tool call after a `Notification` hits the network (perf: `PreToolUse` fires on every tool call) |
| D6 | `CC_RELAY_URL` = relay tailnet address | `CC_RELAY_URL` = `https://homespace-chi.vercel.app` (production homespace) |

Non-goals (v0): the §6 v0.1 transcript-parsing refinement (only mark pending when
the last assistant turn looks like a question). Idle-wait past the grace period is
a good-enough signal for v0.

## 2. Data — `cc_pending_prompts`

```sql
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

Migration file: `migrations/2026-08-28-cc-hang-nudge.sql`. Applied via Supabase MCP
`apply_migration` (name `cc_hang_nudge`), verified with `execute_sql`. Matches the
repo convention (`migrations/*.sql` + MCP apply).

No index beyond the PK — the table holds at most a handful of rows (one per live
session, resolved rows pruned lazily; see §5).

## 3. `lib/cc/`

### 3.1 `types.ts`

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

### 3.2 `checker.ts`

**`composeHangNudge(cwd: string | null, message: string | null): string`** — pure,
unit-tested:

```
⏳ Claude Code is waiting on you in <basename(cwd)>
   <message>
```

- `basename(cwd)`: last path segment; if `cwd` is null/empty → `"a session"`.
- `message`: trimmed; if null/empty → `"It's been idle a while."`
- Exactly two lines (second indented 3 spaces), matching the brief.

**`runCcCheck(now?: Date): Promise<{ nudged: number; skipped: number }>`** — the
checker. Not unit-tested (I/O), matching `lib/wa/settings.ts` convention:

1. Query `cc_pending_prompts`:
   ```
   status = 'pending'
   AND created_at   < now - interval '10 minutes'     -- grace: ignore short breaks
   AND created_at   > now - interval '3 hours'         -- give up on abandoned sessions
   AND (last_nudged_at IS NULL OR last_nudged_at < now - interval '15 minutes')
   ```
   Expressed with supabase-js: `.eq('status','pending').lt('created_at', graceIso)
   .gt('created_at', giveupIso).or('last_nudged_at.is.null,last_nudged_at.lt.' + spacingIso)`.
2. For each row: `await sendWhatsapp(WA_NUMBERS.kevin, composeHangNudge(row.cwd, row.message))`.
   - On `ok` → `update ... set last_nudged_at = now where session_id = row.session_id`; `nudged++`.
   - On failure → leave `last_nudged_at` untouched (retried next run); `skipped++`.
3. Lazy prune: `delete from cc_pending_prompts where status = 'resolved' and updated_at < now - interval '24 hours'` **and** `where status = 'pending' and created_at < now - interval '24 hours'` (abandoned, never resolved). One combined delete at the end of the run.
4. Return `{ nudged, skipped }`.

`WA_NUMBERS.kevin` and `sendWhatsapp` come from `lib/wa/config.ts` / `lib/wa/relay.ts`.

## 4. Endpoints

All three: `import { supabase } from '@/lib/supabase'`, JSON in / `Response.json`
out, `{ error }` + status on failure — same shape as `app/api/wa/settings/route.ts`
and `app/api/backlog/items/*`.

### 4.1 Secret guard

Shared helper (inline in each route or `lib/cc/auth.ts`):

```ts
function authorized(request: Request): boolean {
  const url = new URL(request.url)
  const provided = url.searchParams.get('secret') ?? request.headers.get('x-cc-secret')
  return !!provided && provided === process.env.CRON_SECRET
}
```

Unauthorized → `Response.json({ error: 'unauthorized' }, { status: 401 })`.

### 4.2 `POST /api/cc/pending`

Body `{ session_id, cwd?, message? }`. `session_id` required (400 if missing).

```sql
insert into cc_pending_prompts (session_id, cwd, message, status, updated_at)
values ($1, $2, $3, 'pending', now())
on conflict (session_id) do update
  set status = 'pending',
      message = excluded.message,
      cwd = excluded.cwd,
      updated_at = now();
```

Via supabase-js: `.upsert({ session_id, cwd, message, status: 'pending', updated_at: nowIso }, { onConflict: 'session_id' })`.
**Does not set `last_nudged_at`** — the nudge clock keeps running across
re-notifications within one walk-away. **Does not set `created_at`** — on a
re-notification for a still-pending row, `created_at` stays at the original
(so grace/give-up are measured from the first "I need you"). supabase `upsert`
won't overwrite `created_at` since we don't pass it.

Returns `Response.json({ ok: true })`.

### 4.3 `POST /api/cc/resolve`

Body `{ session_id }` (400 if missing).

```
update cc_pending_prompts
  set status = 'resolved', resolved_at = now(), updated_at = now()
  where session_id = $1 and status = 'pending';
```

Guard `status = 'pending'` so a repeat resolve is a no-op that doesn't move
`resolved_at`. Returns `{ ok: true }` regardless of whether a row matched
(idempotent; the hook doesn't care).

### 4.4 `GET /api/cc/check`

`const r = await runCcCheck(); return Response.json(r)` — `{ nudged, skipped }`.
`GET` (not `POST`) so a plain scheduler ping / browser hit works, same as
`/api/wa/cron`.

### 4.5 `app/api/wa/cron/route.ts` — new phase

After the `backlog_nudge` phase, before the due-sender:

```ts
try {
  const r = await runCcCheck()
  if (r.nudged || r.skipped) console.log('cc_hang_nudge:', r)
} catch (err) {
  console.error('cc_hang_nudge check failed:', err)
}
```

Does not touch the `{ built, sent, skipped, failed }` counters — cc nudges are a
separate concern from the wa_outbound queue and go straight out via `sendWhatsapp`.

No settings toggle — this nudge is always on when a pending row qualifies
(it's Kevin-only infrastructure, not a household-facing feature). If it ever
needs an off switch, that's a follow-up.

### 4.6 `proxy.ts`

```ts
const isPublic = pathname === '/login'
  || pathname.startsWith('/api/auth/')
  || pathname.startsWith('/api/wa/cron')
  || pathname.startsWith('/api/cc/')
```

## 5. Hooks

### 5.1 Files (created once, referenced from both config dirs)

```
~/.claude/hooks/cc-hangnudge.env      # chmod 600
~/.claude/hooks/cc-pending.sh         # chmod +x
~/.claude/hooks/cc-resolve.sh         # chmod +x
~/.claude/hooks/.cc-state/            # marker dir, created by the scripts
```

**`cc-hangnudge.env`**:
```sh
CC_RELAY_URL=https://homespace-chi.vercel.app
CC_SECRET=<value of CRON_SECRET from ~/Documents/Projects/homespace/.env.local>
```
The plan step reads `CRON_SECRET` out of `.env.local` and writes it here. Same
plaintext-on-same-machine exposure as `.env.local` itself; file is `chmod 600`.

### 5.2 `cc-pending.sh`

```bash
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

# New "I need you" — let cc-resolve.sh fire again for this session.
mkdir -p "$DIR/.cc-state" 2>/dev/null
rm -f "$DIR/.cc-state/$sid.resolved" 2>/dev/null
find "$DIR/.cc-state" -type f -mtime +2 -delete 2>/dev/null   # lazy cleanup

curl -s -m 5 -X POST "$CC_RELAY_URL/api/cc/pending" \
  -H 'content-type: application/json' -H "x-cc-secret: $CC_SECRET" \
  -d "$(jq -n --arg s "$sid" --arg c "$cwd" --arg m "$msg" \
        '{session_id:$s,cwd:$c,message:$m}')" >/dev/null 2>&1
exit 0
```

### 5.3 `cc-resolve.sh`

```bash
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
  rm -f "$marker" 2>/dev/null                   # session over — drop the marker
else
  [ -f "$marker" ] && exit 0                    # already resolved this walk-away — fast path, no network
fi

curl -s -m 5 -X POST "$CC_RELAY_URL/api/cc/resolve" \
  -H 'content-type: application/json' -H "x-cc-secret: $CC_SECRET" \
  -d "$(jq -n --arg s "$sid" '{session_id:$s}')" >/dev/null 2>&1

if [ "$event" != "SessionEnd" ]; then
  mkdir -p "$DIR/.cc-state" 2>/dev/null
  touch "$marker" 2>/dev/null
fi
exit 0
```

Note: no `set -e` — every line is best-effort and the script always `exit 0`
(a non-zero `PreToolUse` hook can interfere with the tool call).

### 5.3.1 Marker lifecycle

- `Notification` → `cc-pending.sh` deletes `$sid.resolved`.
- First `UserPromptSubmit`/`PreToolUse` after that → `cc-resolve.sh` POSTs resolve, recreates `$sid.resolved`.
- Subsequent tool calls → marker present → instant `exit 0`.
- Next `Notification` (new permission / new idle) → marker deleted again, cycle repeats.
- `SessionEnd` → POSTs resolve, deletes marker.

### 5.4 Registration (`update-config` skill)

Both `~/.claude/settings.json` and `~/.claude-personal/settings.json` already have
`Notification` and `Stop` hook entries (afplay sounds). Merge, don't replace:

- `Notification`: **append** a second hook object → `{ "type": "command", "command": "/Users/kevinciang/.claude/hooks/cc-pending.sh" }` (keep the existing afplay entry).
- `UserPromptSubmit`, `PreToolUse`, `SessionEnd`: add new top-level keys, each →
  `[{ "hooks": [{ "type": "command", "command": "/Users/kevinciang/.claude/hooks/cc-resolve.sh" }] }]`.

Absolute paths (the existing hooks use absolute paths; `~` is not expanded in hook
commands). Same command string in both files.

The settings.json edits are performed via the `update-config` skill during
implementation.

## 6. Timing model & degradation

Designed for a ~5-min checker trigger:

| Parameter | Value | Source |
|-----------|-------|--------|
| Grace before first nudge | 10 min | `created_at < now - 10m` |
| Nudge spacing | 15 min | `last_nudged_at < now - 15m` |
| Give up | 3 h | `created_at > now - 3h` |
| Checker cadence | ~5 min (user-managed) + piggyback on `/api/wa/cron` | §4.4–4.5 |

If the only trigger is `/api/wa/cron` at ~30 min: first nudge lands 10–40 min
after walk-away, repeats every ~30 min. Coarser, still works. Recommend pointing
a 5-min trigger at `/api/cc/check` (the existing wa/cron scheduler at 5-min
cadence, `cron-job.org`, or Vercel Cron on Pro).

## 7. Testing

- **Unit (`lib/cc/checker.test.ts`, vitest):** `composeHangNudge` — basename
  extraction, null/empty `cwd`, null/empty `message`, two-line shape, trailing
  whitespace trimmed.
- **Manual (curl + SQL), per brief §7:**
  1. Migration → `select * from cc_pending_prompts` (empty, table exists).
  2. `curl -XPOST .../api/cc/pending -H 'x-cc-secret: <s>' -d '{"session_id":"t1","cwd":"/x/y/homespace","message":"need input"}'` → row appears, `status=pending`. Repeat with new `message` → same row, message updated, `created_at` unchanged, `last_nudged_at` still null.
  3. `curl -XPOST .../api/cc/resolve -H 'x-cc-secret: <s>' -d '{"session_id":"t1"}'` → `status=resolved`, `resolved_at` set.
  4. Missing/wrong secret → 401.
  5. Insert a pending row with `created_at = now() - interval '11 minutes'`, then `curl .../api/cc/check?secret=<s>` → one WhatsApp to Kevin, `nudged:1`, `last_nudged_at` set. Immediate re-run → `nudged:0` (15-min gate). Backdate `last_nudged_at` 16 min → next run nudges again.
  6. Backdate a pending row's `created_at` to `now() - interval '4 hours'` → `/api/cc/check` skips it (give-up).
  7. Live hook test: let a real prompt sit → after ~1 min a `Notification` fires → `cc-pending.sh` writes a row. Submit a prompt → `cc-resolve.sh` flips it to resolved. Trigger a permission prompt, approve it → `PreToolUse` resolves (no `UserPromptSubmit` needed).
- No `app/api/**/*.test.ts` (repo convention).

## 8. Build order

1. Migration (§2). Verify table.
2. `lib/cc/types.ts` + `lib/cc/checker.ts` + `lib/cc/checker.test.ts` (`composeHangNudge` TDD; `runCcCheck` written, verified manually later).
3. Endpoints (§4.1–4.4) + `proxy.ts` change. Verify with curl + SQL (§7 steps 2–6).
4. `/api/wa/cron` phase (§4.5). Verify a forced pending row nudges on a real cron tick.
5. Hook scripts + `cc-hangnudge.env` (§5.1–5.3). `chmod`. Manual curl of the script with a fake payload on stdin.
6. Register hooks in both settings.json via `update-config` skill (§5.4).
7. Live end-to-end (§7 step 7).

## 9. Files

**New:**
- `migrations/2026-08-28-cc-hang-nudge.sql`
- `lib/cc/types.ts`
- `lib/cc/checker.ts`
- `lib/cc/checker.test.ts`
- `app/api/cc/pending/route.ts`
- `app/api/cc/resolve/route.ts`
- `app/api/cc/check/route.ts`
- `~/.claude/hooks/cc-pending.sh`
- `~/.claude/hooks/cc-resolve.sh`
- `~/.claude/hooks/cc-hangnudge.env`

**Modified:**
- `app/api/wa/cron/route.ts` (new check phase)
- `proxy.ts` (public path)
- `~/.claude/settings.json` (hook registration, via update-config)
- `~/.claude-personal/settings.json` (hook registration, via update-config)

**Env:** none new — `/api/cc/*` reuse `CRON_SECRET` (already in Vercel + `.env.local`).
