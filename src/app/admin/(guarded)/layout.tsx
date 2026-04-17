import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#6B5F87]/20 bg-[#FAF4E8]/90 px-6 py-3 backdrop-blur-sm">
        <Link href="/admin" className="font-serif text-lg">
          Admin
        </Link>
        <form action="/api/admin/logout" method="POST">
          <button type="submit" className="text-sm text-[#6B5F87] hover:text-[#1A1033]">
            Sign out
          </button>
        </form>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  );
}
