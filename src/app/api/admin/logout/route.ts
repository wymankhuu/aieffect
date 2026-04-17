import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export async function POST() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE_NAME);
  return Response.json({ ok: true });
}
