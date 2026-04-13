import { joinRoom, roomExists } from "@/lib/game-store";

export async function POST(req: Request) {
  const { code, name } = await req.json();
  const upper = (code || "").toUpperCase();
  if (!roomExists(upper)) return Response.json({ error: "Room not found" }, { status: 404 });

  const id = crypto.randomUUID();
  joinRoom(upper, { id, name: name || "Player", isFacilitator: false });
  return Response.json({ playerId: id });
}
