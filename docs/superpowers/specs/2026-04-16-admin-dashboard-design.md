# Admin Dashboard — Response Tracking & CSV Export

**Date:** 2026-04-16
**Status:** Approved — ready for implementation plan

## Goal

Add a password-protected admin dashboard to The AI Effect that durably captures every response (initial vote, reason, revised vote) across all games, surfaces session-level and aggregate analytics, and exports the data as CSV.

Today, room state lives in Upstash Redis with a 2-hour TTL. Once a room expires, all responses are gone. This work adds a durable archive plus a UI to view and export it.

## Non-goals

- No per-user accounts or role-based permissions — a single shared admin password is sufficient.
- No real-time dashboard updates — page loads are read-from-Postgres; refresh to see new data.
- No editing or deleting archived data from the UI.
- No aggregate-stats CSV export (scenarios-totals CSV). Can be derived from the "all responses" CSV in a spreadsheet.
- No raw-responses search UI (option D from brainstorming) — the CSV covers that need.

## Architecture overview

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│  Live game   │────▶│  Upstash Redis    │     │  Browser     │
│  (rooms)     │     │  (source of truth)│     │  (admin UI)  │
└──────────────┘     └───────────────────┘     └──────┬───────┘
       │                                              │
       │  archiveRound() after each round             │ /admin pages
       │  markSessionComplete() on end-game           │ & CSV routes
       ▼                                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Vercel Postgres (Neon)                                      │
│  - sessions                                                  │
│  - responses                                                 │
└──────────────────────────────────────────────────────────────┘
```

- Redis stays authoritative during the live game.
- Postgres is the durable archive. It is **write-only from the game engine** and **read-only from the admin UI**.
- A failed archive write logs an error but does not affect the live game.

## Data model

### `sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, generated server-side |
| `room_code` | `text` | 4-letter code used by players (not unique — codes are reused over time) |
| `created_at` | `timestamptz` | Set when the first round is archived |
| `completed_at` | `timestamptz` | Nullable; set on `end-game` or reaching `summary` |
| `total_rounds` | `int` | From the room config at archive time |
| `rounds_completed` | `int` | Updated on each round write |
| `facilitator_name` | `text` | The player name of the facilitator at first archive |
| `player_count` | `int` | Number of players in the room at first archive |

Indexes: `created_at DESC`, `room_code`.

### `responses`

One row per player per round.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `session_id` | `uuid` | FK → `sessions.id`, `ON DELETE CASCADE` |
| `round_number` | `int` | 1-based |
| `scenario_index` | `int` | Index into `scenarios.json` at time of play |
| `scenario_text` | `text` | Denormalized — preserves export accuracy if `scenarios.json` changes later |
| `player_id` | `text` | The generated player id from the room |
| `player_name` | `text` | Captured at archive time |
| `initial_vote` | `text` | Nullable. One of `erode` / `depends` / `support` |
| `reason_text` | `text` | Nullable |
| `revised_vote` | `text` | Nullable. One of `erode` / `depends` / `support` |
| `recorded_at` | `timestamptz` | Set at archive time |

Constraints:
- `UNIQUE (session_id, round_number, player_id)` — makes archive writes idempotent under retry.
- `CHECK (initial_vote IN ('erode','depends','support') OR initial_vote IS NULL)`; same for `revised_vote`.

Indexes: `(session_id, round_number)`, `scenario_index`, `recorded_at`.

### Migration

One SQL file at `migrations/001_init.sql` containing the `CREATE TABLE` / index statements. Applied manually on first deploy via a small `npm run migrate` script (a ~10-line Node file that reads the SQL and executes it through the Neon driver). Good enough for an app this size.

## Write path (archive)

Add a field to the `Room` type in `src/lib/game-store.ts`:

```ts
dbSessionId: string | null;
```

Initialize to `null` in `createRoomIfAbsent`.

Create `src/lib/archive.ts`:

```ts
archiveRound(room: Room, snapshot: RoundSnapshot): Promise<void>
markSessionComplete(room: Room): Promise<void>
```

`archiveRound`:
1. If `room.dbSessionId` is `null`: `INSERT INTO sessions` and set `room.dbSessionId` to the returned id. Fields come from `room` (room code, totals, facilitator name from `players` where `isFacilitator`, player count).
2. For each player represented in the round's `votes`, `reasons`, or `revisedVotes` (union of keys): `INSERT INTO responses ... ON CONFLICT (session_id, round_number, player_id) DO NOTHING`. `player_name` falls back to `reasons[playerId].name` if the player has since been kicked (matches existing display behavior).
3. `UPDATE sessions SET rounds_completed = $1 WHERE id = $2`.

`markSessionComplete`: `UPDATE sessions SET completed_at = now() WHERE id = $1 AND completed_at IS NULL`.

Hook into `act()` in `game-store.ts`. Archive calls must run **before** the final `saveRoom(room)` so that any mutation to `room.dbSessionId` is persisted in the same save.
- **`next-round` case:** after `roundHistory.push(...)` and the state resets, but **before** `saveRoom(room)` at the end of `act()`, call `archiveRound(room, snapshot)`. Wrap in `try/catch`; on error, `console.error(...)` and continue — the game action must still succeed.
- **`end-game` case:** same — call `archiveRound(room, snapshot)` (if a round's worth of data was pushed to history) and `markSessionComplete(room)` before the final `saveRoom(room)`.

Because `saveRoom` is called once at the end of `act()`, this places archive writes inside the per-room Redis lock. That is fine — writes are small and ordered per-room — but if latency becomes noticeable we can move archive writes out of the lock (the unique constraint keeps them safe) and persist `dbSessionId` separately.

### Reliability note

- Redis is the source of truth. Postgres is best-effort archive.
- A dropped DB write means that round is missing from analytics. The live game is unaffected.
- Unique constraint means retries are safe.
- If the Neon connection is down entirely, errors are logged and the dashboard simply shows stale data until writes recover.

## Admin auth

- Env vars:
  - `ADMIN_PASSWORD=playtolearn` (rotatable without code change)
  - `ADMIN_SESSION_SECRET` — random 32-byte hex string for signing cookies
- Login page `/admin/login` — password field only.
- Login route `POST /api/admin/login`:
  - Rate limit: 5 attempts per IP per 5 minutes, tracked in Redis with a key like `admin-login:<ip>`.
  - Compares submitted password to `ADMIN_PASSWORD` using `crypto.timingSafeEqual`.
  - On success: set an HMAC-signed cookie `admin_session` = `<issuedAt>.<hex-hmac>`. `httpOnly`, `secure`, `sameSite=lax`, `max-age=7d`.
  - On failure: 401, generic "incorrect password".
- Logout route `POST /api/admin/logout`: clears the cookie.
- Helper `requireAdmin()` in `src/lib/admin-auth.ts`:
  - Reads the cookie, verifies the HMAC, checks that `issuedAt` is within 7 days.
  - In page components: returns `{ ok: true }` or redirects to `/admin/login`.
  - In API routes: returns `{ ok: true }` or a 401 `Response`.
- Called at the top of every admin page and admin API route. Using this helper (instead of Next middleware) keeps the logic colocated with the routes and sidesteps edge-runtime cookie quirks.

## Dashboard pages

All admin pages live under `src/app/admin/*` and reuse `src/components/ui/*` primitives for visual consistency.

### `/admin/login`

Single password input, submit button, error message area. Redirects to `/admin` on success.

### `/admin` — Sessions list + aggregate stats

**Top strip — aggregate stats** (computed in SQL on each page load):
- Total sessions, total responses, total unique players (`COUNT(DISTINCT player_id)`).
- Overall vote distribution (percentages): a small stacked bar showing initial vs revised for `erode` / `depends` / `support`.
- Average vote-shift rate: `COUNT(*) FILTER (WHERE revised_vote IS NOT NULL AND revised_vote <> initial_vote) / COUNT(*) FILTER (WHERE revised_vote IS NOT NULL)`.
- Top 5 most-played scenarios by `scenario_index`, rendered as `"<truncated scenario text>" — N plays`.
- Responses over time: last 30 days, counts per day, rendered as a simple inline SVG sparkline.

**Below — sessions table:**
- Columns: Date, Room code, Facilitator, Players, Rounds (`rounds_completed` / `total_rounds`), Status (✓ complete / "in progress"), Actions (View, Download CSV).
- Sort: default `created_at DESC`. Clickable date header for asc/desc.
- Pagination: 50 per page via offset/limit.
- Filter: single "date range" control (from / to dates). Applies to both the sessions table and the aggregate stats strip.
- "Download all responses (CSV)" button at the top of the table.

### `/admin/sessions/[id]` — Session detail

Header block: room code, date, facilitator, player count, rounds completed / total, status badge.

For each round played (ordered by `round_number`):
- Scenario text.
- Two small horizontal bar charts side-by-side: "Initial votes" and "Revised votes" (erode / depends / support counts).
- Player table:
  - Columns: Name, Initial vote, Reason, Revised vote, Shifted (✓ if revised differs from initial).
  - Rows color-coded subtly by vote type.

"Download this session (CSV)" button at the top.

### Layout

`src/app/admin/layout.tsx` provides a thin top bar (title, logout button). Calls `requireAdmin()` in the layout's server component so every nested page is protected — except `/admin/login`, which lives under its own isolated layout to avoid the auth check.

## CSV export

Two routes, same column schema:

- `GET /api/admin/export/all.csv` — every response across all sessions, ordered by `recorded_at`.
- `GET /api/admin/sessions/[id]/export.csv` — one session.

Both behind `requireAdmin()`.

**Columns** (header row identical for both):

```
session_id,room_code,session_date,facilitator,round_number,scenario_index,scenario_text,player_name,initial_vote,reason,revised_vote,shifted
```

- `session_date` — `sessions.created_at` as ISO 8601 date (`YYYY-MM-DD`).
- `shifted` — `true` when `revised_vote IS NOT NULL AND revised_vote <> initial_vote`, else `false`.
- All text fields escaped per RFC 4180: wrap in double quotes if the value contains `,`, `"`, or newline; double any internal `"`.

**Response:**
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="ai-effect-responses-YYYY-MM-DD.csv"` for the all-export, or `"ai-effect-<room_code>-<YYYY-MM-DD>.csv"` for a single session.
- Streams rows using a `ReadableStream` so large exports don't buffer the whole result in memory. The SQL query uses the Neon driver's cursor/chunked read if the result is large; otherwise streams row-by-row from an array.

## File layout

New files:

```
migrations/
  001_init.sql                    # sessions + responses schema
scripts/
  migrate.ts                      # tiny runner for the SQL file
src/
  lib/
    db.ts                         # Neon client + query helpers
    archive.ts                    # archiveRound, markSessionComplete
    admin-auth.ts                 # signCookie, verifyCookie, requireAdmin
    csv.ts                        # escapeField, streamCsv helpers
  app/
    admin/
      layout.tsx                  # auth-protected top bar
      page.tsx                    # sessions list + stats
      sessions/
        [id]/
          page.tsx                # session detail
      login/
        layout.tsx                # unprotected
        page.tsx                  # password form
    api/
      admin/
        login/route.ts            # POST login (with rate limit)
        logout/route.ts           # POST logout
        export/
          all/route.ts            # GET all.csv
        sessions/
          [id]/
            export/route.ts       # GET per-session CSV
```

Modified files:

```
src/lib/game-store.ts             # add dbSessionId to Room; call archive hooks
package.json                      # add @neondatabase/serverless, migrate script
.env.local.example                # document ADMIN_PASSWORD, ADMIN_SESSION_SECRET,
                                  # DATABASE_URL (Neon)
```

## Dependencies to add

- `@neondatabase/serverless` — Postgres driver suitable for Vercel Functions.

All other needs (crypto, cookies, streams) are standard library.

## Testing

- **Unit:** CSV escaping (`csv.ts`), HMAC sign/verify (`admin-auth.ts`).
- **Integration:**
  - `archiveRound` inserts a session on first call, reuses it on second, is idempotent on retry.
  - `markSessionComplete` is idempotent and only sets `completed_at` once.
  - Login route enforces rate limit (5 attempts per IP).
  - Export routes return the correct `Content-Disposition` and well-formed CSV.
- **Manual smoke test after deploy:**
  - Run through a full game.
  - Log into `/admin`, confirm the session appears with correct counts.
  - Open the session detail, verify each round's votes and reasons.
  - Download both CSVs, open in a spreadsheet, spot-check a few rows against the UI.

## Open questions / assumptions

- **Next.js-in-this-repo caveats:** `AGENTS.md` says this repo uses a modified Next.js. Before writing route handlers, page components, or middleware, read the relevant guides under `node_modules/next/dist/docs/` to confirm current APIs (especially around cookies, streaming responses, and the `app/` directory conventions).
- **Neon project:** assumes a Neon Postgres database is provisioned via the Vercel Marketplace and `DATABASE_URL` is set in Vercel env. If not yet provisioned, that is the first step of implementation.
- **Scenario edits:** `scenario_text` is denormalized into `responses` at archive time, so future edits to `scenarios.json` will not retroactively change exported data. The dashboard always shows the text as it was played.
