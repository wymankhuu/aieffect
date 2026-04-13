import { act } from "@/lib/game-store";

export async function POST(req: Request) {
  const { code, playerId, action } = await req.json();
  const err = act((code || "").toUpperCase(), playerId, action);
  if (err) return Response.json({ error: err }, { status: 400 });
  return Response.json({ ok: true });
}
