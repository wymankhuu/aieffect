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
 * into the SQL string — safe against injection. Returns rows directly.
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
