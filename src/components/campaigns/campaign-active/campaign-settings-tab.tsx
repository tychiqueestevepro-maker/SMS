"use client";

import React, { useState, useTransition } from "react";
import {
  AlertTriangle,
  Calendar,
  Clock,
  Globe,
  Phone,
  Save,
  Trash2,
  Pause,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { deleteCampaignAction, pauseCampaignAction, saveCampaignDraftAction } from "@/app/(app)/campaigns/actions";
import { PhoneNumberIdentity } from "@/components/campaigns/phone-number-identity";
import { SendingNumberModal } from "@/components/campaigns/sending-number-modal";
import type { CampaignEditorDto } from "@/components/campaigns/types";

const DAYS = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 7, label: "Sun" },
];

export function CampaignSettingsTab({ initialData }: { initialData: CampaignEditorDto }) {
  const router = useRouter();
  const [name, setName] = useState(initialData.name);
  const [phoneNumberId, setPhoneNumberId] = useState<string | null>(
    initialData.phoneNumberId || (initialData.phoneNumbers[0]?.id ?? null),
  );
  const [timezone, setTimezone] = useState(initialData.timezone || "UTC");
  const [sendWindowStart, setSendWindowStart] = useState(
    initialData.sendWindowStart || "09:00:00",
  );
  const [sendWindowEnd, setSendWindowEnd] = useState(
    initialData.sendWindowEnd || "18:00:00",
  );
  const [dripIntervalMinutes, setDripIntervalMinutes] = useState(
    initialData.dripIntervalMinutes || 2,
  );
  const [sendingDays, setSendingDays] = useState<number[]>(
    initialData.sendingDays || [1, 2, 3, 4, 5],
  );

  const [isNumberModalOpen, setIsNumberModalOpen] = useState(false);
  const [isDeletingModalOpen, setIsDeletingModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedPhone = initialData.phoneNumbers.find((p) => p.id === phoneNumberId);

  const toggleDay = (dayId: number) => {
    const next = new Set(sendingDays);
    if (next.has(dayId)) {
      if (next.size > 1) next.delete(dayId);
    } else {
      next.add(dayId);
    }
    setSendingDays(Array.from(next).sort((a, b) => a - b));
  };

  const handleSaveSettings = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await saveCampaignDraftAction({
        campaignId: initialData.id,
        contactIds: initialData.selectedContactIds,
        dripIntervalMinutes,
        name,
        phoneNumberId,
        sendWindowEnd,
        sendWindowStart,
        sendingDays,
        steps: initialData.steps,
        timezone,
      });

      if (res.ok) {
        setNotice({ message: "Campaign settings saved.", ok: true });
      } else {
        setNotice({ message: res.message || "Failed to save settings.", ok: false });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!initialData.id || isPending) return;
    startTransition(async () => {
      await deleteCampaignAction(initialData.id!);
      router.push("/campaigns");
    });
  };

  const handleArchive = () => {
    if (!initialData.id || isPending) return;
    startTransition(async () => {
      await pauseCampaignAction(initialData.id!);
      router.push("/campaigns");
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Feedback Notice */}
      {notice && (
        <div
          className={`rounded-xl border p-4 text-xs font-semibold ${
            notice.ok
              ? "border-[#C2E8D2] bg-[#E9F5EE] text-[#07813F]"
              : "border-[#F8C4C4] bg-[#FDECEC] text-[#DA4545]"
          }`}
        >
          {notice.message}
        </div>
      )}

      {/* 1. General Information Card */}
      <div className="rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[#171A18] border-b border-[#EEF0EE] pb-3">
          General Information
        </h2>

        <div className="mt-4 flex flex-col gap-4">
          {/* Campaign Name */}
          <div>
            <label className="block text-xs font-semibold text-[#171A18] mb-1.5">
              Campaign Name
            </label>
            <input
              className="h-10 w-full rounded-xl border border-[#E5E9E6] bg-white px-3.5 text-xs text-[#171A18] placeholder-[#949D97] focus:border-[#07813F] focus:outline-none"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Sales Outreach"
              type="text"
              value={name}
            />
          </div>

          {/* Sending Phone Number Selector Trigger */}
          <div>
            <label className="block text-xs font-semibold text-[#171A18] mb-1.5">
              Sending Phone Number
            </label>
            <button
              className="flex h-11 w-full items-center justify-between rounded-xl border border-[#E5E9E6] bg-white px-3.5 text-xs transition-colors hover:bg-[#FBFCFB]"
              onClick={() => setIsNumberModalOpen(true)}
              type="button"
            >
              <div className="flex items-center gap-2">
                <Phone size={15} className="text-[#949D97]" />
                {selectedPhone ? (
                  <PhoneNumberIdentity option={selectedPhone} />
                ) : (
                  <span className="text-[#949D97]">Select a phone number...</span>
                )}
              </div>
              <span className="text-[11px] font-semibold text-[#07813F]">Change</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Schedule & Delivery Settings Card */}
      <div className="rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[#171A18] border-b border-[#EEF0EE] pb-3">
          Schedule & Delivery Settings
        </h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Timezone */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[#171A18] mb-1.5">
              <Globe size={14} className="text-[#949D97]" />
              <span>Timezone</span>
            </label>
            <select
              className="h-10 w-full rounded-xl border border-[#E5E9E6] bg-white px-3 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
              onChange={(e) => setTimezone(e.target.value)}
              value={timezone}
            >
              <option value="UTC">UTC (Universal Coordinated Time)</option>
              <option value="America/New_York">America / New York (EST)</option>
              <option value="America/Los_Angeles">America / Los Angeles (PST)</option>
              <option value="Europe/Paris">Europe / Paris (CET)</option>
              <option value="Europe/London">Europe / London (GMT)</option>
            </select>
          </div>

          {/* Drip Interval */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[#171A18] mb-1.5">
              <Zap size={14} className="text-[#949D97]" />
              <span>Drip Interval</span>
            </label>
            <select
              className="h-10 w-full rounded-xl border border-[#E5E9E6] bg-white px-3 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
              onChange={(e) => setDripIntervalMinutes(Number(e.target.value))}
              value={dripIntervalMinutes}
            >
              <option value={1}>Every 1 minute</option>
              <option value={2}>Every 2 minutes (Recommended)</option>
              <option value={5}>Every 5 minutes</option>
              <option value={10}>Every 10 minutes</option>
              <option value={30}>Every 30 minutes</option>
            </select>
          </div>

          {/* Send Window Start */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[#171A18] mb-1.5">
              <Clock size={14} className="text-[#949D97]" />
              <span>Sending Hours Start</span>
            </label>
            <input
              className="h-10 w-full rounded-xl border border-[#E5E9E6] bg-white px-3 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
              onChange={(e) => setSendWindowStart(e.target.value)}
              type="time"
              value={sendWindowStart}
            />
          </div>

          {/* Send Window End */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[#171A18] mb-1.5">
              <Clock size={14} className="text-[#949D97]" />
              <span>Sending Hours End</span>
            </label>
            <input
              className="h-10 w-full rounded-xl border border-[#E5E9E6] bg-white px-3 text-xs text-[#171A18] focus:border-[#07813F] focus:outline-none"
              onChange={(e) => setSendWindowEnd(e.target.value)}
              type="time"
              value={sendWindowEnd}
            />
          </div>
        </div>

        {/* Sending Days Selector Pills */}
        <div className="mt-4 border-t border-[#EEF0EE] pt-4">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#171A18] mb-2">
            <Calendar size={14} className="text-[#949D97]" />
            <span>Sending Days</span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map((day) => {
              const isSelected = sendingDays.includes(day.id);
              return (
                <button
                  className={`h-9 min-w-[48px] rounded-xl text-xs font-semibold transition-all ${
                    isSelected
                      ? "border border-[#C2E8D2] bg-[#E9F5EE] text-[#07813F] shadow-xs"
                      : "border border-[#E5E9E6] bg-white text-[#66706A] hover:bg-[#FBFCFB] hover:text-[#171A18]"
                  }`}
                  key={day.id}
                  onClick={() => toggleDay(day.id)}
                  type="button"
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Save Settings Action Button */}
        <div className="mt-6 border-t border-[#EEF0EE] pt-4 flex justify-end">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#07813F] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            disabled={isSaving || !name.trim()}
            onClick={handleSaveSettings}
            type="button"
          >
            <Save size={14} />
            <span>{isSaving ? "Saving changes..." : "Save settings"}</span>
          </button>
        </div>
      </div>

      {/* 3. Archive Card */}
      <div className="rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[#171A18]">
              <span>Archive Campaign</span>
            </h2>
            <p className="mt-1 text-xs text-[#66706A]">
              Pause this campaign and move it to the Archived tab. You can resume it later.
            </p>
          </div>

          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] px-3 text-sm font-semibold text-[#171A18] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#F2F4F3] disabled:cursor-not-allowed disabled:bg-[#F2F4F3] disabled:text-[#949D97]"
            disabled={isPending}
            onClick={handleArchive}
            type="button"
          >
            <Pause size={14} className="text-[#B97913]" />
            <span>{isPending ? "Archiving..." : "Archive campaign"}</span>
          </button>
        </div>
      </div>

      {/* 4. Danger Zone Card */}
      <div className="rounded-2xl border border-[#F8C4C4] bg-[#FDF7F7] p-5 shadow-xs">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[#DA4545]">
              <AlertTriangle size={16} />
              <span>Danger Zone</span>
            </h2>
            <p className="mt-1 text-xs text-[#66706A]">
              Permanently delete this campaign and all associated messages and metrics.
              This action cannot be undone.
            </p>
          </div>

          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#DA4545] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            onClick={() => setIsDeletingModalOpen(true)}
            type="button"
          >
            <Trash2 size={14} />
            <span>Delete campaign</span>
          </button>
        </div>
      </div>

      {/* Modals */}
      <SendingNumberModal
        isOpen={isNumberModalOpen}
        onClose={() => setIsNumberModalOpen(false)}
        onSelectNumber={(id: string) => setPhoneNumberId(id)}
        phoneNumbers={initialData.phoneNumbers}
        selectedPhoneNumberId={phoneNumberId}
      />

      {isDeletingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E5E9E6] bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-[#171A18]">Delete campaign?</h3>
            <p className="mt-2 text-xs leading-relaxed text-[#66706A]">
              Are you sure you want to delete <strong className="text-[#171A18]">{name}</strong>? This action will permanently remove all logs and sequence steps.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                className="h-9 rounded-lg border border-[#E5E9E6] px-3.5 text-xs font-medium text-[#171A18] hover:bg-[#F2F4F3]"
                disabled={isPending}
                onClick={() => setIsDeletingModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-9 rounded-lg bg-[#DA4545] px-3 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[#949D97]"
                disabled={isPending}
                onClick={handleDelete}
                type="button"
              >
                {isPending ? "Deleting..." : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
