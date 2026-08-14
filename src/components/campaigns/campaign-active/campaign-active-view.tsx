"use client";

import React, { useState } from "react";
import {
  ArrowLeft,
  BarChart2,
  MessageSquare,
  Pause,
  Play,
  Rocket,
  Send,
  Settings,
  Trash2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  deleteCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  saveCampaignDraftAction,
} from "@/app/(app)/campaigns/actions";
import { CampaignActiveKpis } from "@/components/campaigns/campaign-active/campaign-active-kpis";
import { CampaignActivityChart } from "@/components/campaigns/campaign-active/campaign-activity-chart";
import { CampaignActiveSequenceCard } from "@/components/campaigns/campaign-active/campaign-active-sequence-card";
import { CampaignDetailsCard } from "@/components/campaigns/campaign-active/campaign-details-card";
import { CampaignMetaBar } from "@/components/campaigns/campaign-active/campaign-meta-bar";
import { CampaignResponsesInbox } from "@/components/campaigns/campaign-active/campaign-responses-inbox";
import { CampaignSettingsTab } from "@/components/campaigns/campaign-active/campaign-settings-tab";
import { CampaignTestSendDialog } from "@/components/campaigns/campaign-test-send-dialog";
import { SendingNumberModal } from "@/components/campaigns/sending-number-modal";
import { CampaignStatusBadge } from "@/components/campaigns/campaign-status";
import type { CampaignEditorDto } from "@/components/campaigns/types";

type ViewTab = "overview" | "sequence" | "responses" | "settings";

export function CampaignActiveView({ initialData }: { initialData: CampaignEditorDto }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ViewTab>("overview");
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeAction, setActiveAction] = useState<"delete" | "pause" | "resume" | null>(null);
  const [isNumberModalOpen, setIsNumberModalOpen] = useState(false);
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);

  const monitoring = initialData.activeMonitoring;

  const handlePauseResume = async () => {
    if (!initialData.id || activeAction) return;
    const action = initialData.status === "active" ? "pause" : "resume";
    setActiveAction(action);
    try {
      if (action === "pause") {
        await pauseCampaignAction(initialData.id);
      } else {
        await resumeCampaignAction(initialData.id);
      }
      router.refresh();
    } finally {
      setActiveAction(null);
    }
  };

  const handleDelete = async () => {
    if (!initialData.id || activeAction) return;
    setActiveAction("delete");
    try {
      await deleteCampaignAction(initialData.id);
      router.push("/campaigns");
    } finally {
      setActiveAction(null);
    }
  };

  const handleSelectNumber = async (newNumberId: string) => {
    if (!initialData.id) return;
    await saveCampaignDraftAction({
      campaignId: initialData.id,
      contactIds: initialData.selectedContactIds,
      dripIntervalMinutes: initialData.dripIntervalMinutes || 2,
      name: initialData.name,
      phoneNumberId: newNumberId,
      sendWindowEnd: initialData.sendWindowEnd || "18:00:00",
      sendWindowStart: initialData.sendWindowStart || "09:00:00",
      sendingDays: initialData.sendingDays || [1, 2, 3, 4, 5],
      steps: initialData.steps,
      timezone: initialData.timezone || "UTC",
    });
    router.refresh();
  };

  if (!monitoring) {
    return (
      <div className="flex w-full flex-col items-center justify-center p-12 text-center text-xs text-[#66706A]">
        Campaign data is loading or unavailable.
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6 p-4 sm:p-6">
      {/* Top Header matching Reference Screenshot 1 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <Link
            className="inline-flex items-center gap-1.5 text-xs text-[#66706A] hover:text-[#171A18]"
            href="/campaigns"
          >
            <ArrowLeft size={14} />
            <span>Back to campaigns</span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-[#F1ECFF] text-[#6E44FF]">
              <Rocket size={22} />
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-[#171A18]">
                  {initialData.name}
                </h1>
                <CampaignStatusBadge status={initialData.status} />
              </div>
            </div>
          </div>
        </div>

        {/* Top-Right Actions */}
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3 text-sm font-semibold text-[#171A18] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FBFCFB] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#07813F]/30 disabled:cursor-not-allowed disabled:bg-[#F2F4F3] disabled:text-[#949D97]"
            disabled={Boolean(activeAction) || !initialData.phoneNumberId || !initialData.steps[0]?.body.trim()}
            onClick={() => setIsTestDialogOpen(true)}
            type="button"
          >
            <Send size={15} className="text-[#66706A]" />
            <span>Test send</span>
          </button>

          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3 text-sm font-semibold text-[#171A18] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FBFCFB] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#07813F]/30 disabled:cursor-not-allowed disabled:bg-[#F2F4F3] disabled:text-[#949D97]"
            disabled={Boolean(activeAction)}
            onClick={handlePauseResume}
            type="button"
          >
            {initialData.status === "active" ? (
              <>
                <Pause size={14} className="text-[#B97913]" />
                <span>{activeAction === "pause" ? "Pausing..." : "Pause campaign"}</span>
              </>
            ) : (
              <>
                <Play size={14} className="text-[#07813F]" />
                <span>{activeAction === "resume" ? "Resuming..." : "Resume campaign"}</span>
              </>
            )}
          </button>

          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3.5 text-xs font-semibold text-[#171A18] hover:bg-[#FBFCFB]"
            disabled={Boolean(activeAction)}
            onClick={() => setActiveTab("settings")}
            title="Campaign settings"
            type="button"
          >
            <Settings size={15} className="text-[#66706A]" />
            <span>Settings</span>
          </button>

          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#F8C4C4] bg-white px-3.5 text-xs font-semibold text-[#DA4545] hover:bg-[#FDECEC]"
            disabled={Boolean(activeAction)}
            onClick={() => setIsDeleting(true)}
            title="Delete campaign"
            type="button"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* View Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E5E9E6] pb-3">
        {[
          { id: "overview", label: "Overview & Activity", icon: BarChart2 },
          { id: "sequence", label: `Sequence (${initialData.steps.length} steps)`, icon: Workflow },
          { id: "responses", label: `Responses (${monitoring.responses.length})`, icon: MessageSquare },
          { id: "settings", label: "Settings & Configuration", icon: Settings },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                isActive
                  ? "bg-[#E9F5EE] text-[#07813F]"
                  : "text-[#66706A] hover:bg-[#F2F4F3] hover:text-[#171A18]"
              }`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ViewTab)}
              type="button"
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT: Overview & Activity */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-6">
          <CampaignMetaBar
            dripIntervalMinutes={monitoring.dripIntervalMinutes}
            sendWindowEnd={monitoring.sendWindowEnd}
            sendWindowStart={monitoring.sendWindowStart}
            sequenceName={monitoring.sequenceName}
            startedAt={monitoring.startedAt}
            timezone={monitoring.timezone}
          />

          <CampaignActiveKpis
            completionPercent={monitoring.metrics.completionPercent}
            estimatedCompletionDate={monitoring.metrics.estimatedCompletionDate}
            messagesSent={monitoring.metrics.messagesSent}
            optedOutCount={monitoring.metrics.optedOutCount}
            remainingCount={monitoring.metrics.remainingCount}
            repliesCount={monitoring.metrics.repliesCount}
            replyRate={monitoring.metrics.replyRate}
            totalRecipients={monitoring.metrics.totalRecipients}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <CampaignActivityChart data={monitoring.activityOverTime} />
            </div>
            <div className="lg:col-span-2">
              <CampaignDetailsCard
                avgTimeToReply={monitoring.details.avgTimeToReply}
              bouncedCount={monitoring.details.bouncedCount}
              dripInterval={`Every ${monitoring.dripIntervalMinutes} minutes`}
              fromCountryCode={
                initialData.phoneNumbers.find(
                  (p) => p.id === initialData.phoneNumberId || p.phoneNumber === monitoring.details.fromNumber,
                )?.countryCode || "FR"
              }
              fromNumber={monitoring.details.fromNumber}
              lastActivity={monitoring.details.lastActivity}
              onChangeNumberClick={() => setIsNumberModalOpen(true)}
              recipientsCount={monitoring.details.recipientsCount}
              sendWindow={`${monitoring.sendWindowStart.slice(0, 5)} – ${monitoring.sendWindowEnd.slice(0, 5)} (${monitoring.timezone})`}
              sendingDays={monitoring.details.sendingDays.length === 5 && monitoring.details.sendingDays.join(",") === "1,2,3,4,5" ? "Mon – Fri" : monitoring.details.sendingDays.length === 7 ? "Every day" : monitoring.details.sendingDays.map(d => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(", ")}
              sequenceName={monitoring.details.sequenceName}
              totalAvailableNumbers={initialData.phoneNumbers.length}
              totalRecipients={monitoring.metrics.totalRecipients}
              />
            </div>
          </div>


          <CampaignResponsesInbox
            phoneNumberId={initialData.phoneNumberId}
            responses={monitoring.responses}
          />
        </div>
      )}

      {/* TAB CONTENT: Sequence */}
      {activeTab === "sequence" && (
        <CampaignActiveSequenceCard initialData={initialData} />
      )}

      {/* TAB CONTENT: Responses */}
      {activeTab === "responses" && (
        <CampaignResponsesInbox
          phoneNumberId={initialData.phoneNumberId}
          responses={monitoring.responses}
        />
      )}

      {/* TAB CONTENT: Settings & Configuration */}
      {activeTab === "settings" && (
        <CampaignSettingsTab initialData={initialData} />
      )}

      {/* Modals */}
      <SendingNumberModal
        isOpen={isNumberModalOpen}
        onClose={() => setIsNumberModalOpen(false)}
        onSelectNumber={handleSelectNumber}
        phoneNumbers={initialData.phoneNumbers}
        selectedPhoneNumberId={initialData.phoneNumberId}
      />

      {/* Delete Confirmation Modal */}
      {isDeleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E5E9E6] bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-[#171A18]">Delete campaign?</h3>
            <p className="mt-2 text-xs leading-relaxed text-[#66706A]">
              Are you sure you want to delete <strong className="text-[#171A18]">{initialData.name}</strong>? This action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                className="h-9 rounded-lg border border-[#E5E9E6] px-3.5 text-xs font-medium text-[#171A18] hover:bg-[#F2F4F3]"
                disabled={activeAction === "delete"}
                onClick={() => setIsDeleting(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-9 rounded-lg bg-[#DA4545] px-3 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#949D97]"
                disabled={activeAction === "delete"}
                onClick={handleDelete}
                type="button"
              >
                {activeAction === "delete" ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <CampaignTestSendDialog
        body={initialData.steps[0]?.body ?? ""}
        isOpen={isTestDialogOpen}
        onClose={() => setIsTestDialogOpen(false)}
        phoneNumberId={initialData.phoneNumberId}
      />
    </div>
  );
}
