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
    WHERE r.recorded_at >= ${from || "1970-01-01"}
      AND r.recorded_at <  ${to   || "9999-01-01"}
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
