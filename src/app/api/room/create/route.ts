import { z } from "zod";
import { createRoomIfAbsent } from "@/lib/game-store";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(50).default("Host"),
  rounds: z.number().int().min(1).max(50).default(10),
});

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_COLLISION_RETRIES = 10;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const { name, rounds } = parsed.data;
  const id = crypto.randomUUID();
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const code = randomCode();
    const room = await createRoomIfAbsent(code, { id, name, isFacilitator: true }, rounds);
    if (room) return Response.json({ code, playerId: id });
  }
  return Response.json({ error: "Could not allocate room code" }, { status: 503 });
}
