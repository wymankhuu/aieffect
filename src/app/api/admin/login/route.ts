import { cookies, headers } from "next/headers";
import { Redis } from "@upstash/redis";
import { timingSafeEqual } from "node:crypto";
import { ADMIN_COOKIE_MAX_AGE, ADMIN_COOKIE_NAME, signToken } from "@/lib/admin-auth";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 300;

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: Request) {
  const ip = await clientIp();
  const key = `admin-login:${ip}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, WINDOW_SECONDS);
  if (attempts > MAX_ATTEMPTS) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const submitted = body.password ?? "";
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return Response.json({ error: "Server misconfigured" }, { status: 500 });

  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) return Response.json({ error: "Incorrect password" }, { status: 401 });

  await redis.del(key); // reset rate limit on success
  const jar = await cookies();
  jar.set(ADMIN_COOKIE_NAME, signToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return Response.json({ ok: true });
}
