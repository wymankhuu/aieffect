import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Per-IP sliding-window limits. Numbers are sized for a generous workshop:
// up to ~50 players sharing one NAT (school/conference wifi) all polling.
//
// poll: 50 players * 40 polls/min * 1.5x burst = 3000/min ≈ 50/sec → 250/15s
// action: 50 players * 4 actions/min * 1.5x = 300/min → 50/15s
// create/join: rare per IP — strict limits to stop abuse
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const pollLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(250, "15 s"),
  prefix: "rl:poll",
  analytics: false,
});
const actionLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, "15 s"),
  prefix: "rl:action",
  analytics: false,
});
const createLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  prefix: "rl:create",
  analytics: false,
});
const joinLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(15, "60 s"),
  prefix: "rl:join",
  analytics: false,
});

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  let limiter: Ratelimit | null = null;
  if (path === "/api/room/poll") limiter = pollLimiter;
  else if (path === "/api/room/action") limiter = actionLimiter;
  else if (path === "/api/room/create") limiter = createLimiter;
  else if (path === "/api/room/join") limiter = joinLimiter;
  if (!limiter) return NextResponse.next();

  const ip = clientIp(req);
  const { success, limit, remaining, reset } = await limiter.limit(ip);
  if (success) {
    const res = NextResponse.next();
    res.headers.set("X-RateLimit-Limit", String(limit));
    res.headers.set("X-RateLimit-Remaining", String(remaining));
    return res;
  }
  return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": "0",
    },
  });
}

export const config = {
  matcher: ["/api/room/:path*"],
};
