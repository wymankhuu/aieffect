import { StatsStrip } from "./_components/StatsStrip";
import { SessionsTable } from "./_components/SessionsTable";

type SearchParams = Promise<{ page?: string; from?: string; to?: string }>;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));
  // Treat empty strings (from blank inputs) as null, not as a value.
  const from = params.from || null;
  const to = params.to || null;

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
