"use client";

import { Send, X } from "lucide-react";
import { useMemo, useState } from "react";

import { sendCampaignTestMessageAction } from "@/app/(app)/campaigns/actions";
import { renderCampaignTemplate, validateCampaignTemplate } from "@/lib/campaigns/templates";
import { estimateSmsCredits } from "@/lib/messaging/credits";

type CampaignTestSendDialogProps = {
  body: string;
  isOpen: boolean;
  onClose: () => void;
  phoneNumberId: string | null;
};

export function CampaignTestSendDialog({
  body,
  isOpen,
  onClose,
  phoneNumberId,
}: CampaignTestSendDialogProps) {
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null);
  const [recipientPhoneNumber, setRecipientPhoneNumber] = useState("");

  const preview = useMemo(() => {
    if (!body.trim() || validateCampaignTemplate(body).length > 0) return body.trim();
    return renderCampaignTemplate(body, {
      company: "Riink",
      firstName: "Test",
      lastName: "Contact",
    }).trim();
  }, [body]);
  const estimatedSegments = Math.max(1, estimateSmsCredits(preview));

  if (!isOpen) return null;

  const close = () => {
    if (isSending) return;
    setNotice(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSending || !phoneNumberId || !preview) return;

    setIsSending(true);
    setNotice(null);
    try {
      const result = await sendCampaignTestMessageAction({
        body,
        phoneNumberId,
        recipientPhoneNumber,
        requestId: crypto.randomUUID(),
      });
      setNotice({ message: result.message, ok: result.ok });
    } catch {
      setNotice({ message: "The test message couldn't be sent. Please try again.", ok: false });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <section
        aria-busy={isSending}
        aria-label="Send a test message"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-[#E5E9E6] bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between border-b border-[#EEF0EE] p-5">
          <div>
            <h2 className="text-base font-semibold text-[#171A18]">Send a test message</h2>
            <p className="mt-1 text-sm text-[#66706A]">
              Send the first sequence message without launching the campaign.
            </p>
          </div>
          <button
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg text-[#949D97] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#F2F4F3] hover:text-[#171A18] focus-visible:ring-2 focus-visible:ring-[#07813F]/30 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSending}
            onClick={close}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4 p-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#171A18]" htmlFor="campaign-test-phone">
                Recipient phone number
              </label>
              <input
                autoComplete="tel"
                className="h-10 w-full rounded-lg border border-[#E5E9E6] bg-white px-3 text-sm text-[#171A18] outline-none transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-[#949D97] focus:border-[#07813F] focus:ring-2 focus:ring-[#07813F]/10 disabled:bg-[#F2F4F3]"
                disabled={isSending}
                id="campaign-test-phone"
                inputMode="tel"
                onChange={(event) => setRecipientPhoneNumber(event.target.value)}
                placeholder="06 12 34 56 78"
                required
                type="tel"
                value={recipientPhoneNumber}
              />
              <p className="mt-2 text-xs text-[#66706A]">
                French, US, and Canadian numbers are supported. You can send up to 3 tests per hour.
              </p>
            </div>

            <div className="rounded-xl border border-[#E5E9E6] bg-[#FBFCFB] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-[#171A18]">First message preview</span>
                <span className="text-xs text-[#66706A]">
                  {estimatedSegments} {estimatedSegments === 1 ? "SMS segment" : "SMS segments"}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-[#171A18]">{preview || "No message added yet."}</p>
              <p className="mt-3 text-xs text-[#66706A]">
                Personalization uses Test, Contact, and Riink for this preview.
              </p>
            </div>

            {!phoneNumberId ? (
              <div className="rounded-lg border border-[#F8C4C4] bg-[#FDECEC] px-3 py-2 text-xs font-medium text-[#DA4545]" role="alert">
                Select a ready sending number first.
              </div>
            ) : null}

            {notice ? (
              <div
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  notice.ok
                    ? "border-[#C2E8D2] bg-[#E9F5EE] text-[#07813F]"
                    : "border-[#F8C4C4] bg-[#FDECEC] text-[#DA4545]"
                }`}
                role={notice.ok ? "status" : "alert"}
              >
                {notice.message}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-[#EEF0EE] p-5">
            <button
              className="h-10 rounded-lg border border-[#E5E9E6] bg-white px-3 text-sm font-semibold text-[#171A18] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#F2F4F3] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#07813F]/30 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSending}
              onClick={close}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#07813F] px-3 text-sm font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#096D38] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#07813F]/30 disabled:cursor-not-allowed disabled:bg-[#949D97] disabled:text-white"
              disabled={isSending || !phoneNumberId || !preview || !recipientPhoneNumber.trim()}
              type="submit"
            >
              <Send size={16} />
              <span>{isSending ? "Sending test..." : "Send test"}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
