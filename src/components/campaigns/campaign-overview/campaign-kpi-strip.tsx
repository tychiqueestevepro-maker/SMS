"use client";

import React from "react";
import { MessageSquare, Send, Target, Users, Zap } from "lucide-react";
import type { CampaignListItemDto } from "@/components/campaigns/types";

export function CampaignKpiStrip({ campaigns }: { campaigns: CampaignListItemDto[] }) {
  const activeCount = campaigns.filter((c) => c.status === "active").length;
  const totalRecipients = campaigns.reduce((acc, c) => acc + c.recipientCount, 0);
  const totalReplies = campaigns.reduce((acc, c) => acc + c.statistics.replies, 0);
  const totalSent = campaigns.reduce((acc, c) => acc + c.statistics.sentRecipients, 0);

  const avgReplyRate = totalSent > 0 ? (totalReplies / totalSent) : 0;
  const activePercent = campaigns.length > 0 ? Math.round((activeCount / campaigns.length) * 100) : 0;

  const kpis = [
    {
      icon: Zap,
      iconBg: "bg-[#E9F5EE] text-[#07813F]",
      label: "Active campaigns",
      subtext: `${activePercent}% of campaigns`,
      value: activeCount.toLocaleString("en-US"),
    },
    {
      icon: Users,
      iconBg: "bg-[#F1ECFF] text-[#6E44FF]",
      label: "Recipients",
      subtext: "Total across all",
      value: totalRecipients.toLocaleString("en-US"),
    },
    {
      icon: MessageSquare,
      iconBg: "bg-[#EAF3FF] text-[#0066FF]",
      label: "Replies",
      subtext: "All-time replies",
      value: totalReplies.toLocaleString("en-US"),
    },
    {
      icon: Target,
      iconBg: "bg-[#FFF4DE] text-[#B97913]",
      label: "Reply rate",
      subtext: "Average reply rate",
      value: new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, style: "percent" }).format(avgReplyRate),
    },
    {
      icon: Send,
      iconBg: "bg-[#FDECEC] text-[#DA4545]",
      label: "Sending",
      subtext: "Total sent",
      value: totalSent.toLocaleString("en-US"),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      {kpis.map((kpi, idx) => {
        const IconComponent = kpi.icon;
        return (
          <div
            className="flex flex-col justify-between rounded-xl border border-[#E5E9E6] bg-white p-4 transition-shadow hover:shadow-sm"
            key={idx}
          >
            <div className="flex items-center justify-between">
              <div className={`grid size-9 place-items-center rounded-lg ${kpi.iconBg}`}>
                <IconComponent size={18} />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-xs font-medium text-[#66706A]">{kpi.label}</span>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-[#171A18]">
                {kpi.value}
              </div>
              <div className="mt-1 flex items-center text-[11px] text-[#949D97]">
                <span>{kpi.subtext}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
