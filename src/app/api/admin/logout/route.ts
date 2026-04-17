import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export async function POST(req: Request) {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE_NAME);
  const url = new URL("/admin/login", req.url);
  return Response.redirect(url, 303);
}
