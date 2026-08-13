"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRef } from "react";

import type { CampaignContactOption, CampaignStepDto } from "@/components/campaigns/types";
import { estimateSmsCredits } from "@/lib/messaging/credits";
import { renderCampaignTemplate } from "@/lib/campaigns/templates";

const variables = [
  { label: "First name", token: "{{first_name}}" },
  { label: "Last name", token: "{{last_name}}" },
  { label: "Company", token: "{{company}}" },
] as const;

type MessageComposerProps = {
  canRemove: boolean;
  index: number;
  onChange: (step: CampaignStepDto) => void;
  onRemove: () => void;
  previewContact?: CampaignContactOption;
  readOnly: boolean;
  step: CampaignStepDto;
};

function renderedPreview(body: string, contact?: CampaignContactOption) {
  try {
    return renderCampaignTemplate(body, contact ?? {});
  } catch {
    return body;
  }
}

export function MessageComposer({ canRemove, index, onChange, onRemove, previewContact, readOnly, step }: MessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preview = renderedPreview(step.body, previewContact);
  const credits = step.body.trim() ? Math.max(1, estimateSmsCredits(preview)) : 0;

  function insertVariable(token: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange({ ...step, body: `${step.body}${token}` });
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const body = `${step.body.slice(0, start)}${token}${step.body.slice(end)}`;
    onChange({ ...step, body });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <section className="rounded-xl border border-[#e2e7e3] bg-white">
      <header className="flex items-center justify-between gap-4 border-b border-[#edf0ee] px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-[#eaf3ed] text-xs font-bold text-[#246b4a]">{index + 1}</span>
          <div>
            <h3 className="text-sm font-semibold text-[#26342b]">Message {index + 1}</h3>
            {index === 0 ? <p className="mt-0.5 text-xs text-[#7a857e]">Sent when the campaign begins</p> : null}
          </div>
        </div>
        {!readOnly && canRemove ? (
          <button aria-label={`Remove message ${index + 1}`} className="grid size-8 place-items-center rounded-lg text-[#879189] hover:bg-[#fff0ee] hover:text-[#b33b32]" onClick={onRemove} type="button">
            <Trash2 aria-hidden="true" size={15} />
          </button>
        ) : null}
      </header>

      <div className="p-4">
        {index > 0 ? (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-[#f6f8f6] px-3 py-2.5">
            <span className="text-xs font-medium text-[#68736c]">Wait</span>
            {readOnly ? (
              <span className="text-sm font-semibold text-[#344139]">{step.waitDaysAfterPrevious} {step.waitDaysAfterPrevious === 1 ? "day" : "days"}</span>
            ) : (
              <input
                aria-label={`Wait days before message ${index + 1}`}
                className="h-8 w-20 rounded-md border border-[#dbe2dd] bg-white px-2 text-sm text-[#26342b] focus:border-[#2e7d57] focus:outline-none focus:ring-2 focus:ring-[#d8ebe0]"
                max={365}
                min={1}
                onChange={(event) => onChange({ ...step, waitDaysAfterPrevious: Number(event.target.value) })}
                type="number"
                value={step.waitDaysAfterPrevious ?? 1}
              />
            )}
            <span className="text-xs text-[#68736c]">after the previous message</span>
          </div>
        ) : null}

        {readOnly ? (
          <div className="min-h-28 whitespace-pre-wrap rounded-lg border border-[#e2e7e3] bg-[#fafbfa] p-3 text-sm leading-6 text-[#344139]">{step.body}</div>
        ) : (
          <>
            <textarea
              aria-label={`Message ${index + 1} content`}
              className="min-h-32 w-full resize-y rounded-lg border border-[#dbe2dd] bg-white p-3 text-sm leading-6 text-[#26342b] shadow-sm placeholder:text-[#9aa39d] focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
              maxLength={1600}
              onChange={(event) => onChange({ ...step, body: event.target.value })}
              placeholder="Write your message…"
              ref={textareaRef}
              value={step.body}
            />
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {variables.map((variable) => (
                  <button className="inline-flex h-7 items-center gap-1 rounded-md border border-[#dfe5e0] bg-white px-2 text-xs font-medium text-[#5f6c64] hover:border-[#abc1b2] hover:text-[#246b4a]" key={variable.token} onClick={() => insertVariable(variable.token)} type="button">
                    <Plus aria-hidden="true" size={11} />
                    {variable.label}
                  </button>
                ))}
              </div>
              <p className="shrink-0 text-xs font-medium text-[#68736c]">
                {preview.length.toLocaleString("en-US")} characters · {credits} SMS {credits === 1 ? "credit" : "credits"}
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
