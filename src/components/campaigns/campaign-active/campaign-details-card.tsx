"use client";

import React from "react";
import {
  AlertTriangle,
  Calendar,
  Clock,
  Phone,
  Sliders,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

import { CountryFlagBadge, formatPhoneNumberDisplay } from "@/components/campaigns/phone-number-identity";

type CampaignDetailsCardProps = {
  sequenceName: string;
  fromNumber: string;
  fromCountryCode?: string | null;
  recipientsCount: number;
  sendingDays?: string;
  sendWindow?: string;
  dripInterval?: string;
  avgTimeToReply: string;
  bouncedCount: number;
  lastActivity: string;
  totalRecipients: number;
  totalAvailableNumbers?: number;
  onChangeNumberClick?: () => void;
};

export function CampaignDetailsCard({
  sequenceName,
  fromNumber,
  fromCountryCode = "US",
  recipientsCount,
  sendingDays,
  sendWindow = "09:00 – 18:00 (UTC)",
  dripInterval = "Every 2 minutes",
  avgTimeToReply,
  bouncedCount,
  lastActivity,
  totalRecipients,
  totalAvailableNumbers = 5,
  onChangeNumberClick,
}: CampaignDetailsCardProps) {
  const bouncedPct =
    totalRecipients > 0 ? ((bouncedCount / totalRecipients) * 100).toFixed(2) : "0";

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#EEF0EE] pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-[#171A18]">Campaign details</h2>
          <span className="rounded-full border border-[#C2E8D2] bg-[#E9F5EE] px-2 py-0.5 text-[10px] font-bold text-[#07813F]">
            Active
          </span>
        </div>
      </div>

      {/* Top Quick Stats Strip */}
      <div className="mt-3.5 grid grid-cols-3 gap-2 rounded-xl bg-[#FBFCFB] border border-[#EEF0EE] p-2.5 text-center">
        <div>
          <span className="block text-[10px] font-semibold text-[#949D97] uppercase">Total Recipients</span>
          <span className="text-xs font-bold text-[#171A18]">{totalRecipients}</span>
        </div>
        <div className="border-x border-[#EEF0EE]">
          <span className="block text-[10px] font-semibold text-[#949D97] uppercase">Active Threads</span>
          <span className="text-xs font-bold text-[#07813F]">{recipientsCount}</span>
        </div>
        <div>
          <span className="block text-[10px] font-semibold text-[#949D97] uppercase">Drip Pace</span>
          <span className="text-xs font-bold text-[#171A18]">2 min</span>
        </div>
      </div>

      {/* Main Grid Details */}
      <div className="mt-4 grid grid-cols-1 gap-y-3 sm:grid-cols-2 text-xs">
        {/* Left Column */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Workflow size={15} className="text-[#949D97]" />
            <span className="w-24 font-medium text-[#66706A]">Sequence</span>
            <span className="truncate font-semibold text-[#07813F]">{sequenceName}</span>
          </div>

          <div className="flex items-center gap-2">
            <Phone size={15} className="text-[#949D97]" />
            <span className="w-24 font-medium text-[#66706A]">From</span>
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="font-bold text-[#171A18]">{formatPhoneNumberDisplay(fromNumber)}</span>
              <CountryFlagBadge countryCode={fromCountryCode} />
              {totalAvailableNumbers > 1 && (
                <button
                  className="rounded-md border border-[#E5E9E6] bg-[#FBFCFB] px-1.5 py-0.5 text-[10px] font-semibold text-[#07813F] hover:bg-[#E9F5EE]"
                  onClick={onChangeNumberClick}
                  title="Switch sending number"
                  type="button"
                >
                  +{totalAvailableNumbers - 1} available
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Users size={15} className="text-[#949D97]" />
            <span className="w-24 font-medium text-[#66706A]">To</span>
            <span className="font-semibold text-[#171A18]">{recipientsCount} recipients</span>
          </div>


          {sendingDays && (
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-[#949D97]" />
              <span className="w-24 font-medium text-[#66706A]">Sending days</span>
              <span className="inline-flex items-center rounded-md border border-[#C2E8D2] bg-[#E9F5EE] px-2 py-0.5 text-[11px] font-semibold text-[#07813F]">
                {sendingDays}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Clock size={15} className="text-[#949D97]" />
            <span className="w-24 font-medium text-[#66706A]">Window</span>
            <span className="font-semibold text-[#171A18]">{sendWindow}</span>
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Sliders size={15} className="text-[#949D97]" />
            <span className="w-32 font-medium text-[#66706A]">Drip interval</span>
            <span className="font-semibold text-[#171A18]">{dripInterval}</span>
          </div>

          <div className="flex items-center gap-2">
            <Clock size={15} className="text-[#949D97]" />
            <span className="w-32 font-medium text-[#66706A]">Avg. time to reply</span>
            <span className="font-semibold text-[#171A18]">{avgTimeToReply}</span>
          </div>

          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-[#949D97]" />
            <span className="w-32 font-medium text-[#66706A]">Bounced / Failed</span>
            <span className="font-semibold text-[#171A18]">
              {bouncedCount} ({bouncedPct}%)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Zap size={15} className="text-[#949D97]" />
            <span className="w-32 font-medium text-[#66706A]">Last activity</span>
            <span className="font-semibold text-[#171A18]">{lastActivity}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
