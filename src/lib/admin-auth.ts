import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "admin_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MAX_AGE_MS = MAX_AGE_SECONDS * 1000;

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET not set");
  return s;
}

function hmac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function signToken(issuedAt: number = Date.now()): string {
  const ts = String(issuedAt);
  return `${ts}.${hmac(ts)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(ts)) return false;
  const expected = hmac(ts);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const issuedAt = Number(ts);
  if (Date.now() - issuedAt > MAX_AGE_MS) return false;
  return true;
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
export const ADMIN_COOKIE_MAX_AGE = MAX_AGE_SECONDS;

/**
 * For use at the top of admin pages/layouts. Redirects to /admin/login if not
 * authenticated. Safe to call from server components.
 */
export async function requireAdminPage(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!verifyToken(token)) redirect("/admin/login");
}

/**
 * For use in route handlers. Returns null on success, a 401 Response on failure.
 */
export async function requireAdminRoute(): Promise<Response | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!verifyToken(token)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
