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
