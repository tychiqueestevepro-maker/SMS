"use client";

import React from "react";
import { CheckCircle2, Clock, MessageSquare, Send, Target, UserX } from "lucide-react";

type CampaignActiveKpisProps = {
  messagesSent: number;
  totalRecipients: number;
  repliesCount: number;
  replyRate: number;
  remainingCount: number;
  optedOutCount: number;
  completionPercent: number;
  estimatedCompletionDate: string | null;
};

export function CampaignActiveKpis({
  messagesSent,
  totalRecipients,
  repliesCount,
  replyRate,
  remainingCount,
  optedOutCount,
  completionPercent,
  estimatedCompletionDate,
}: CampaignActiveKpisProps) {
  const sentPercent = totalRecipients > 0 ? Math.round((messagesSent / totalRecipients) * 100) : 0;
  const remainingPercent = totalRecipients > 0 ? Math.round((remainingCount / totalRecipients) * 100) : 0;
  const optedOutPercent = totalRecipients > 0 ? ((optedOutCount / totalRecipients) * 100).toFixed(1) : "0";

  const formattedRate = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(replyRate);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {/* 1. Messages Sent */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E5E9E6] bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="grid size-9 place-items-center rounded-lg bg-[#E9F5EE] text-[#07813F]">
            <Send size={18} />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-xs font-medium text-[#66706A]">Messages sent</span>
          <div className="mt-1 text-2xl font-bold tracking-tight text-[#171A18]">
            {messagesSent}
          </div>
          <p className="mt-0.5 text-[11px] text-[#949D97]">
            {sentPercent}% of {totalRecipients}
          </p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#EEF0EE]">
            <div className="h-full bg-[#07813F]" style={{ width: `${sentPercent}%` }} />
          </div>
        </div>
      </div>

      {/* 2. Replies */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E5E9E6] bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="grid size-9 place-items-center rounded-lg bg-[#EAF3FF] text-[#0066FF]">
            <MessageSquare size={18} />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-xs font-medium text-[#66706A]">Replies</span>
          <div className="mt-1 text-2xl font-bold tracking-tight text-[#171A18]">
            {repliesCount}
          </div>
          <p className="mt-0.5 text-[11px] text-[#949D97]">All-time</p>
        </div>
      </div>

      {/* 3. Reply Rate */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E5E9E6] bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="grid size-9 place-items-center rounded-lg bg-[#FFF4DE] text-[#B97913]">
            <Target size={18} />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-xs font-medium text-[#66706A]">Reply rate</span>
          <div className="mt-1 text-2xl font-bold tracking-tight text-[#171A18]">
            {formattedRate}
          </div>
          <p className="mt-0.5 text-[11px] text-[#949D97]">All-time</p>
        </div>
      </div>

      {/* 4. Remaining */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E5E9E6] bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="grid size-9 place-items-center rounded-lg bg-[#EAF3FF] text-[#0066FF]">
            <Clock size={18} />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-xs font-medium text-[#66706A]">Remaining</span>
          <div className="mt-1 text-2xl font-bold tracking-tight text-[#171A18]">
            {remainingCount}
          </div>
          <p className="mt-0.5 text-[11px] text-[#949D97]">
            {remainingPercent}% of {totalRecipients}
          </p>
        </div>
      </div>

      {/* 5. Opted Out */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E5E9E6] bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="grid size-9 place-items-center rounded-lg bg-[#FDECEC] text-[#DA4545]">
            <UserX size={18} />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-xs font-medium text-[#66706A]">Opted out</span>
          <div className="mt-1 text-2xl font-bold tracking-tight text-[#171A18]">
            {optedOutCount}
          </div>
          <p className="mt-0.5 text-[11px] text-[#949D97]">{optedOutPercent}%</p>
        </div>
      </div>

      {/* 6. Completion */}
      <div className="flex flex-col justify-between rounded-xl border border-[#E5E9E6] bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="grid size-9 place-items-center rounded-lg bg-[#E9F5EE] text-[#07813F]">
            <CheckCircle2 size={18} />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-xs font-medium text-[#66706A]">Completion</span>
          <div className="mt-1 text-2xl font-bold tracking-tight text-[#171A18]">
            {completionPercent}%
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[#949D97]">
            {estimatedCompletionDate ? `Est. ${estimatedCompletionDate}` : "Completed"}
          </p>
        </div>
      </div>
    </div>
  );
}
