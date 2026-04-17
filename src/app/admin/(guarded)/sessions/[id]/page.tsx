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
          href={`/api/admin/sessions/${id}/export`}
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
