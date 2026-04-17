# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-protected admin dashboard to The AI Effect that archives every completed round to Postgres, renders session-level and aggregate analytics, and exports data as CSV.

**Architecture:** Live game state stays in Upstash Redis (source of truth). After each round completes, `act()` in `game-store.ts` calls `archiveRound()` which writes to Vercel Postgres (Neon). The `/admin/*` tree reads from Postgres and is guarded by an HMAC-signed cookie set after password auth.

**Tech Stack:** Next.js 16.2.3 (modified — see `AGENTS.md`), React 19, TypeScript, Upstash Redis (existing), Postgres (Neon in production, vanilla in dev) via the `pg` driver, Vitest (new, for unit tests of pure helpers).

> **Note (2026-04-16):** The original spec called for `@neondatabase/serverless`, but its `neon()` function is HTTP-only (Neon's `/sql` endpoint) and cannot talk to a vanilla local Postgres. Switched to the standard `pg` driver, which speaks the wire protocol against any Postgres (Neon included) and runs fine in Vercel Node Functions. `db.ts` exports a tagged-template `sql` wrapper that keeps the call-site syntax (`` await sql`SELECT … ${id}` ``) identical to what `@neondatabase/serverless` provided, so tasks 6, 10, 11, 12 are unaffected at the query sites.

**Spec:** `docs/superpowers/specs/2026-04-16-admin-dashboard-design.md`

**Next.js caveat:** This repo uses a modified Next.js. Before writing route handlers, pages, or layouts, skim the relevant guide in `node_modules/next/dist/docs/` to confirm current APIs (especially around `cookies()`, streaming responses, `searchParams` typing, and route params).

---

## Task 0: Prerequisite — provision Neon Postgres and env vars

**Files:**
- Modify: `.env.local` (not committed)
- Create: `.env.local.example`

- [ ] **Step 1: Provision Neon Postgres via the Vercel Marketplace**

In the Vercel dashboard for this project: Storage → Create → Neon Postgres → "Connect". This adds `DATABASE_URL` and a few related vars to the Vercel env.

- [ ] **Step 2: Pull env vars locally**

```bash
cd /Users/wymankhuu/Desktop/Projects/the-ai-effect
npx vercel env pull .env.local
```

Expected: `.env.local` contains `DATABASE_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`.

- [ ] **Step 3: Add admin env vars**

Open `.env.local` and append:

```
ADMIN_PASSWORD=playtolearn
ADMIN_SESSION_SECRET=<paste output of: openssl rand -hex 32>
```

Also set these two in Vercel (Production + Preview + Development) via the dashboard.

- [ ] **Step 4: Create `.env.local.example` for documentation**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/.env.local.example`:

```
# Upstash Redis (provisioned via Vercel Marketplace)
KV_REST_API_URL=
KV_REST_API_TOKEN=

# Neon Postgres (provisioned via Vercel Marketplace)
DATABASE_URL=

# Admin dashboard
ADMIN_PASSWORD=playtolearn
ADMIN_SESSION_SECRET=   # openssl rand -hex 32
```

- [ ] **Step 5: Commit**

```bash
git add .env.local.example
git commit -m "Document env vars for admin dashboard"
```

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install Postgres driver**

```bash
cd /Users/wymankhuu/Desktop/Projects/the-ai-effect
npm install pg
```

Expected: `package.json` now contains `"pg"` under `dependencies`.

- [ ] **Step 2: Install Vitest, tsx, and pg types as devDependencies**

```bash
npm install -D vitest tsx @types/pg
```

`tsx` runs the migration script; `vitest` is for unit tests of pure helpers; `@types/pg` provides TypeScript types for the Postgres driver.

- [ ] **Step 3: Add scripts to package.json**

In the `scripts` block of `package.json`, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"migrate": "tsx scripts/migrate.ts"
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add pg driver, Vitest, and tsx for admin dashboard"
```

---

## Task 2: SQL migration + runner script

**Files:**
- Create: `migrations/001_init.sql`
- Create: `scripts/migrate.ts`

- [ ] **Step 1: Write the migration SQL**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/migrations/001_init.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code         text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  total_rounds      integer NOT NULL,
  rounds_completed  integer NOT NULL DEFAULT 0,
  facilitator_name  text,
  player_count      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_room_code_idx  ON sessions (room_code);

CREATE TABLE IF NOT EXISTS responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  round_number    integer NOT NULL,
  scenario_index  integer NOT NULL,
  scenario_text   text NOT NULL,
  player_id       text NOT NULL,
  player_name     text NOT NULL,
  initial_vote    text CHECK (initial_vote  IN ('erode','depends','support')),
  reason_text     text,
  revised_vote    text CHECK (revised_vote  IN ('erode','depends','support')),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, round_number, player_id)
);

CREATE INDEX IF NOT EXISTS responses_session_round_idx ON responses (session_id, round_number);
CREATE INDEX IF NOT EXISTS responses_scenario_idx      ON responses (scenario_index);
CREATE INDEX IF NOT EXISTS responses_recorded_at_idx   ON responses (recorded_at);
```

- [ ] **Step 2: Write the migration runner**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/scripts/migrate.ts`:

```ts
import { Client } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set. For prod, run `vercel env pull .env.local` first; for local dev, ensure your local Postgres URL is in .env.local.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  const dir = join(process.cwd(), "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    console.log(`Applying ${file}...`);
    const text = await readFile(join(dir, file), "utf8");
    // pg's Client.query handles multi-statement SQL natively when no params are passed.
    await client.query(text);
    console.log(`  ok`);
  }
  await client.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Load env and run the migration**

```bash
cd /Users/wymankhuu/Desktop/Projects/the-ai-effect
set -a && source .env.local && set +a && npm run migrate
```

Expected output:
```
Applying 001_init.sql...
  ok
Done.
```

- [ ] **Step 4: Verify tables exist**

For local dev (docker postgres on port 5434):

```bash
docker exec aieffect-postgres psql -U postgres -d aieffect -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

For prod (Neon), use the Neon dashboard SQL editor or `psql "$DATABASE_URL" -c "..."`.

Expected: output contains `sessions` and `responses`.

- [ ] **Step 5: Commit**

```bash
git add migrations/ scripts/
git commit -m "Add Postgres schema and migration runner for admin dashboard"
```

---

## Task 3: Postgres client helper (`src/lib/db.ts`)

**Files:**
- Create: `src/lib/db.ts`

- [ ] **Step 1: Create the helper**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/lib/db.ts`:

```ts
import { Pool, type QueryResultRow } from "pg";

if (!process.env.DATABASE_URL) {
  // Don't throw at module load — route handlers can still start up and report
  // a clean error. But log loudly so misconfiguration is visible.
  console.warn("DATABASE_URL is not set — Postgres features will fail.");
}

// Cache the pool across hot reloads in dev and across function invocations on
// Vercel (per-instance). One pool per Node process.
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}
const pool: Pool =
  globalThis.__pgPool ??
  (globalThis.__pgPool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "",
  }));

/**
 * Tagged-template SQL helper. Supports:
 *
 *   await sql`SELECT * FROM sessions WHERE id = ${id}`
 *
 * Interpolated values are sent as bind parameters ($1, $2, …), not concatenated
 * into the SQL string — safe against injection. Returns rows directly (matches
 * the API of `@neondatabase/serverless`'s `neon()` so call sites stay simple).
 *
 * For raw multi-statement SQL (migrations), use `sql.query(text)`.
 */
type SqlFn = {
  <T extends QueryResultRow = QueryResultRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
};

const sqlFn: SqlFn = (async <T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => {
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) text += `$${i + 1}`;
  }
  const result = await pool.query<T>(text, values);
  return result.rows;
}) as SqlFn;

sqlFn.query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> => {
  const result = await pool.query<T>(text, params);
  return result.rows;
};

export const sql = sqlFn;

export type SessionRow = {
  id: string;
  room_code: string;
  created_at: string;
  completed_at: string | null;
  total_rounds: number;
  rounds_completed: number;
  facilitator_name: string | null;
  player_count: number;
};

export type ResponseRow = {
  id: string;
  session_id: string;
  round_number: number;
  scenario_index: number;
  scenario_text: string;
  player_id: string;
  player_name: string;
  initial_vote: "erode" | "depends" | "support" | null;
  reason_text: string | null;
  revised_vote: "erode" | "depends" | "support" | null;
  recorded_at: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/db.ts
git commit -m "Add Postgres client helper with tagged-template sql"
```

---

## Task 4: CSV escape helpers (`src/lib/csv.ts`) — TDD

**Files:**
- Create: `src/lib/csv.ts`
- Create: `src/lib/csv.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create the Vitest config**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/lib/csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeField, toCsvRow } from "./csv";

describe("escapeField", () => {
  it("leaves plain values unquoted", () => {
    expect(escapeField("hello")).toBe("hello");
  });
  it("returns empty string for null or undefined", () => {
    expect(escapeField(null)).toBe("");
    expect(escapeField(undefined)).toBe("");
  });
  it("quotes values with commas", () => {
    expect(escapeField("a,b")).toBe('"a,b"');
  });
  it("quotes values with newlines", () => {
    expect(escapeField("line1\nline2")).toBe('"line1\nline2"');
  });
  it("quotes values with quotes and doubles internal quotes", () => {
    expect(escapeField('she said "hi"')).toBe('"she said ""hi"""');
  });
  it("converts booleans and numbers to strings", () => {
    expect(escapeField(true)).toBe("true");
    expect(escapeField(42)).toBe("42");
  });
});

describe("toCsvRow", () => {
  it("joins fields with commas and terminates with CRLF", () => {
    expect(toCsvRow(["a", "b", "c"])).toBe("a,b,c\r\n");
  });
  it("escapes each field correctly", () => {
    expect(toCsvRow(["a,b", 'he said "hi"', null])).toBe('"a,b","he said ""hi""",\r\n');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/wymankhuu/Desktop/Projects/the-ai-effect
npm test -- src/lib/csv.test.ts
```

Expected: FAIL with "Cannot find module './csv'" or similar.

- [ ] **Step 4: Implement the helpers**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/lib/csv.ts`:

```ts
export function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeField).join(",") + "\r\n";
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- src/lib/csv.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/lib/csv.ts src/lib/csv.test.ts
git commit -m "Add CSV escape helpers with Vitest tests"
```

---

## Task 5: Admin auth helpers (`src/lib/admin-auth.ts`) — TDD for HMAC

**Files:**
- Create: `src/lib/admin-auth.ts`
- Create: `src/lib/admin-auth.test.ts`

- [ ] **Step 1: Write failing tests for sign/verify**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/lib/admin-auth.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { signToken, verifyToken } from "./admin-auth";

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = "x".repeat(64);
});

describe("signToken / verifyToken", () => {
  it("round-trips a fresh token", () => {
    const token = signToken();
    expect(verifyToken(token)).toBe(true);
  });
  it("rejects a malformed token", () => {
    expect(verifyToken("nope")).toBe(false);
    expect(verifyToken("123.abc")).toBe(false);
    expect(verifyToken("")).toBe(false);
  });
  it("rejects a tampered token", () => {
    const token = signToken();
    const [ts, sig] = token.split(".");
    const tampered = `${Number(ts) + 1}.${sig}`;
    expect(verifyToken(tampered)).toBe(false);
  });
  it("rejects an expired token", () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const token = signToken(eightDaysAgo);
    expect(verifyToken(token)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/lib/admin-auth.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement sign/verify + requireAdmin**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/lib/admin-auth.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "admin_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MAX_AGE_MS = MAX_AGE_SECONDS * 1000;

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET not set");
  return s;
}

function hmac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function signToken(issuedAt: number = Date.now()): string {
  const ts = String(issuedAt);
  return `${ts}.${hmac(ts)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(ts)) return false;
  const expected = hmac(ts);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const issuedAt = Number(ts);
  if (Date.now() - issuedAt > MAX_AGE_MS) return false;
  return true;
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
export const ADMIN_COOKIE_MAX_AGE = MAX_AGE_SECONDS;

/**
 * For use at the top of admin pages/layouts. Redirects to /admin/login if not
 * authenticated. Safe to call from server components.
 */
export async function requireAdminPage(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!verifyToken(token)) redirect("/admin/login");
}

/**
 * For use in route handlers. Returns null on success, a 401 Response on failure.
 */
export async function requireAdminRoute(): Promise<Response | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!verifyToken(token)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/lib/admin-auth.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-auth.ts src/lib/admin-auth.test.ts
git commit -m "Add HMAC-signed admin session helpers"
```

---

## Task 6: Archive helpers (`src/lib/archive.ts`)

**Files:**
- Create: `src/lib/archive.ts`

- [ ] **Step 1: Implement the archive helpers**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/lib/archive.ts`:

```ts
import { sql } from "./db";
import scenarios from "@/data/scenarios.json";
import type { Room, Vote } from "./game-store";

export type RoundSnapshot = {
  cardIndex: number;
  votes: Record<string, Vote>;
  reasons: Record<string, { text: string; name: string }>;
  revisedVotes: Record<string, Vote>;
};

/**
 * Writes a completed round to Postgres. On first call for a room, also inserts
 * a `sessions` row and mutates `room.dbSessionId` so the caller must persist
 * the room afterwards. Idempotent under retry via the unique constraint.
 */
export async function archiveRound(room: Room, snapshot: RoundSnapshot): Promise<void> {
  if (!room.dbSessionId) {
    const facilitator = Object.values(room.players).find((p) => p.isFacilitator);
    const rows = await sql`
      INSERT INTO sessions (room_code, total_rounds, rounds_completed, facilitator_name, player_count)
      VALUES (${room.code}, ${room.totalRounds}, 0, ${facilitator?.name ?? null}, ${Object.keys(room.players).length})
      RETURNING id
    `;
    room.dbSessionId = (rows[0] as { id: string }).id;
  }

  const scenario = scenarios[snapshot.cardIndex];
  const scenarioText = (scenario as { text: string } | undefined)?.text ?? "";

  // Union of player ids that appear in this round's votes/reasons/revisedVotes
  const playerIds = new Set<string>([
    ...Object.keys(snapshot.votes),
    ...Object.keys(snapshot.reasons),
    ...Object.keys(snapshot.revisedVotes),
  ]);

  for (const playerId of playerIds) {
    const playerName =
      room.players[playerId]?.name ?? snapshot.reasons[playerId]?.name ?? "(unknown)";
    const initialVote = snapshot.votes[playerId] ?? null;
    const reasonText = snapshot.reasons[playerId]?.text ?? null;
    const revisedVote = snapshot.revisedVotes[playerId] ?? null;

    await sql`
      INSERT INTO responses (
        session_id, round_number, scenario_index, scenario_text,
        player_id, player_name, initial_vote, reason_text, revised_vote
      )
      VALUES (
        ${room.dbSessionId}, ${room.currentRound}, ${snapshot.cardIndex}, ${scenarioText},
        ${playerId}, ${playerName}, ${initialVote}, ${reasonText}, ${revisedVote}
      )
      ON CONFLICT (session_id, round_number, player_id) DO NOTHING
    `;
  }

  await sql`
    UPDATE sessions SET rounds_completed = ${room.roundHistory.length}
    WHERE id = ${room.dbSessionId}
  `;
}

export async function markSessionComplete(room: Room): Promise<void> {
  if (!room.dbSessionId) return;
  await sql`
    UPDATE sessions SET completed_at = now()
    WHERE id = ${room.dbSessionId} AND completed_at IS NULL
  `;
}
```

Note: `room.currentRound` at archive time equals the round that was just pushed. In `game-store.ts` we push to history *before* incrementing `currentRound`, so this is correct. Double-check this sequence when wiring it up (Task 7).

- [ ] **Step 2: Commit**

```bash
git add src/lib/archive.ts
git commit -m "Add archive helpers for writing rounds to Postgres"
```

---

## Task 7: Wire archive into `game-store.ts`

**Files:**
- Modify: `src/lib/game-store.ts`

- [ ] **Step 1: Add `dbSessionId` to the `Room` type**

Edit `src/lib/game-store.ts`. In the `Room` type definition (around line 24), add a new field after `version`:

```ts
export type Room = {
  // ...existing fields...
  version: number;
  dbSessionId: string | null;
};
```

- [ ] **Step 2: Initialize `dbSessionId` in `createRoomIfAbsent`**

In `createRoomIfAbsent` (around line 90), in the `room` object literal, add `dbSessionId: null,` alongside `version: 1,`:

```ts
const room: Room = {
  // ...existing fields...
  version: 1,
  dbSessionId: null,
};
```

- [ ] **Step 3: Import archive helpers**

At the top of `src/lib/game-store.ts`, after the existing imports:

```ts
import { archiveRound, markSessionComplete } from "./archive";
```

- [ ] **Step 4: Call `archiveRound` in the `next-round` case**

In the `next-round` case of the `act()` switch (around line 227), after `roundHistory.push(...)`, capture the just-pushed snapshot before resetting, and archive before the subsequent state transitions. The current case looks like:

```ts
case "next-round": {
  if (!player.isFacilitator) return "Not facilitator";
  room.roundHistory.push({
    cardIndex: room.currentCardIndex!,
    votes: { ...room.votes },
    reasons: { ...room.reasons },
    revisedVotes: { ...room.revisedVotes },
  });
  room.votes = {};
  // ...
}
```

Replace the existing `case "next-round"` block with:

```ts
case "next-round": {
  if (!player.isFacilitator) return "Not facilitator";
  const snapshot = {
    cardIndex: room.currentCardIndex!,
    votes: { ...room.votes },
    reasons: { ...room.reasons },
    revisedVotes: { ...room.revisedVotes },
  };
  room.roundHistory.push(snapshot);
  try {
    await archiveRound(room, snapshot);
  } catch (err) {
    console.error("archiveRound failed", err);
  }
  room.votes = {};
  room.reasons = {};
  room.revisedVotes = {};
  room.timerStartedAt = null;

  if (room.currentRound >= room.totalRounds) {
    room.phase = "summary";
    try {
      await markSessionComplete(room);
    } catch (err) {
      console.error("markSessionComplete failed", err);
    }
    break;
  }
  room.currentRound++;
  drawCard(room);
  room.phase = "draw";
  break;
}
```

- [ ] **Step 5: Call archive helpers in the `end-game` case**

Replace the existing `case "end-game"` block with:

```ts
case "end-game": {
  if (!player.isFacilitator) return "Not facilitator";
  if (room.currentCardIndex !== null && Object.keys(room.votes).length > 0) {
    const snapshot = {
      cardIndex: room.currentCardIndex,
      votes: { ...room.votes },
      reasons: { ...room.reasons },
      revisedVotes: { ...room.revisedVotes },
    };
    room.roundHistory.push(snapshot);
    try {
      await archiveRound(room, snapshot);
    } catch (err) {
      console.error("archiveRound failed", err);
    }
  }
  room.votes = {};
  room.reasons = {};
  room.revisedVotes = {};
  room.timerStartedAt = null;
  room.phase = "summary";
  try {
    await markSessionComplete(room);
  } catch (err) {
    console.error("markSessionComplete failed", err);
  }
  break;
}
```

- [ ] **Step 6: Lint + type-check**

```bash
cd /Users/wymankhuu/Desktop/Projects/the-ai-effect
npx tsc --noEmit
npm run lint
```

Expected: no errors.

- [ ] **Step 7: Manual smoke test**

```bash
npm run dev
```

- Open `http://localhost:3000`, create a room, join with a second browser/tab, play one full round, advance to the next round.
- In the Neon SQL editor, run `SELECT * FROM sessions; SELECT * FROM responses;` — confirm one `sessions` row and one `responses` row per voter.
- End the game; confirm `sessions.completed_at` is now non-null and `rounds_completed` matches the rounds played.

- [ ] **Step 8: Commit**

```bash
git add src/lib/game-store.ts
git commit -m "Archive completed rounds to Postgres via game-store hooks"
```

---

## Task 8: Login API + login page + logout API

**Files:**
- Create: `src/app/api/admin/login/route.ts`
- Create: `src/app/api/admin/logout/route.ts`
- Create: `src/app/admin/login/layout.tsx`
- Create: `src/app/admin/login/page.tsx`

Before writing any route handler, open `node_modules/next/dist/docs/app/api-reference/functions/cookies.md` (or the nearest equivalent) to confirm the current `cookies()` API shape and cookie `set`/`delete` options.

- [ ] **Step 1: Create the rate-limited login route**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/api/admin/login/route.ts`:

```ts
import { cookies, headers } from "next/headers";
import { Redis } from "@upstash/redis";
import { timingSafeEqual } from "node:crypto";
import { ADMIN_COOKIE_MAX_AGE, ADMIN_COOKIE_NAME, signToken } from "@/lib/admin-auth";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 300;

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: Request) {
  const ip = await clientIp();
  const key = `admin-login:${ip}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, WINDOW_SECONDS);
  if (attempts > MAX_ATTEMPTS) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const submitted = body.password ?? "";
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return Response.json({ error: "Server misconfigured" }, { status: 500 });

  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) return Response.json({ error: "Incorrect password" }, { status: 401 });

  await redis.del(key); // reset rate limit on success
  const jar = await cookies();
  jar.set(ADMIN_COOKIE_NAME, signToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Create the logout route**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/api/admin/logout/route.ts`:

```ts
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export async function POST() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE_NAME);
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Create an isolated layout for `/admin/login`**

The `/admin` layout (built in Task 9) enforces auth. `/admin/login` must not inherit that, so we give it its own segment layout that just renders children.

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/login/layout.tsx`:

```tsx
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

Also create (in the same task) `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/layout.tsx` in Task 9 — the `login` segment's own layout file overrides it, so login stays public.

- [ ] **Step 4: Create the login page**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/admin");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="font-serif text-2xl">Admin</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm">
          Password
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-[#6B5F87]/30 px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading || password.length === 0}
          className="rounded bg-[#1A1033] px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Smoke test**

```bash
npm run dev
```

- Visit `http://localhost:3000/admin/login`, submit wrong password — expect red error.
- Submit `playtolearn` — expect redirect to `/admin` (will 404 until Task 9). Check the browser DevTools → Application → Cookies: an `admin_session` cookie should be set with HttpOnly.
- Submit wrong password 6 times in a row — sixth attempt should return 429.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/ src/app/admin/login/
git commit -m "Add admin login/logout routes and login page"
```

---

## Task 9: Admin layout with auth guard

**Files:**
- Create: `src/app/admin/layout.tsx`

- [ ] **Step 1: Create the layout**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/layout.tsx`:

```tsx
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#6B5F87]/20 bg-[#FAF4E8]/90 px-6 py-3 backdrop-blur-sm">
        <Link href="/admin" className="font-serif text-lg">
          Admin
        </Link>
        <form action="/api/admin/logout" method="POST">
          <button type="submit" className="text-sm text-[#6B5F87] hover:text-[#1A1033]">
            Sign out
          </button>
        </form>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
```

Because Task 8 also created `src/app/admin/login/layout.tsx`, the login page keeps its own non-guarded layout and skips `requireAdminPage`.

Note: a `<form action="..." method="POST">` to `/api/admin/logout` triggers a full navigation. The route returns JSON; the browser will navigate to the endpoint and show the JSON body. To keep the UX clean, we'll convert the logout button to a client component that calls `fetch` and redirects:

Actually — simpler: change the logout API to `302 redirect` to `/admin/login` when it's called via a form POST. Replace `src/app/api/admin/logout/route.ts` with:

```ts
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export async function POST() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE_NAME);
  return Response.redirect(new URL("/admin/login", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"), 303);
}
```

Better: don't rely on an env var. Use the request URL:

```ts
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export async function POST(req: Request) {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE_NAME);
  const url = new URL("/admin/login", req.url);
  return Response.redirect(url, 303);
}
```

Apply that change to `src/app/api/admin/logout/route.ts`.

- [ ] **Step 2: Smoke test**

```bash
npm run dev
```

- Visit `/admin` without logging in — expect redirect to `/admin/login`.
- Log in — expect the admin shell with a "Sign out" button to render.
- Click "Sign out" — expect redirect back to `/admin/login`.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/layout.tsx src/app/api/admin/logout/route.ts
git commit -m "Add admin layout with auth guard and sign-out"
```

---

## Task 10: Sessions list + aggregate stats page

**Files:**
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/_components/StatsStrip.tsx`
- Create: `src/app/admin/_components/SessionsTable.tsx`
- Create: `src/app/admin/_components/Sparkline.tsx`

- [ ] **Step 1: Create the sparkline component**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/_components/Sparkline.tsx`:

```tsx
export function Sparkline({ points, width = 160, height = 40 }: { points: number[]; width?: number; height?: number }) {
  if (points.length === 0) return <svg width={width} height={height} />;
  const max = Math.max(1, ...points);
  const step = width / Math.max(1, points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${height - (p / max) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="text-[#1A1033]">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Create the stats strip**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/_components/StatsStrip.tsx`:

```tsx
import { sql } from "@/lib/db";
import { Sparkline } from "./Sparkline";

type Stats = {
  totalSessions: number;
  totalResponses: number;
  uniquePlayers: number;
  initialDist: { erode: number; depends: number; support: number };
  revisedDist: { erode: number; depends: number; support: number };
  shiftRate: number;
  topScenarios: { scenario_index: number; scenario_text: string; plays: number }[];
  dailyCounts: number[];
};

async function loadStats(fromIso: string | null, toIso: string | null): Promise<Stats> {
  // Normalise once and use plain parameters in each query. Keep the call sites
  // simple — no sub-template composition — so the SQL stays easy to read.
  const fromParam = fromIso ?? "1970-01-01";
  const toParam   = toIso   ?? "9999-01-01";

  const [totals] = (await sql`
    SELECT
      (SELECT COUNT(*) FROM sessions) AS total_sessions,
      (SELECT COUNT(*) FROM responses) AS total_responses,
      (SELECT COUNT(DISTINCT player_id) FROM responses) AS unique_players
  `) as unknown as { total_sessions: string; total_responses: string; unique_players: string }[];

  const dist = (await sql`
    SELECT initial_vote, revised_vote FROM responses
    WHERE recorded_at >= ${fromParam} AND recorded_at < ${toParam}
  `) as unknown as { initial_vote: string | null; revised_vote: string | null }[];

  const initialDist = { erode: 0, depends: 0, support: 0 };
  const revisedDist = { erode: 0, depends: 0, support: 0 };
  let shifts = 0, revisedTotal = 0;
  for (const r of dist) {
    if (r.initial_vote) (initialDist as Record<string, number>)[r.initial_vote]++;
    if (r.revised_vote) {
      (revisedDist as Record<string, number>)[r.revised_vote]++;
      revisedTotal++;
      if (r.initial_vote && r.revised_vote !== r.initial_vote) shifts++;
    }
  }
  const shiftRate = revisedTotal === 0 ? 0 : shifts / revisedTotal;

  const topScenarios = (await sql`
    SELECT scenario_index, MAX(scenario_text) AS scenario_text, COUNT(*) AS plays
    FROM responses
    WHERE recorded_at >= ${fromParam} AND recorded_at < ${toParam}
    GROUP BY scenario_index
    ORDER BY plays DESC
    LIMIT 5
  `) as unknown as { scenario_index: number; scenario_text: string; plays: string }[];

  const daily = (await sql`
    SELECT date_trunc('day', recorded_at) AS day, COUNT(*) AS c
    FROM responses
    WHERE recorded_at >= now() - interval '30 days'
    GROUP BY 1 ORDER BY 1
  `) as unknown as { day: string; c: string }[];

  const dailyCounts: number[] = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(today.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const match = daily.find((r) => r.day.slice(0, 10) === iso);
    dailyCounts.push(match ? Number(match.c) : 0);
  }

  return {
    totalSessions: Number(totals.total_sessions),
    totalResponses: Number(totals.total_responses),
    uniquePlayers: Number(totals.unique_players),
    initialDist,
    revisedDist,
    shiftRate,
    topScenarios: topScenarios.map((r) => ({
      scenario_index: r.scenario_index,
      scenario_text: r.scenario_text,
      plays: Number(r.plays),
    })),
    dailyCounts,
  };
}

function DistBar({ dist, label }: { dist: { erode: number; depends: number; support: number }; label: string }) {
  const total = dist.erode + dist.depends + dist.support;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-[#6B5F87]">{label}</span>
      <div className="flex h-3 w-full overflow-hidden rounded bg-[#6B5F87]/10">
        <div style={{ width: `${pct(dist.erode)}%` }} className="bg-red-400" />
        <div style={{ width: `${pct(dist.depends)}%` }} className="bg-amber-400" />
        <div style={{ width: `${pct(dist.support)}%` }} className="bg-emerald-500" />
      </div>
      <span className="text-[#6B5F87]">
        erode {Math.round(pct(dist.erode))}% · depends {Math.round(pct(dist.depends))}% · support {Math.round(pct(dist.support))}%
      </span>
    </div>
  );
}

export async function StatsStrip({ from, to }: { from: string | null; to: string | null }) {
  const stats = await loadStats(from, to);
  return (
    <section className="grid gap-6 rounded-lg border border-[#6B5F87]/20 bg-white p-6 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-[#6B5F87]">Totals</div>
        <div className="mt-2 text-2xl font-serif">{stats.totalSessions}</div>
        <div className="text-sm text-[#6B5F87]">sessions</div>
        <div className="mt-2 text-sm">{stats.totalResponses} responses · {stats.uniquePlayers} unique players</div>
      </div>
      <div className="flex flex-col gap-3">
        <DistBar dist={stats.initialDist} label="Initial votes" />
        <DistBar dist={stats.revisedDist} label="Revised votes" />
        <div className="text-sm">Vote shift rate: <strong>{Math.round(stats.shiftRate * 100)}%</strong></div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-[#6B5F87]">Responses, last 30 days</div>
        <Sparkline points={stats.dailyCounts} />
        <div className="mt-4 text-xs uppercase tracking-wide text-[#6B5F87]">Top scenarios</div>
        <ol className="mt-1 space-y-1 text-sm">
          {stats.topScenarios.map((s) => (
            <li key={s.scenario_index} className="line-clamp-1">
              <span className="text-[#6B5F87]">#{s.scenario_index}</span> · {s.scenario_text} — {s.plays}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create the sessions table**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/_components/SessionsTable.tsx`:

```tsx
import Link from "next/link";
import { sql, type SessionRow } from "@/lib/db";

const PAGE_SIZE = 50;

export async function SessionsTable({ page, from, to }: { page: number; from: string | null; to: string | null }) {
  const offset = (page - 1) * PAGE_SIZE;
  const fromParam = from ?? "1970-01-01";
  const toParam   = to   ?? "9999-01-01";

  const rows = (await sql`
    SELECT id, room_code, created_at, completed_at, total_rounds, rounds_completed, facilitator_name, player_count
    FROM sessions
    WHERE created_at >= ${fromParam} AND created_at < ${toParam}
    ORDER BY created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `) as unknown as SessionRow[];

  const [{ count }] = (await sql`
    SELECT COUNT(*)::int AS count FROM sessions
    WHERE created_at >= ${fromParam} AND created_at < ${toParam}
  `) as unknown as { count: number }[];

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <section className="rounded-lg border border-[#6B5F87]/20 bg-white">
      <div className="flex items-center justify-between border-b border-[#6B5F87]/20 px-4 py-3">
        <h2 className="font-serif text-lg">Sessions ({count})</h2>
        <a
          href={`/api/admin/export/all${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ""}`}
          className="rounded border border-[#1A1033] px-3 py-1 text-sm text-[#1A1033] hover:bg-[#1A1033] hover:text-white"
        >
          Download all responses (CSV)
        </a>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-[#6B5F87]">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Code</th>
            <th className="px-4 py-2">Facilitator</th>
            <th className="px-4 py-2">Players</th>
            <th className="px-4 py-2">Rounds</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[#6B5F87]/10">
              <td className="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
              <td className="px-4 py-2 font-mono">{r.room_code}</td>
              <td className="px-4 py-2">{r.facilitator_name ?? "—"}</td>
              <td className="px-4 py-2">{r.player_count}</td>
              <td className="px-4 py-2">{r.rounds_completed} / {r.total_rounds}</td>
              <td className="px-4 py-2">{r.completed_at ? "✓ complete" : "in progress"}</td>
              <td className="px-4 py-2">
                <Link href={`/admin/sessions/${r.id}`} className="mr-3 text-[#1A1033] underline">View</Link>
                <a href={`/api/admin/sessions/${r.id}/export`} className="text-[#1A1033] underline">CSV</a>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-[#6B5F87]">No sessions in this range.</td></tr>
          )}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[#6B5F87]/20 px-4 py-3 text-sm">
          <span>Page {page} / {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={`/admin?page=${page - 1}`} className="underline">Previous</Link>}
            {page < totalPages && <Link href={`/admin?page=${page + 1}`} className="underline">Next</Link>}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Create the admin page**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/page.tsx`:

```tsx
import { StatsStrip } from "./_components/StatsStrip";
import { SessionsTable } from "./_components/SessionsTable";

type SearchParams = Promise<{ page?: string; from?: string; to?: string }>;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));
  const from = params.from ?? null;
  const to = params.to ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <form className="flex flex-wrap items-end gap-3 text-sm" action="/admin" method="GET">
        <label className="flex flex-col gap-1">
          From
          <input type="date" name="from" defaultValue={from ?? ""} className="rounded border border-[#6B5F87]/30 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input type="date" name="to" defaultValue={to ?? ""} className="rounded border border-[#6B5F87]/30 px-2 py-1" />
        </label>
        <button type="submit" className="rounded bg-[#1A1033] px-3 py-1 text-white">Apply</button>
      </form>

      <StatsStrip from={from} to={to} />
      <SessionsTable page={page} from={from} to={to} />
    </div>
  );
}
```

Note on the `searchParams` type: Next.js 16's `searchParams` is async. If typechecking complains about the shape, consult `node_modules/next/dist/docs/app/api-reference/file-conventions/page.md` for the current signature and adjust.

- [ ] **Step 5: Smoke test**

```bash
npm run dev
```

- Log in, visit `/admin`.
- If you've played at least one round previously (Task 7 smoke), you should see the stats strip and at least one row in the sessions table.
- Try the date filter with a range that excludes today — sessions table should show "No sessions in this range."

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/page.tsx src/app/admin/_components/
git commit -m "Add admin sessions list and aggregate stats"
```

---

## Task 11: Session detail page

**Files:**
- Create: `src/app/admin/sessions/[id]/page.tsx`

- [ ] **Step 1: Create the page**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/admin/sessions/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { sql, type ResponseRow, type SessionRow } from "@/lib/db";

type Params = Promise<{ id: string }>;

const VOTES = ["erode", "depends", "support"] as const;
type Vote = (typeof VOTES)[number];

function VoteBars({ counts, label }: { counts: Record<Vote, number>; label: string }) {
  const total = VOTES.reduce((a, v) => a + counts[v], 0);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-[#6B5F87]">{label}</span>
      {VOTES.map((v) => (
        <div key={v} className="flex items-center gap-2">
          <span className="w-16">{v}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-[#6B5F87]/10">
            <div
              style={{ width: total === 0 ? 0 : `${(counts[v] / total) * 100}%` }}
              className={v === "erode" ? "h-full bg-red-400" : v === "depends" ? "h-full bg-amber-400" : "h-full bg-emerald-500"}
            />
          </div>
          <span className="w-6 text-right">{counts[v]}</span>
        </div>
      ))}
    </div>
  );
}

export default async function SessionDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const sessionRows = (await sql`
    SELECT id, room_code, created_at, completed_at, total_rounds, rounds_completed, facilitator_name, player_count
    FROM sessions WHERE id = ${id}
  `) as unknown as SessionRow[];
  const session = sessionRows[0];
  if (!session) notFound();

  const responses = (await sql`
    SELECT id, session_id, round_number, scenario_index, scenario_text,
           player_id, player_name, initial_vote, reason_text, revised_vote, recorded_at
    FROM responses WHERE session_id = ${id}
    ORDER BY round_number ASC, player_name ASC
  `) as unknown as ResponseRow[];

  const roundsMap = new Map<number, ResponseRow[]>();
  for (const r of responses) {
    if (!roundsMap.has(r.round_number)) roundsMap.set(r.round_number, []);
    roundsMap.get(r.round_number)!.push(r);
  }
  const rounds = Array.from(roundsMap.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#6B5F87]/20 bg-white p-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl">Room {session.room_code}</h1>
          <div className="text-sm text-[#6B5F87]">
            {new Date(session.created_at).toLocaleString()} · Facilitator: {session.facilitator_name ?? "—"} · {session.player_count} players · {session.rounds_completed}/{session.total_rounds} rounds · {session.completed_at ? "complete" : "in progress"}
          </div>
        </div>
        <a
          href={`/api/admin/sessions/${id}/export.csv`}
          className="rounded border border-[#1A1033] px-3 py-1 text-sm text-[#1A1033] hover:bg-[#1A1033] hover:text-white"
        >
          Download this session (CSV)
        </a>
      </header>

      {rounds.map(([roundNumber, rows]) => {
        const initialCounts: Record<Vote, number> = { erode: 0, depends: 0, support: 0 };
        const revisedCounts: Record<Vote, number> = { erode: 0, depends: 0, support: 0 };
        for (const r of rows) {
          if (r.initial_vote) initialCounts[r.initial_vote]++;
          if (r.revised_vote) revisedCounts[r.revised_vote]++;
        }
        const scenarioText = rows[0]?.scenario_text ?? "";
        return (
          <section key={roundNumber} className="rounded-lg border border-[#6B5F87]/20 bg-white p-6">
            <div className="flex items-baseline justify-between gap-6">
              <div>
                <div className="text-xs uppercase tracking-wide text-[#6B5F87]">Round {roundNumber}</div>
                <p className="mt-1 font-serif text-lg">{scenarioText}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <VoteBars counts={initialCounts} label="Initial votes" />
              <VoteBars counts={revisedCounts} label="Revised votes" />
            </div>
            <table className="mt-6 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[#6B5F87]">
                <tr>
                  <th className="px-2 py-2">Player</th>
                  <th className="px-2 py-2">Initial</th>
                  <th className="px-2 py-2">Reason</th>
                  <th className="px-2 py-2">Revised</th>
                  <th className="px-2 py-2">Shifted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#6B5F87]/10">
                    <td className="px-2 py-2">{r.player_name}</td>
                    <td className="px-2 py-2">{r.initial_vote ?? "—"}</td>
                    <td className="px-2 py-2 text-[#6B5F87]">{r.reason_text ?? "—"}</td>
                    <td className="px-2 py-2">{r.revised_vote ?? "—"}</td>
                    <td className="px-2 py-2">
                      {r.revised_vote && r.initial_vote && r.revised_vote !== r.initial_vote ? "✓" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {rounds.length === 0 && (
        <p className="text-sm text-[#6B5F87]">No rounds archived yet for this session.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Smoke test**

- Log in, from `/admin` click "View" on a session row.
- Verify each round's scenario text, vote bars, and player table renders.
- Click "Download this session (CSV)" — should 404 until Task 12, or render raw JSON from an error.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/sessions/
git commit -m "Add admin session detail page"
```

---

## Task 12: CSV export routes

**Files:**
- Create: `src/app/api/admin/export/all/route.ts`
- Create: `src/app/api/admin/sessions/[id]/export/route.ts`

**Important naming note:** Next.js route paths are based on directory segments. To serve `all.csv`, create a segment `all` with a `route.ts` and rely on the URL path matching `/api/admin/export/all` — but the file extension `.csv` cannot appear in the route segment name. Instead, we name the route `all/route.ts` and have the client hit `/api/admin/export/all.csv` by treating `.csv` as part of a catch-all segment, **or** we accept `/api/admin/export/all` and set the filename via `Content-Disposition`. Simplest and cleanest: use path `/api/admin/export/all` (no `.csv` in the URL), because the filename the browser saves is controlled by `Content-Disposition`, not by the URL. Update the links in Tasks 10 and 11 if you went with `.csv` in the URL:

- `SessionsTable.tsx`: change `/api/admin/export/all.csv` → `/api/admin/export/all`.
- `page.tsx` (session detail): change `/api/admin/sessions/${id}/export.csv` → `/api/admin/sessions/${id}/export`.

- [ ] **Step 1: Fix the links from Tasks 10 and 11**

Edit `src/app/admin/_components/SessionsTable.tsx` — change:
```tsx
href={`/api/admin/export/all.csv${from || to ? ...}
```
to:
```tsx
href={`/api/admin/export/all${from || to ? ...}
```

Edit `src/app/admin/sessions/[id]/page.tsx` — change both occurrences of `/api/admin/sessions/${id}/export.csv` (header and table row) to `/api/admin/sessions/${id}/export`.

- [ ] **Step 2: Create the "all" export route**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/api/admin/export/all/route.ts`:

```ts
import { requireAdminRoute } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { toCsvRow } from "@/lib/csv";

const HEADER = [
  "session_id", "room_code", "session_date", "facilitator",
  "round_number", "scenario_index", "scenario_text", "player_name",
  "initial_vote", "reason", "revised_vote", "shifted",
];

export async function GET(req: Request) {
  const unauthorized = await requireAdminRoute();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const rows = (await sql`
    SELECT
      s.id            AS session_id,
      s.room_code     AS room_code,
      s.created_at    AS session_date,
      s.facilitator_name AS facilitator,
      r.round_number  AS round_number,
      r.scenario_index AS scenario_index,
      r.scenario_text AS scenario_text,
      r.player_name   AS player_name,
      r.initial_vote  AS initial_vote,
      r.reason_text   AS reason,
      r.revised_vote  AS revised_vote
    FROM responses r
    JOIN sessions s ON s.id = r.session_id
    WHERE r.recorded_at >= ${from ?? "1970-01-01"}
      AND r.recorded_at <  ${to   ?? "9999-01-01"}
    ORDER BY r.recorded_at ASC
  `) as unknown as {
    session_id: string; room_code: string; session_date: string;
    facilitator: string | null; round_number: number;
    scenario_index: number; scenario_text: string; player_name: string;
    initial_vote: string | null; reason: string | null; revised_vote: string | null;
  }[];

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(toCsvRow(HEADER)));
      for (const r of rows) {
        const shifted = r.revised_vote && r.initial_vote && r.revised_vote !== r.initial_vote;
        const dateOnly = new Date(r.session_date).toISOString().slice(0, 10);
        controller.enqueue(enc.encode(toCsvRow([
          r.session_id, r.room_code, dateOnly, r.facilitator,
          r.round_number, r.scenario_index, r.scenario_text, r.player_name,
          r.initial_vote, r.reason, r.revised_vote, shifted ? "true" : "false",
        ])));
      }
      controller.close();
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-effect-responses-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 3: Create the per-session export route**

Create `/Users/wymankhuu/Desktop/Projects/the-ai-effect/src/app/api/admin/sessions/[id]/export/route.ts`:

```ts
import { requireAdminRoute } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { toCsvRow } from "@/lib/csv";

const HEADER = [
  "session_id", "room_code", "session_date", "facilitator",
  "round_number", "scenario_index", "scenario_text", "player_name",
  "initial_vote", "reason", "revised_vote", "shifted",
];

type Params = Promise<{ id: string }>;

export async function GET(_req: Request, ctx: { params: Params }) {
  const unauthorized = await requireAdminRoute();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;

  const sessionRows = (await sql`
    SELECT id, room_code, created_at, facilitator_name
    FROM sessions WHERE id = ${id}
  `) as unknown as { id: string; room_code: string; created_at: string; facilitator_name: string | null }[];
  const session = sessionRows[0];
  if (!session) return new Response("Not found", { status: 404 });

  const rows = (await sql`
    SELECT round_number, scenario_index, scenario_text, player_name,
           initial_vote, reason_text AS reason, revised_vote
    FROM responses WHERE session_id = ${id}
    ORDER BY round_number ASC, player_name ASC
  `) as unknown as {
    round_number: number; scenario_index: number; scenario_text: string;
    player_name: string; initial_vote: string | null;
    reason: string | null; revised_vote: string | null;
  }[];

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(toCsvRow(HEADER)));
      const dateOnly = new Date(session.created_at).toISOString().slice(0, 10);
      for (const r of rows) {
        const shifted = r.revised_vote && r.initial_vote && r.revised_vote !== r.initial_vote;
        controller.enqueue(enc.encode(toCsvRow([
          session.id, session.room_code, dateOnly, session.facilitator_name,
          r.round_number, r.scenario_index, r.scenario_text, r.player_name,
          r.initial_vote, r.reason, r.revised_vote, shifted ? "true" : "false",
        ])));
      }
      controller.close();
    },
  });

  const dateOnly = new Date(session.created_at).toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-effect-${session.room_code}-${dateOnly}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 4: Smoke test**

- Log in, click "Download all responses (CSV)" on `/admin` — browser should download `ai-effect-responses-YYYY-MM-DD.csv`.
- Open in a spreadsheet; verify the header row and that the data matches a session you just played. Spot-check that a reason containing a comma is properly quoted.
- On a session detail page, click "Download this session (CSV)" — file name should include the room code and session date.
- Hit `/api/admin/export/all` in an incognito window (not logged in) — expect `401 Unauthorized`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/export/ src/app/api/admin/sessions/ src/app/admin/_components/SessionsTable.tsx src/app/admin/sessions/[id]/page.tsx
git commit -m "Add CSV export routes for all responses and per-session"
```

---

## Task 13: End-to-end smoke test

**Files:** none — this is a manual verification task.

- [ ] **Step 1: Start fresh**

```bash
cd /Users/wymankhuu/Desktop/Projects/the-ai-effect
npm run dev
```

- [ ] **Step 2: Play a full game**

- Open two browser windows (one can be incognito). Create a room in one, join in the other.
- Set total rounds to 2.
- Play both rounds to completion — vote, give reasons, revise, advance.
- Click "End game" in the last round (or let it reach `summary` naturally).

- [ ] **Step 3: Verify Postgres**

Run these in the Neon SQL editor:
```sql
SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;
SELECT round_number, player_name, initial_vote, revised_vote
FROM responses ORDER BY recorded_at DESC LIMIT 20;
```

Expected: 1 `sessions` row for the game you just played, with `completed_at` non-null and `rounds_completed = 2`. 2 rounds × N players rows in `responses`.

- [ ] **Step 4: Verify dashboard**

- Visit `/admin` (log in if needed). The stats strip should reflect new totals.
- Click "View" on your session row. Verify each round's scenario, vote bars, and player rows.
- Download the per-session CSV. Open in a spreadsheet, confirm rows match what you saw in the UI.
- Download the "all" CSV. Confirm the header and at least the rows for this session.

- [ ] **Step 5: Verify auth**

- Incognito: visit `/admin` — expect redirect to `/admin/login`.
- Incognito: `curl -i http://localhost:3000/api/admin/export/all` — expect `HTTP/1.1 401`.
- Log out from `/admin` — expect redirect to login; subsequent `/admin` visit again redirects to login.

- [ ] **Step 6: Verify graceful DB failure**

Temporarily set `DATABASE_URL=postgresql://bad:bad@localhost:1/bad` in `.env.local` and restart dev. Play one round. Expect:
- The game continues working for players (no user-visible error).
- The dev console shows `archiveRound failed` log lines.

Restore the real `DATABASE_URL` after.

- [ ] **Step 7: Final commit (if anything moved)**

If Step 4-6 surfaced fixes, commit them. Otherwise, nothing to commit here.

---

## Summary of files

**New files:**
- `migrations/001_init.sql`
- `scripts/migrate.ts`
- `vitest.config.ts`
- `.env.local.example`
- `src/lib/db.ts`
- `src/lib/csv.ts` + `src/lib/csv.test.ts`
- `src/lib/admin-auth.ts` + `src/lib/admin-auth.test.ts`
- `src/lib/archive.ts`
- `src/app/api/admin/login/route.ts`
- `src/app/api/admin/logout/route.ts`
- `src/app/api/admin/export/all/route.ts`
- `src/app/api/admin/sessions/[id]/export/route.ts`
- `src/app/admin/layout.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/login/layout.tsx`
- `src/app/admin/login/page.tsx`
- `src/app/admin/sessions/[id]/page.tsx`
- `src/app/admin/_components/StatsStrip.tsx`
- `src/app/admin/_components/SessionsTable.tsx`
- `src/app/admin/_components/Sparkline.tsx`

**Modified files:**
- `package.json`, `package-lock.json` — new deps, scripts
- `src/lib/game-store.ts` — `dbSessionId` field, archive hooks
