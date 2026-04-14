import { z } from "zod";
import { joinRoom, roomExists } from "@/lib/game-store";

const JoinSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().trim().min(1).max(50).default("Player"),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = JoinSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const { code, name } = parsed.data;
  const upper = code.toUpperCase();
  if (!(await roomExists(upper))) return Response.json({ error: "Room not found" }, { status: 404 });

  const id = crypto.randomUUID();
  const ok = await joinRoom(upper, { id, name, isFacilitator: false });
  if (!ok) return Response.json({ error: "Room not found" }, { status: 404 });
  return Response.json({ playerId: id });
}
