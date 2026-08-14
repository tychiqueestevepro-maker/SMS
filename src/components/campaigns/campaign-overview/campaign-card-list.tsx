"use client";

import React, { useState } from "react";
import {
  Calendar,
  Clock,
  MoreHorizontal,
  Pause,
  Play,
  Rocket,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";

import {
  deleteCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from "@/app/(app)/campaigns/actions";
import { CampaignStatusBadge } from "@/components/campaigns/campaign-status";
import type { CampaignListItemDto } from "@/components/campaigns/types";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatRate(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, style: "percent" }).format(value);
}

function getIconForIndex(index: number) {
  const icons = [Sun, Calendar, User, Rocket];
  const colors = [
    "bg-[#FEF9C3] text-[#CA8A04]", // Sun yellow
    "bg-[#FDE8E8] text-[#E11D48]", // Calendar pink
    "bg-[#F1ECFF] text-[#6E44FF]", // User purple
    "bg-[#EAF3FF] text-[#0066FF]", // Rocket blue
  ];
  const IconComponent = icons[index % icons.length];
  const colorClass = colors[index % colors.length];
  return { colorClass, IconComponent };
}

export function CampaignCardList({ campaigns }: { campaigns: CampaignListItemDto[] }) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    campaignId: string;
    type: "delete" | "pause" | "resume";
  } | null>(null);

  const handlePauseResume = async (campaign: CampaignListItemDto) => {
    if (pendingAction) return;
    const type = campaign.status === "active" ? "pause" : "resume";
    setPendingAction({ campaignId: campaign.id, type });
    try {
      if (type === "pause") {
        await pauseCampaignAction(campaign.id);
      } else {
        await resumeCampaignAction(campaign.id);
      }
      setOpenMenuId(null);
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async (campaignId: string) => {
    if (pendingAction) return;
    setPendingAction({ campaignId, type: "delete" });
    try {
      await deleteCampaignAction(campaignId);
      setDeletingId(null);
    } finally {
      setPendingAction(null);
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-[#E5E9E6] bg-white p-8 text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-[#E9F5EE] text-[#07813F]">
          <Rocket size={20} />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-[#171A18]">No campaigns found</h3>
        <p className="mt-1 max-w-sm text-xs text-[#66706A]">
          Get started by creating a new message sequence for your contacts.
        </p>
        <Link
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-[#07813F] px-4 text-xs font-semibold text-white hover:opacity-90"
          href="/campaigns/new"
        >
          Create campaign
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {campaigns.map((campaign, idx) => {
        const { IconComponent, colorClass } = getIconForIndex(idx);
        const isActive = campaign.status === "active";
        const isDraft = campaign.status === "draft";
        const isPaused = campaign.status === "paused";
        const campaignPendingAction =
          pendingAction?.campaignId === campaign.id ? pendingAction.type : null;

        const dotColor = isActive
          ? "bg-[#07813F]"
          : isPaused
            ? "bg-[#B97913]"
            : "bg-[#949D97]";

        const replyRateVal = campaign.statistics.replyRate;

        return (
          <div
            className="group relative flex flex-col justify-between rounded-xl border border-[#E5E9E6] bg-white p-4 transition-all hover:border-[#D1D5D3] hover:shadow-sm md:flex-row md:items-center"
            key={campaign.id}
          >
            {/* Left section: status dot, icon, title, metadata */}
            <div className="flex items-center gap-3.5 md:w-1/3">
              <span className={`size-2.5 rounded-full ${dotColor} flex-shrink-0`} />

              <div className={`grid size-10 flex-shrink-0 place-items-center rounded-xl ${colorClass}`}>
                <IconComponent size={18} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    className="truncate text-sm font-semibold text-[#171A18] hover:text-[#07813F]"
                    href={`/campaigns/${campaign.id}`}
                  >
                    {campaign.name}
                  </Link>
                  <CampaignStatusBadge status={campaign.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-[#949D97]">
                  Updated {formatDate(campaign.updatedAt)}
                  {campaign.creatorName && ` • By ${campaign.creatorName}`}
                </p>
              </div>
            </div>

            {/* Middle section: Metrics */}
            <div className="mt-4 grid grid-cols-4 gap-4 border-t border-[#EEF0EE] pt-3 md:mt-0 md:w-5/12 md:border-none md:pt-0">
              <div>
                <span className="block text-[11px] font-medium text-[#949D97]">Recipients</span>
                <span className="mt-0.5 block text-xs font-semibold text-[#171A18]">
                  {campaign.recipientCount.toLocaleString("en-US")}
                </span>
              </div>
              <div>
                <span className="block text-[11px] font-medium text-[#949D97]">Replies</span>
                <span className="mt-0.5 block text-xs font-semibold text-[#171A18]">
                  {campaign.statistics.replies.toLocaleString("en-US")}
                </span>
              </div>
              <div>
                <span className="block text-[11px] font-medium text-[#949D97]">Reply rate</span>
                <span className="mt-0.5 block text-xs font-semibold text-[#171A18]">
                  {formatRate(replyRateVal)}
                </span>
                {!isDraft && (
                  <div className="mt-1 h-1 w-14 overflow-hidden rounded-full bg-[#EEF0EE]">
                    <div
                      className="h-full bg-[#07813F]"
                      style={{ width: `${Math.min(100, Math.round(replyRateVal * 100))}%` }}
                    />
                  </div>
                )}
              </div>
              <div>
                <span className="block text-[11px] font-medium text-[#949D97]">Sending</span>
                <span className="mt-0.5 block text-xs font-semibold text-[#171A18]">
                  {campaign.statistics.sentRecipients.toLocaleString("en-US")}
                </span>
              </div>
            </div>

            {/* Right section: Recent Activity & Actions */}
            <div className="mt-3 flex items-center justify-between border-t border-[#EEF0EE] pt-3 md:mt-0 md:w-2/12 md:justify-end md:gap-4 md:border-none md:pt-0">
              <div className="text-left md:text-right">
                <span className="block text-[11px] font-medium text-[#949D97]">Recent activity</span>
                <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-[#66706A]">
                  {isDraft ? (
                    <>
                      <Clock size={12} className="text-[#949D97]" />
                      <span>Not started yet</span>
                    </>
                  ) : (
                    <span>{campaign.recentActivity}</span>
                  )}
                </span>
              </div>

              {/* Action Dropdown Menu */}
              <div className="relative">
                <button
                  aria-label="Actions"
                  className="grid size-8 place-items-center rounded-lg text-[#949D97] hover:bg-[#F2F4F3] hover:text-[#171A18] disabled:cursor-not-allowed disabled:bg-[#F2F4F3] disabled:opacity-50"
                  disabled={Boolean(campaignPendingAction)}
                  onClick={() => setOpenMenuId(openMenuId === campaign.id ? null : campaign.id)}
                  type="button"
                >
                  <MoreHorizontal size={16} />
                </button>

                {openMenuId === campaign.id && (
                  <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-[#E5E9E6] bg-white p-1 shadow-lg animate-in fade-in zoom-in-95 duration-100">
                    <Link
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#171A18] hover:bg-[#FBFCFB]"
                      href={`/campaigns/${campaign.id}`}
                      onClick={() => setOpenMenuId(null)}
                    >
                      View details
                    </Link>

                    {isActive && (
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#B97913] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FFF4DE] disabled:cursor-not-allowed disabled:bg-[#F2F4F3] disabled:text-[#949D97]"
                        disabled={Boolean(campaignPendingAction)}
                        onClick={() => handlePauseResume(campaign)}
                        type="button"
                      >
                        <Pause size={14} />
                        {campaignPendingAction === "pause" ? "Pausing..." : "Pause campaign"}
                      </button>
                    )}

                    {isPaused && (
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#07813F] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#E9F5EE] disabled:cursor-not-allowed disabled:bg-[#F2F4F3] disabled:text-[#949D97]"
                        disabled={Boolean(campaignPendingAction)}
                        onClick={() => handlePauseResume(campaign)}
                        type="button"
                      >
                        <Play size={14} />
                        {campaignPendingAction === "resume" ? "Resuming..." : "Resume campaign"}
                      </button>
                    )}

                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#DA4545] hover:bg-[#FDECEC] disabled:cursor-not-allowed disabled:bg-[#F2F4F3] disabled:text-[#949D97]"
                      disabled={Boolean(campaignPendingAction)}
                      onClick={() => {
                        setDeletingId(campaign.id);
                        setOpenMenuId(null);
                      }}
                      type="button"
                    >
                      <Trash2 size={14} />
                      Delete campaign
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Delete Modal Confirmation */}
            {deletingId === campaign.id && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
                <div className="w-full max-w-sm rounded-2xl border border-[#E5E9E6] bg-white p-6 shadow-xl">
                  <h3 className="text-base font-semibold text-[#171A18]">Delete campaign?</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#66706A]">
                    Are you sure you want to delete <strong className="text-[#171A18]">{campaign.name}</strong>? This action cannot be undone and will stop all future messages.
                  </p>
                  <div className="mt-5 flex items-center justify-end gap-2.5">
                    <button
                      className="h-9 rounded-lg border border-[#E5E9E6] px-3.5 text-xs font-medium text-[#171A18] hover:bg-[#F2F4F3]"
                      disabled={campaignPendingAction === "delete"}
                      onClick={() => setDeletingId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="h-9 rounded-lg bg-[#DA4545] px-3 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[#949D97]"
                      disabled={campaignPendingAction === "delete"}
                      onClick={() => handleDelete(campaign.id)}
                      type="button"
                    >
                      {campaignPendingAction === "delete" ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
