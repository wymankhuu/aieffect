import { subscribe, removePlayer } from "@/lib/game-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.toUpperCase();
  const playerId = url.searchParams.get("playerId");
  if (!code || !playerId) return new Response("Missing params", { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const unsub = subscribe(code, (room) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(room)}\n\n`)); }
        catch { unsub(); }
      });
      req.signal.addEventListener("abort", () => { unsub(); removePlayer(code, playerId); });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
