"use client";

import React, { useState } from "react";
import { Clock, MessageSquare, Phone, Play, Save } from "lucide-react";

import {
  countryIsoToFlag,
  formatPhoneNumberDisplay,
} from "@/components/campaigns/phone-number-identity";
import type { CampaignPhoneOption } from "@/components/campaigns/types";

type CampaignSummaryCardProps = {
  phoneNumber: CampaignPhoneOption | null;
  selectedCount: number;
  eligibleCount: number;
  duplicateCount: number;
  invalidCount: number;
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  dripIntervalMinutes: number;
  messagesCount: number;
  onLaunch: (consent: boolean) => void;
  onSaveDraft: () => void;
  statusMessage: { type: "success" | "error"; text: string } | null;
  submittingAction: "launch" | "save" | null;
};

export function CampaignSummaryCard({
  phoneNumber,
  selectedCount,
  eligibleCount,
  duplicateCount,
  invalidCount,
  timezone,
  sendWindowStart,
  sendWindowEnd,
  dripIntervalMinutes,
  messagesCount,
  onLaunch,
  onSaveDraft,
  statusMessage,
  submittingAction,
}: CampaignSummaryCardProps) {
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const isSubmitting = submittingAction !== null;

  const canLaunch =
    Boolean(phoneNumber && phoneNumber.status === "ready") &&
    eligibleCount > 0 &&
    messagesCount > 0 &&
    consentConfirmed;

  return (
    <div className="sticky top-6 flex flex-col gap-4 rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#EEF0EE] pb-3">
        <h2 className="text-sm font-semibold text-[#171A18]">Campaign summary</h2>
        <span className="rounded-full bg-[#F2F4F3] px-2 py-0.5 text-[11px] font-semibold text-[#66706A]">
          Draft
        </span>
      </div>

      {/* Recipients breakdown */}
      <div>
        <span className="text-xs font-semibold text-[#171A18]">Recipients</span>
        <div className="mt-2.5 flex flex-col gap-2 text-xs">
          <div className="flex justify-between text-[#66706A]">
            <span>Selected</span>
            <span className="font-semibold text-[#171A18]">{selectedCount}</span>
          </div>
          <div className="flex justify-between text-[#66706A]">
            <span>Eligible</span>
            <span className="font-semibold text-[#07813F]">{eligibleCount}</span>
          </div>
          <div className="flex justify-between text-[#66706A]">
            <span>Duplicates</span>
            <span className="font-semibold text-[#171A18]">{duplicateCount}</span>
          </div>
          <div className="flex justify-between text-[#66706A]">
            <span>Invalid numbers</span>
            <span className="font-semibold text-[#DA4545]">{invalidCount}</span>
          </div>
        </div>
      </div>

      {/* Compact Info Cards */}
      <div className="flex flex-col gap-2.5 pt-1">
        {/* Sending number block */}
        <div className="rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <div className="flex items-center gap-2.5">
            <Phone size={15} className="text-[#66706A]" />
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] text-[#949D97]">Sending number</span>
              <div className="mt-0.5 flex items-center gap-2 truncate text-xs font-semibold text-[#171A18]">
                {phoneNumber ? (
                  <>
                    <span>{countryIsoToFlag(phoneNumber.countryCode)}</span>
                    <span>{formatPhoneNumberDisplay(phoneNumber.phoneNumber)}</span>
                    <span className="rounded-full bg-[#E9F5EE] px-1.5 py-0.2 text-[10px] font-semibold text-[#07813F]">
                      Ready
                    </span>
                  </>
                ) : (
                  <span className="text-[#DA4545]">No number selected</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Schedule block */}
        <div className="rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <div className="flex items-center gap-2.5">
            <Clock size={15} className="text-[#66706A]" />
            <div>
              <span className="block text-[11px] text-[#949D97]">Schedule</span>
              <span className="mt-0.5 block text-xs font-semibold text-[#171A18]">
                {sendWindowStart.slice(0, 5)} – {sendWindowEnd.slice(0, 5)} ({timezone})
              </span>
              <span className="text-[11px] text-[#66706A]">Mon – Fri</span>
            </div>
          </div>
        </div>

        {/* Drip interval block */}
        <div className="rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <div className="flex items-center gap-2.5">
            <Clock size={15} className="text-[#66706A]" />
            <div>
              <span className="block text-[11px] text-[#949D97]">Drip interval</span>
              <span className="mt-0.5 block text-xs font-semibold text-[#171A18]">
                {dripIntervalMinutes} minutes
              </span>
            </div>
          </div>
        </div>

        {/* Messages block */}
        <div className="rounded-xl border border-[#EEF0EE] bg-[#FBFCFB] p-3">
          <div className="flex items-center gap-2.5">
            <MessageSquare size={15} className="text-[#66706A]" />
            <div>
              <span className="block text-[11px] text-[#949D97]">Messages</span>
              <span className="mt-0.5 block text-xs font-semibold text-[#171A18]">
                {messagesCount} of 3
              </span>
              <span className="text-[11px] text-[#66706A]">
                Stops on reply or opt-out
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Checkbox */}
      <div className="mt-2 border-t border-[#EEF0EE] pt-3">
        <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#66706A]">
          <input
            checked={consentConfirmed}
            className="mt-0.5 size-4 accent-[#07813F]"
            onChange={(e) => setConsentConfirmed(e.target.checked)}
            type="checkbox"
          />
          <span>
            I confirm these contacts agreed to receive messages from this business.
          </span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-2">
        <button
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#07813F] text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canLaunch || isSubmitting}
          onClick={() => onLaunch(consentConfirmed)}
          type="button"
        >
          <Play size={15} />
          <span>{submittingAction === "launch" ? "Launching..." : "Launch campaign"}</span>
        </button>

        <button
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#E5E9E6] bg-white text-xs font-medium text-[#171A18] hover:bg-[#FBFCFB] disabled:opacity-50"
          disabled={isSubmitting}
          onClick={onSaveDraft}
          type="button"
        >
          <Save size={15} />
          <span>{submittingAction === "save" ? "Saving..." : "Save draft"}</span>
        </button>

        {statusMessage ? (
          <div
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              statusMessage.type === "success"
                ? "border-[#C2E8D2] bg-[#E9F5EE] text-[#07813F]"
                : "border-[#FDECEC] bg-[#FDECEC] text-[#DA4545]"
            }`}
            role={statusMessage.type === "success" ? "status" : "alert"}
          >
            {statusMessage.text}
          </div>
        ) : null}

        {!consentConfirmed && (
          <p className="text-center text-[11px] text-[#B97913]">
            Confirm recipient consent before launching.
          </p>
        )}
      </div>
    </div>
  );
}
