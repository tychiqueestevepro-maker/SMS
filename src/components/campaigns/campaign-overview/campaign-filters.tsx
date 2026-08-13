"use client";

import React from "react";
import { Calendar, Filter } from "lucide-react";

type CampaignFiltersProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  counts: {
    all: number;
    active: number;
    drafts: number;
    archived: number;
  };
};

export function CampaignFilters({ activeTab, onTabChange, counts }: CampaignFiltersProps) {
  const tabs = [
    { id: "all", label: "All campaigns", count: counts.all },
    { id: "active", label: "Active", count: counts.active },
    { id: "drafts", label: "Drafts", count: counts.drafts },
    { id: "archived", label: "Archived", count: counts.archived },
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#E5E9E6] pb-1 sm:border-none sm:pb-0">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              className={`relative flex items-center gap-2 px-3 py-2 text-xs font-semibold transition-colors ${
                isActive ? "text-[#171A18]" : "text-[#66706A] hover:text-[#171A18]"
              }`}
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              type="button"
            >
              <span>{tab.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  isActive ? "bg-[#E9F5EE] text-[#07813F]" : "bg-[#F2F4F3] text-[#66706A]"
                }`}
              >
                {tab.count}
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#07813F]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs font-medium text-[#171A18] hover:bg-[#FBFCFB]"
          type="button"
        >
          <Calendar size={14} className="text-[#66706A]" />
          <span>All time</span>
        </button>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs font-medium text-[#171A18] hover:bg-[#FBFCFB]"
          type="button"
        >
          <Filter size={14} className="text-[#66706A]" />
          <span>Filters</span>
        </button>
      </div>
    </div>
  );
}
