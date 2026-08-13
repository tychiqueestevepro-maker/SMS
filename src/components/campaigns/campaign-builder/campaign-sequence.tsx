"use client";

import React from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import type { CampaignStepDto } from "@/components/campaigns/types";

type CampaignSequenceProps = {
  steps: CampaignStepDto[];
  onStepsChange: (steps: CampaignStepDto[]) => void;
};

export function CampaignSequence({ steps, onStepsChange }: CampaignSequenceProps) {
  const addStep = () => {
    if (steps.length >= 3) return;
    const newStep: CampaignStepDto = {
      body: "",
      waitDaysAfterPrevious: 2,
    };
    onStepsChange([...steps, newStep]);
  };

  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    const next = steps.filter((_, i) => i !== index);
    onStepsChange(next);
  };

  const updateStepBody = (index: number, body: string) => {
    const next = [...steps];
    next[index] = { ...next[index], body };
    onStepsChange(next);
  };

  const updateStepWait = (index: number, waitDays: number) => {
    const next = [...steps];
    next[index] = { ...next[index], waitDaysAfterPrevious: waitDays };
    onStepsChange(next);
  };

  const insertVariable = (index: number, variableName: string) => {
    const currentBody = steps[index].body;
    updateStepBody(index, `${currentBody} {{${variableName}}}`);
  };

  return (
    <div className="rounded-2xl border border-[#E5E9E6] bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-[#171A18]">Message sequence</h2>
          <span className="rounded-full bg-[#F2F4F3] px-2 py-0.5 text-[11px] font-medium text-[#66706A]">
            {steps.length} of 3 messages
          </span>
        </div>

        {steps.length < 3 && (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3 text-xs font-semibold text-[#07813F] hover:bg-[#E9F5EE]"
            onClick={addStep}
            type="button"
          >
            <Plus size={14} />
            <span>Add message</span>
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-[#66706A]">
        Messages stop automatically when a contact replies or opts out.
      </p>

      {/* Workflow steps sequence */}
      <div className="relative mt-5 flex flex-col gap-4">
        {/* Connector Line */}
        {steps.length > 1 && (
          <div className="absolute bottom-6 left-6 top-6 w-0.5 border-l-2 border-dashed border-[#EEF0EE]" />
        )}

        {steps.map((step, idx) => {
          const isFirst = idx === 0;

          return (
            <div
              className="relative z-10 rounded-xl border border-[#E5E9E6] bg-white p-4 transition-all hover:border-[#D1D5D3]"
              key={idx}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="cursor-grab text-[#949D97] hover:text-[#171A18]">
                    <GripVertical size={16} />
                  </span>

                  <span className="grid size-6 place-items-center rounded-lg bg-[#E9F5EE] text-xs font-bold text-[#07813F]">
                    {idx + 1}
                  </span>

                  <div>
                    <h3 className="text-xs font-semibold text-[#171A18]">Message {idx + 1}</h3>
                    <p className="mt-0.5 text-[11px] text-[#949D97]">
                      {isFirst ? (
                        "Immediate send"
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          Wait
                          <select
                            className="rounded border border-[#E5E9E6] bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#171A18]"
                            onChange={(e) => updateStepWait(idx, Number(e.target.value))}
                            value={step.waitDaysAfterPrevious || 2}
                          >
                            <option value={1}>1 day</option>
                            <option value={2}>2 days</option>
                            <option value={3}>3 days</option>
                            <option value={5}>5 days</option>
                            <option value={7}>7 days</option>
                          </select>
                          after previous message
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {steps.length > 1 && (
                    <button
                      aria-label="Remove step"
                      className="rounded-lg p-1.5 text-[#949D97] hover:bg-[#FDECEC] hover:text-[#DA4545]"
                      onClick={() => removeStep(idx)}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              {/* Textarea for message body */}
              <div className="mt-3">
                <textarea
                  aria-label={`Message ${idx + 1} content`}
                  className="w-full rounded-lg border border-[#E5E9E6] bg-white p-3 text-xs leading-relaxed text-[#171A18] placeholder-[#949D97] focus:border-[#07813F] focus:outline-none focus:ring-1 focus:ring-[#07813F]"
                  onChange={(e) => updateStepBody(idx, e.target.value)}
                  placeholder="Write your SMS message... Use {{first_name}} to personalize."
                  rows={3}
                  value={step.body}
                />
              </div>

              {/* Variable Insertion Pills */}
              <div className="mt-2.5 flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#66706A]">
                  <span className="font-medium text-[#949D97]">Insert variable:</span>
                  {["first_name", "last_name", "company"].map((varName) => (
                    <button
                      className="rounded-md border border-[#E5E9E6] bg-[#FBFCFB] px-2 py-0.5 font-mono text-[10px] text-[#171A18] hover:bg-[#E9F5EE] hover:text-[#07813F]"
                      key={varName}
                      onClick={() => insertVariable(idx, varName)}
                      type="button"
                    >
                      {`{{${varName}}}`}
                    </button>
                  ))}
                </div>

                <span className="text-[11px] text-[#949D97]">
                  {step.body.length} / 160 chars (1 SMS segment)
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
