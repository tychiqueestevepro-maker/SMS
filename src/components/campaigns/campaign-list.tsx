"use client";

import React, { useMemo, useState } from "react";

import { CampaignCardList } from "@/components/campaigns/campaign-overview/campaign-card-list";
import { CampaignFilters } from "@/components/campaigns/campaign-overview/campaign-filters";
import { CampaignKpiStrip } from "@/components/campaigns/campaign-overview/campaign-kpi-strip";
import type { CampaignListItemDto } from "@/components/campaigns/types";

export function CampaignList({ campaigns }: { campaigns: CampaignListItemDto[] }) {
  const [activeTab, setActiveTab] = useState<string>("all");

  const counts = useMemo(
    () => ({
      active: campaigns.filter((c) => c.status === "active").length,
      all: campaigns.length,
      archived: campaigns.filter((c) => c.status === "finished" || c.status === "paused").length,
      drafts: campaigns.filter((c) => c.status === "draft").length,
    }),
    [campaigns],
  );

  const filteredCampaigns = useMemo(() => {
    if (activeTab === "active") return campaigns.filter((c) => c.status === "active");
    if (activeTab === "drafts") return campaigns.filter((c) => c.status === "draft");
    if (activeTab === "archived")
      return campaigns.filter((c) => c.status === "finished" || c.status === "paused");
    return campaigns;
  }, [campaigns, activeTab]);

  return (
    <div className="flex flex-col gap-6">
      {/* KPI Cards Strip */}
      <CampaignKpiStrip campaigns={campaigns} />

      {/* Filter Tabs & Date/Actions bar */}
      <CampaignFilters activeTab={activeTab} counts={counts} onTabChange={setActiveTab} />

      {/* Campaign Card List */}
      <CampaignCardList campaigns={filteredCampaigns} />

      {/* Footer count indicator */}
      {filteredCampaigns.length > 0 && (
        <div className="mt-2 text-center text-xs text-[#949D97]">
          Showing {filteredCampaigns.length} of {campaigns.length} campaigns
        </div>
      )}
    </div>
  );
}
