"use client";

import React from "react";
import { Calendar, Clock, Globe, Repeat, Workflow } from "lucide-react";

type CampaignMetaBarProps = {
  startedAt: string | null;
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  dripIntervalMinutes: number;
  sequenceName: string;
};

function formatDate(val: string | null) {
  if (!val) return "Not started";
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function CampaignMetaBar({
  startedAt,
  timezone,
  sendWindowStart,
  sendWindowEnd,
  dripIntervalMinutes,
  sequenceName,
}: CampaignMetaBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-y-2 text-xs text-[#66706A]">
      {/* Started */}
      <div className="flex items-center gap-1.5 pr-4">
        <Calendar size={14} className="text-[#949D97]" />
        <span>Started {formatDate(startedAt)}</span>
      </div>

      <span className="text-[#E5E9E6]">|</span>

      {/* Timezone */}
      <div className="flex items-center gap-1.5 px-4">
        <Globe size={14} className="text-[#949D97]" />
        <span>Time zone ({timezone})</span>
      </div>

      <span className="text-[#E5E9E6]">|</span>

      {/* Sending Hours */}
      <div className="flex items-center gap-1.5 px-4">
        <Clock size={14} className="text-[#949D97]" />
        <span>
          Sending hours {sendWindowStart.slice(0, 5)} – {sendWindowEnd.slice(0, 5)}
        </span>
      </div>

      <span className="text-[#E5E9E6]">|</span>

      {/* Drip interval */}
      <div className="flex items-center gap-1.5 px-4">
        <Repeat size={14} className="text-[#949D97]" />
        <span>Every {dripIntervalMinutes} minutes</span>
      </div>

      <span className="text-[#E5E9E6]">|</span>

      {/* Sequence */}
      <div className="flex items-center gap-1.5 pl-4 truncate">
        <Workflow size={14} className="text-[#949D97]" />
        <span className="truncate">Sequence {sequenceName}</span>
      </div>
    </div>
  );
}
