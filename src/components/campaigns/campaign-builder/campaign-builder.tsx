"use client";

import React, { useMemo, useState } from "react";
import { Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  deleteCampaignAction,
  launchCampaignAction,
  saveCampaignDraftAction,
} from "@/app/(app)/campaigns/actions";
import { CampaignAudienceCard } from "@/components/campaigns/campaign-builder/campaign-audience-card";
import { CampaignDetailsCard } from "@/components/campaigns/campaign-builder/campaign-details-card";
import { CampaignScheduleCard } from "@/components/campaigns/campaign-builder/campaign-schedule-card";
import { CampaignSequence } from "@/components/campaigns/campaign-builder/campaign-sequence";
import { CampaignSummaryCard } from "@/components/campaigns/campaign-builder/campaign-summary-card";
import { CampaignTestSendDialog } from "@/components/campaigns/campaign-test-send-dialog";
import type {
  CampaignActionResult,
  CampaignEditorDto,
  CampaignStepDto,
} from "@/components/campaigns/types";
import { estimateCampaignCostImpact } from "@/lib/campaigns/cost-impact";
import { formatMicroUsd } from "@/lib/billing/integer";

export function CampaignBuilder({ initialData }: { initialData: CampaignEditorDto }) {
  const router = useRouter();
  const [name, setName] = useState(initialData.name);
  const [phoneNumberId, setPhoneNumberId] = useState<string | null>(
    initialData.phoneNumberId || (initialData.phoneNumbers[0]?.id ?? null),
  );
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>(
    initialData.selectedContactIds,
  );
  const [steps, setSteps] = useState<CampaignStepDto[]>(
    initialData.steps.length > 0
      ? initialData.steps
      : [{ body: "Bonjour {{first_name}} !", waitDaysAfterPrevious: null }],
  );
  const [timezone, setTimezone] = useState(initialData.timezone || "UTC");
  const [sendWindowStart, setSendWindowStart] = useState(initialData.sendWindowStart || "09:00:00");
  const [sendWindowEnd, setSendWindowEnd] = useState(initialData.sendWindowEnd || "18:00:00");
  const [sendingDays, setSendingDays] = useState<number[]>(
    initialData.sendingDays || [1, 2, 3, 4, 5],
  );
  const [dripIntervalMinutes, setDripIntervalMinutes] = useState(
    initialData.dripIntervalMinutes || 2,
  );

  const [submittingAction, setSubmittingAction] = useState<"launch" | "save" | null>(null);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [launchConfirmation, setLaunchConfirmation] = useState<{
    assessment: NonNullable<CampaignActionResult["assessment"]>;
    campaignId: string;
    confirmationKey: string;
    recipientCount: number;
  } | null>(null);

  const selectedPhone = useMemo(
    () => initialData.phoneNumbers.find((p) => p.id === phoneNumberId) || null,
    [initialData.phoneNumbers, phoneNumberId],
  );
  const isSubmitting = submittingAction !== null;

  const stats = useMemo(() => {
    const selectedSet = new Set(selectedContactIds);
    const selectedList = initialData.contacts.filter((c) => selectedSet.has(c.contactId));
    const eligibleList = selectedList.filter((c) => !c.isSuppressed && !c.hasActiveSequence);
    const suppressedCount = selectedList.filter((c) => c.isSuppressed).length;
    const invalidCount = selectedList.filter((c) => c.hasActiveSequence).length;

    return {
      duplicates: suppressedCount,
      eligible: eligibleList.length,
      invalid: invalidCount,
      selected: selectedList.length,
    };
  }, [initialData.contacts, selectedContactIds]);

  const eligibleRecipients = useMemo(() => {
    const selectedSet = new Set(selectedContactIds);
    return initialData.contacts.filter(
      (contact) =>
        selectedSet.has(contact.contactId) &&
        !contact.isSuppressed &&
        !contact.hasActiveSequence,
    );
  }, [initialData.contacts, selectedContactIds]);

  const costImpact = useMemo(
    () =>
      estimateCampaignCostImpact({
        currentEffectiveCredits:
          initialData.billing?.currentEffectiveCredits ?? 0,
        includedCredits: initialData.billing?.includedCredits ?? 0,
        overagePriceMicroUsd:
          initialData.billing?.overagePriceMicroUsd ?? 0,
        recipients: eligibleRecipients,
        steps,
      }),
    [eligibleRecipients, initialData.billing, steps],
  );

  const handleSaveDraft = async () => {
    setSubmittingAction("save");
    setStatusMessage(null);
    try {
      const res = await saveCampaignDraftAction({
        campaignId: initialData.id,
        contactIds: selectedContactIds,
        dripIntervalMinutes,
        name,
        phoneNumberId,
        sendWindowEnd,
        sendWindowStart,
        sendingDays,
        steps,
        timezone,
      });

      if (res.ok) {
        setStatusMessage({ text: "Draft saved.", type: "success" });
        if (res.campaignId && !initialData.id) {
          router.replace(`/campaigns/${res.campaignId}`);
        }
      } else {
        setStatusMessage({ text: res.message || "Could not save draft.", type: "error" });
      }
    } catch {
      setStatusMessage({ text: "An error occurred saving draft.", type: "error" });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleLaunch = async (
    consentConfirmed: boolean,
    confirmationKey: string | null = null,
    campaignIdOverride: string | null = null,
  ) => {
    setSubmittingAction("launch");
    setStatusMessage(null);
    try {
      let campaignIdToLaunch = campaignIdOverride;
      if (!campaignIdToLaunch) {
        const saveRes = await saveCampaignDraftAction({
          campaignId: initialData.id,
          contactIds: selectedContactIds,
          dripIntervalMinutes,
          name,
          phoneNumberId,
          sendWindowEnd,
          sendWindowStart,
          sendingDays,
          steps,
          timezone,
        });
        if (!saveRes.ok) {
          setStatusMessage({ text: saveRes.message || "Could not save draft.", type: "error" });
          return;
        }
        campaignIdToLaunch = saveRes.campaignId || initialData.id;
      }
      if (!campaignIdToLaunch) {
        setStatusMessage({ text: "Please save campaign first.", type: "error" });
        return;
      }

      const launchRes = await launchCampaignAction(campaignIdToLaunch, confirmationKey, consentConfirmed);

      if (launchRes.ok) {
        setLaunchConfirmation(null);
        setStatusMessage({ text: "Campaign launched.", type: "success" });
        window.location.reload();
      } else if (
        launchRes.code === "CONFIRM_CAMPAIGN_IMPACT" &&
        launchRes.confirmationKey &&
        launchRes.assessment
      ) {
        setLaunchConfirmation({
          campaignId: campaignIdToLaunch,
          confirmationKey: launchRes.confirmationKey,
          assessment: launchRes.assessment,
          recipientCount: launchRes.assessment.eligibleRecipientCount,
        });
      } else {
        setStatusMessage({ text: launchRes.message || "Failed to launch campaign.", type: "error" });
      }
    } catch {
      setStatusMessage({ text: "An error occurred launching campaign.", type: "error" });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleDeleteDraft = async () => {
    if (!initialData.id || isDeletingDraft) return;
    if (!confirm("Are you sure you want to delete this draft?")) return;
    setIsDeletingDraft(true);
    try {
      await deleteCampaignAction(initialData.id);
      router.push("/campaigns");
    } finally {
      setIsDeletingDraft(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-6 p-4 sm:p-6">
      {/* Top Breadcrumb & Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#66706A]">
            <Link className="hover:text-[#171A18]" href="/campaigns">
              Campaigns
            </Link>
            <span>/</span>
            <span className="truncate text-[#171A18] font-medium">{name || "Untitled Campaign"}</span>
          </div>

          <div className="mt-1 flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[#171A18]">
              {name || "Promotion Été 2026"}
            </h1>
            <span className="rounded-full bg-[#F2F4F3] px-2.5 py-0.5 text-xs font-semibold text-[#66706A]">
              Draft
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#66706A]">
            Build a sequence of up to three messages.
          </p>
        </div>

        {/* Top-right Actions */}
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3 text-sm font-semibold text-[#171A18] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FBFCFB] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#07813F]/30 disabled:cursor-not-allowed disabled:bg-[#F2F4F3] disabled:text-[#949D97]"
            disabled={!phoneNumberId || !steps[0]?.body.trim()}
            onClick={() => setIsTestDialogOpen(true)}
            type="button"
          >
            <Send size={15} className="text-[#66706A]" />
            <span>Test send</span>
          </button>
        </div>
      </div>

      {/* Grid Layout: Main builder + sticky summary panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_350px]">
        {/* Main Column */}
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <CampaignDetailsCard
              name={name}
              onNameChange={setName}
              onPhoneNumberChange={setPhoneNumberId}
              phoneNumberId={phoneNumberId}
              phoneNumbers={initialData.phoneNumbers}
            />

            <CampaignScheduleCard
              dripIntervalMinutes={dripIntervalMinutes}
              onDripIntervalChange={setDripIntervalMinutes}
              onSendWindowEndChange={setSendWindowEnd}
              onSendWindowStartChange={setSendWindowStart}
              onTimezoneChange={setTimezone}
              sendWindowEnd={sendWindowEnd}
              sendWindowStart={sendWindowStart}
              sendingDays={sendingDays}
              onSendingDaysChange={setSendingDays}
              timezone={timezone}
            />
          </div>

          <CampaignAudienceCard
            contacts={initialData.contacts}
            onSelectedContactIdsChange={setSelectedContactIds}
            selectedContactIds={selectedContactIds}
          />

          <CampaignSequence
            onStepsChange={setSteps}
            stepImpacts={costImpact.steps}
            steps={steps}
          />

          {/* Danger Zone */}
          {initialData.id && (
            <div className="rounded-2xl border border-[#F8C4C4] bg-[#FDF7F7] p-5 shadow-xs flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#DA4545]">Danger Zone</h3>
                <p className="mt-0.5 text-xs text-[#66706A]">
                  Delete this campaign draft permanently.
                </p>
              </div>
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#DA4545] px-3 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#949D97]"
                disabled={isDeletingDraft}
                onClick={handleDeleteDraft}
                type="button"
              >
                {isDeletingDraft ? "Deleting..." : "Delete draft"}
              </button>
            </div>
          )}
        </div>

        {/* Sticky Summary Column */}
        <div>
          <CampaignSummaryCard
            dripIntervalMinutes={dripIntervalMinutes}
            duplicateCount={stats.duplicates}
            eligibleCount={stats.eligible}
            invalidCount={stats.invalid}
            messagesCount={steps.length}
            billingAvailable={initialData.billing !== null}
            costImpact={costImpact}
            onLaunch={handleLaunch}
            onSaveDraft={handleSaveDraft}
            phoneNumber={selectedPhone}
            selectedCount={stats.selected}
            sendWindowEnd={sendWindowEnd}
            sendWindowStart={sendWindowStart}
            statusMessage={statusMessage}
            submittingAction={submittingAction}
            timezone={timezone}
          />
        </div>
      </div>

      {launchConfirmation ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
          <section
            aria-label="Review campaign impact"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl border border-[#E5E9E6] bg-white p-6 shadow-2xl"
            role="dialog"
          >
            <h2 className="text-xl font-semibold text-[#171A18] text-balance">
              Review campaign impact
            </h2>
            <p className="mt-3 text-sm text-[#66706A] text-pretty">
              Confirm the estimated usage before enrolling {launchConfirmation.recipientCount.toLocaleString("en-US")} contacts.
            </p>
            <div className="mt-4 rounded-xl border border-[#E5E9E6] bg-[#FBFCFB] p-4">
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[#66706A]">First send</dt>
                  <dd className="font-semibold text-[#171A18]">
                    {launchConfirmation.assessment.estimatedFirstStepCredits.toLocaleString("en-US")} credits
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[#66706A]">Maximum full sequence</dt>
                  <dd className="font-semibold text-[#171A18]">
                    {launchConfirmation.assessment.estimatedMaximumSequenceCredits.toLocaleString("en-US")} credits
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[#66706A]">Largest message</dt>
                  <dd className="font-semibold text-[#171A18]">
                    {launchConfirmation.assessment.maximumSegmentsPerMessage} {launchConfirmation.assessment.maximumSegmentsPerMessage === 1 ? "segment" : "segments"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[#66706A]">Additional Riink charge</dt>
                  <dd className="font-semibold text-[#171A18]">
                    {formatMicroUsd(
                      launchConfirmation.assessment
                        .estimatedMaximumAdditionalChargeMicroUsd,
                    )}
                  </dd>
                </div>
              </dl>
            </div>
            <p className="mt-3 text-xs text-[#66706A] text-pretty">
              The maximum assumes nobody replies. Replies and opt outs stop the remaining sequence and can reduce actual usage.
            </p>
            {costImpact.maximumSegmentsPerMessage > 1 ? (
              <p className="mt-3 rounded-lg border border-[#F2D3A2] bg-[#FFF8ED] px-3 py-2 text-xs font-medium text-[#8A5A10]" role="alert">
                At least one message uses multiple SMS segments. Each segment consumes one credit per recipient.
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-lg border border-[#E5E9E6] bg-white px-3 py-2 text-sm font-semibold text-[#171A18] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#F2F4F3] active:scale-[0.98]"
                onClick={() => setLaunchConfirmation(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-[#07813F] px-3 py-2 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#096D38] active:scale-[0.98] disabled:opacity-50"
                disabled={isSubmitting}
                onClick={() => handleLaunch(
                  true,
                  launchConfirmation.confirmationKey,
                  launchConfirmation.campaignId,
                )}
                type="button"
              >
                {submittingAction === "launch" ? "Launching..." : "Confirm and launch"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <CampaignTestSendDialog
        body={steps[0]?.body ?? ""}
        isOpen={isTestDialogOpen}
        onClose={() => setIsTestDialogOpen(false)}
        phoneNumberId={phoneNumberId}
      />
    </div>
  );
}
