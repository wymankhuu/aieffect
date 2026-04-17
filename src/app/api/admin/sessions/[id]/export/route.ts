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

  const dateOnly = new Date(session.created_at).toISOString().slice(0, 10);
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(toCsvRow(HEADER)));
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-effect-${session.room_code}-${dateOnly}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
