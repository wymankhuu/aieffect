import { z } from "zod";
import { act } from "@/lib/game-store";

const Vote = z.enum(["erode", "depends", "support"]);
const Phase = z.enum(["lobby", "draw", "vote", "reason", "reveal", "reflect", "summary"]);

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("advance"), phase: Phase }),
  z.object({ type: z.literal("set-timer"), seconds: z.number().int().min(0).max(3600) }),
  z.object({ type: z.literal("start-timer") }),
  z.object({ type: z.literal("vote"), vote: Vote }),
  z.object({ type: z.literal("reason"), text: z.string().max(500).optional(), name: z.string().max(50).optional() }),
  z.object({ type: z.literal("revote"), vote: Vote }),
  z.object({ type: z.literal("next-round") }),
  z.object({ type: z.literal("end-game") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("skip-scenario") }),
  z.object({ type: z.literal("kick"), targetId: z.string().min(1).max(100) }),
  z.object({ type: z.literal("toggle-auto-advance") }),
]);

const RequestSchema = z.object({
  code: z.string().min(1).max(10),
  playerId: z.string().min(1).max(100),
  action: Action,
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }
  const { code, playerId, action } = parsed.data;
  const err = await act(code.toUpperCase(), playerId, action as { type: string } & Record<string, unknown>);
  if (err) return Response.json({ error: err }, { status: 400 });
  return Response.json({ ok: true });
}
