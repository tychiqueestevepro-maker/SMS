import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";

import { loadCampaignList } from "@/app/(app)/campaigns/data";
import { CampaignList } from "@/components/campaigns/campaign-list";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const campaigns = await loadCampaignList();

  return (
    <div className="flex w-full flex-col gap-6 p-4 sm:p-6">
      {/* Page Header matching Reference Screenshot 3 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#171A18]">Campaigns</h1>
          <p className="mt-1 text-xs text-[#66706A]">
            Create focused message sequences and keep an eye on every reply.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#07813F] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            href="/campaigns/new"
          >
            <Plus size={16} />
            <span>New campaign</span>
          </Link>
        </div>
      </div>

      {/* Main Campaign List */}
      <CampaignList campaigns={campaigns} />
    </div>
  );
}
