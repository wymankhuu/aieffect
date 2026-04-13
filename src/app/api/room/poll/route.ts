import { getRoom, checkAutoAdvance } from "@/lib/game-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.toUpperCase();
  if (!code) return Response.json({ error: "Missing code" }, { status: 400 });
  await checkAutoAdvance(code);
  const room = await getRoom(code);
  if (!room) return Response.json({ error: "Room not found" }, { status: 404 });
  return Response.json(room);
}
