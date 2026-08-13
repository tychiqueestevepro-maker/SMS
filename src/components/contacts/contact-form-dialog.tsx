"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createContactAction, updateContactAction } from "@/app/(app)/contacts/actions";
import { Modal } from "@/components/contacts/modal";
import type { ContactActionResult, PipelineStageDto } from "@/components/contacts/types";
import { Button } from "@/components/ui/button";
import type { ContactSearchSource } from "@/lib/contacts/types";

type ContactFormDialogProps = {
  contact: ContactSearchSource | null;
  onClose: () => void;
  onResult: (result: ContactActionResult) => void;
  open: boolean;
  stages: PipelineStageDto[];
  initialStageId?: string;
};

const inputClass =
  "h-10 w-full rounded-lg border border-[#dbe2dd] bg-white px-3 text-sm text-[#26342b] shadow-sm placeholder:text-[#9aa39d] focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]";

export function ContactFormDialog({ contact, onClose, onResult, open, stages, initialStageId }: ContactFormDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const defaultStage = stages.find((stage) => stage.isDefault) ?? stages[0];
  const editing = Boolean(contact);

  function close() {
    if (isPending) return;
    setError(null);
    onClose();
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const actionResult = editing ? await updateContactAction(formData) : await createContactAction(formData);
      if (!actionResult.ok) {
        setError(actionResult.message);
        return;
      }
      router.refresh();
      onResult(actionResult);
      onClose();
    });
  }

  return (
    <Modal
      description={editing ? "Update this contact's details and pipeline stage." : "Add someone to your workspace."}
      onClose={close}
      open={open}
      title={editing ? "Edit contact" : "Add contact"}
    >
      <form action={submit}>
        <input name="contactId" type="hidden" value={contact?.id ?? ""} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="contact-first-name">
              First name
            </label>
            <input
              autoFocus
              className={inputClass}
              defaultValue={contact?.firstName ?? ""}
              id="contact-first-name"
              maxLength={100}
              name="firstName"
              placeholder="Alex"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="contact-last-name">
              Last name
            </label>
            <input
              className={inputClass}
              defaultValue={contact?.lastName ?? ""}
              id="contact-last-name"
              maxLength={100}
              name="lastName"
              placeholder="Morgan"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="contact-job-title">
              Job Title <span className="font-normal text-[#879189]">(optional)</span>
            </label>
            <input
              className={inputClass}
              defaultValue={contact?.jobTitle ?? ""}
              id="contact-job-title"
              maxLength={100}
              name="jobTitle"
              placeholder="CEO"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="contact-company">
              Company <span className="font-normal text-[#879189]">(optional)</span>
            </label>
            <input
              className={inputClass}
              defaultValue={contact?.company ?? ""}
              id="contact-company"
              maxLength={160}
              name="company"
              placeholder="Northstar Labs"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="contact-phone">
              Phone number
            </label>
            <input
              className={inputClass}
              defaultValue={contact?.phoneE164 ?? ""}
              id="contact-phone"
              inputMode="tel"
              name="phone"
              placeholder="(415) 555-0123"
              required
              type="tel"
            />
            <p className="mt-1.5 text-xs text-[#7a857e]">US phone numbers only.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="contact-stage">
              Pipeline stage
            </label>
            <select
              className={inputClass}
              defaultValue={contact?.pipelineStageId ?? initialStageId ?? defaultStage?.id ?? ""}
              id="contact-stage"
              name="stageId"
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}{stage.isDefault ? " (Default)" : ""}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p className="rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3 py-2.5 text-sm text-[#8f312a] sm:col-span-2" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
          <Button disabled={isPending} onClick={close} variant="secondary">
            Cancel
          </Button>
          <Button disabled={isPending || stages.length === 0} type="submit">
            {isPending ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : null}
            {editing ? "Save changes" : "Add contact"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
