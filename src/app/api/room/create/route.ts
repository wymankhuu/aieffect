import { createRoom, roomExists } from "@/lib/game-store";

export async function POST(req: Request) {
  const { name, rounds } = await req.json();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  while (roomExists(code)) { code = ""; for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]; }

  const id = crypto.randomUUID();
  createRoom(code, { id, name: name || "Host", isFacilitator: true }, rounds || 10);
  return Response.json({ code, playerId: id });
}
