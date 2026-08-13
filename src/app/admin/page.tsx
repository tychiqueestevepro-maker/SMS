import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { AdminDashboard } from "@/app/admin/_components/admin-dashboard";
import { loadAdminDashboard } from "@/app/admin/data";
import { BrandMark } from "@/components/brand-mark";
import { requireAdminUser } from "@/lib/admin/authorization.server";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdminUser();
  const dashboard = await loadAdminDashboard(admin);

  return (
    <main className="min-h-screen bg-[#f4f6f5]">
      <header className="border-b border-[#dfe5e0] bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <BrandMark href="/admin" />
          <Link className="flex items-center gap-2 text-sm font-medium text-[#59675f] hover:text-[#26342b]" href="/campaigns">
            <ArrowLeft aria-hidden="true" size={16} />
            Back to workspace
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-[1600px] px-5 py-10 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#246b4a]">Riink internal</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-[#17211b]">Administration</h1>
        <p className="mt-2 text-sm text-[#68736c]">Operational controls, provider diagnostics, and billing reconciliation for Riink operators.</p>
        <p className="mt-1 text-xs text-[#8b958f]">Signed in as {admin.email}</p>

        <AdminDashboard data={dashboard} />
      </div>
    </main>
  );
}
