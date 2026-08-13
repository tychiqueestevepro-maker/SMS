"use client";

import React, { useState } from "react";
import {
  Clock,
  Edit3,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { saveCampaignDraftAction } from "@/app/(app)/campaigns/actions";
import type { CampaignEditorDto, CampaignStepDto } from "@/components/campaigns/types";

type CampaignActiveSequenceCardProps = {
  initialData: CampaignEditorDto;
};

const VARIABLES = ["{{first_name}}", "{{last_name}}", "{{company}}"];

export function CampaignActiveSequenceCard({ initialData }: CampaignActiveSequenceCardProps) {
  const router = useRouter();
  const [steps, setSteps] = useState<CampaignStepDto[]>(
    initialData.steps.length > 0
      ? initialData.steps
      : [{ body: "Bonjour {{first_name}} !", waitDaysAfterPrevious: 0 }],
  );
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const handleStepChange = (index: number, body: string) => {
    const updated = [...steps];
    updated[index] = { ...updated[index], body };
    setSteps(updated);
  };

  const handleDelayChange = (index: number, days: number) => {
    const updated = [...steps];
    updated[index] = { ...updated[index], waitDaysAfterPrevious: days };
    setSteps(updated);
  };

  const handleAddStep = () => {
    if (steps.length >= 5) return;
    setSteps([
      ...steps,
      {
        body: "Bonjour {{first_name}}, je me permettais de vous relancer.",
        waitDaysAfterPrevious: 2,
      },
    ]);
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) return;
    const updated = steps.filter((_, i) => i !== index);
    setSteps(updated);
  };

  const insertVariable = (index: number, variable: string) => {
    const currentBody = steps[index].body;
    handleStepChange(index, `${currentBody} ${variable}`);
  };

  const handleSaveSequence = async () => {
    if (!initialData.id) return;
    setIsSaving(true);
    setNotice(null);

    const res = await saveCampaignDraftAction({
      campaignId: initialData.id,
      contactIds: initialData.selectedContactIds,
      dripIntervalMinutes: initialData.dripIntervalMinutes || 2,
      name: initialData.name,
      phoneNumberId: initialData.phoneNumberId,
      sendWindowEnd: initialData.sendWindowEnd || "18:00:00",
      sendWindowStart: initialData.sendWindowStart || "09:00:00",
      sendingDays: initialData.sendingDays || [1, 2, 3, 4, 5],
      steps,
      timezone: initialData.timezone || "UTC",
    });

    setIsSaving(false);
    if (res.ok) {
      setNotice({ message: "Sequence updated successfully!", ok: true });
      setIsEditing(false);
      router.refresh();
    } else {
      setNotice({ message: res.message || "Failed to update sequence.", ok: false });
    }
  };

  return (
    <div className="rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#EEF0EE] pb-3">
        <div className="flex items-center gap-2">
          <Workflow size={16} className="text-[#07813F]" />
          <h2 className="text-sm font-bold text-[#171A18]">Message Sequence</h2>
          <span className="rounded-full bg-[#E9F5EE] px-2 py-0.5 text-[11px] font-semibold text-[#07813F]">
            {steps.length} {steps.length === 1 ? "step" : "steps"}
          </span>
        </div>

        {!isEditing ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs font-semibold text-[#07813F] transition-colors hover:bg-[#E9F5EE]"
            onClick={() => setIsEditing(true)}
            type="button"
          >
            <Edit3 size={13} />
            <span>Edit sequence</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              className="h-8 rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs font-medium text-[#171A18] hover:bg-[#F2F4F3]"
              onClick={() => {
                setSteps(initialData.steps);
                setIsEditing(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#07813F] px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              disabled={isSaving}
              onClick={handleSaveSequence}
              type="button"
            >
              <Save size={13} />
              <span>{isSaving ? "Saving..." : "Save sequence"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Notice Banner */}
      {notice && (
        <div
          className={`mt-4 rounded-xl border p-3 text-xs font-semibold ${
            notice.ok
              ? "border-[#C2E8D2] bg-[#E9F5EE] text-[#07813F]"
              : "border-[#F8C4C4] bg-[#FDECEC] text-[#DA4545]"
          }`}
        >
          {notice.message}
        </div>
      )}

      {/* Steps List */}
      <div className="mt-4 flex flex-col gap-4">
        {steps.map((step, idx) => {
          const stepNumber = idx + 1;
          const charCount = step.body.length;
          const smsSegments = Math.ceil(charCount / 160) || 1;

          return (
            <React.Fragment key={step.id || idx}>
              {/* Connector line & delay pill between steps */}
              {idx > 0 && (
                <div className="my-1 flex items-center justify-center gap-2">
                  <div className="h-4 w-0.5 bg-[#C2E8D2]" />
                  {isEditing ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[#C2E8D2] bg-[#E9F5EE] px-3 py-1 text-xs font-medium text-[#07813F]">
                      <Clock size={13} />
                      <span>Wait</span>
                      <select
                        className="rounded bg-white px-1.5 py-0.5 text-xs font-semibold text-[#07813F] focus:outline-none"
                        onChange={(e) => handleDelayChange(idx, Number(e.target.value))}
                        value={step.waitDaysAfterPrevious ?? 2}
                      >
                        <option value={1}>1 day</option>
                        <option value={2}>2 days</option>
                        <option value={3}>3 days</option>
                        <option value={5}>5 days</option>
                        <option value={7}>7 days</option>
                      </select>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[#C2E8D2] bg-[#E9F5EE] px-3 py-1 text-[11px] font-semibold text-[#07813F]">
                      <Clock size={12} />
                      <span>Wait {step.waitDaysAfterPrevious ?? 2} {step.waitDaysAfterPrevious === 1 ? "day" : "days"}</span>
                    </div>
                  )}
                  <div className="h-4 w-0.5 bg-[#C2E8D2]" />
                </div>
              )}

              {/* Step Card */}
              <div className="rounded-xl border border-[#E5E9E6] bg-[#FBFCFB] p-4 transition-all">
                <div className="flex items-center justify-between border-b border-[#EEF0EE] pb-2.5 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-lg bg-[#E9F5EE] text-xs font-bold text-[#07813F]">
                      {stepNumber}
                    </span>
                    <span className="text-xs font-bold text-[#171A18]">
                      {idx === 0 ? "Initial Message" : `Follow-up #${idx}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-medium text-[#949D97]">
                      {charCount} chars ({smsSegments} {smsSegments === 1 ? "SMS" : "SMS"})
                    </span>
                    {isEditing && idx > 0 && (
                      <button
                        className="text-[#949D97] transition-colors hover:text-[#DA4545]"
                        onClick={() => handleRemoveStep(idx)}
                        title="Delete step"
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    {/* Insert Variables Bar */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-[#66706A]">Insert tag:</span>
                      {VARIABLES.map((v) => (
                        <button
                          className="rounded-md border border-[#E5E9E6] bg-white px-2 py-0.5 text-[11px] font-medium text-[#07813F] hover:bg-[#E9F5EE]"
                          key={v}
                          onClick={() => insertVariable(idx, v)}
                          type="button"
                        >
                          {v}
                        </button>
                      ))}
                    </div>

                    <textarea
                      className="min-h-[90px] w-full rounded-xl border border-[#E5E9E6] bg-white p-3 text-xs leading-relaxed text-[#171A18] focus:border-[#07813F] focus:outline-none"
                      onChange={(e) => handleStepChange(idx, e.target.value)}
                      rows={3}
                      value={step.body}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-[#171A18] leading-relaxed whitespace-pre-wrap bg-white p-3 rounded-lg border border-[#E5E9E6]">
                    {step.body}
                  </p>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Add Step Action in Edit Mode */}
      {isEditing && steps.length < 5 && (
        <div className="mt-4 flex justify-center">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-[#07813F] bg-[#E9F5EE] px-4 text-xs font-semibold text-[#07813F] transition-colors hover:bg-[#D4EEDF]"
            onClick={handleAddStep}
            type="button"
          >
            <Plus size={15} />
            <span>Add follow-up step</span>
          </button>
        </div>
      )}

      {/* Safety Notice */}
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#F2F4F3] p-3 text-xs text-[#66706A]">
        <ShieldAlert size={15} className="text-[#949D97] flex-shrink-0" />
        <span>Sequence automatically stops for a contact as soon as they reply or opt out.</span>
      </div>
    </div>
  );
}
