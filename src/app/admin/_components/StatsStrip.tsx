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
