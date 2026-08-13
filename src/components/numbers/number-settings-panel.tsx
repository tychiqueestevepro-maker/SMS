"use client";

import { ArrowDownToLine, Phone, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { removePhoneNumberAction } from "@/app/(app)/settings/numbers-actions";
import { Modal } from "@/components/contacts/modal";
import { NumberImportDialog } from "@/components/numbers/number-import-dialog";
import { NumberOnboardingDialog } from "@/components/numbers/number-onboarding-dialog";
import type { NumberActionResult, NumberSettingsData } from "@/components/numbers/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { numberProductError } from "@/lib/numbers/errors";
import type { NumberClientDto } from "@/lib/numbers/product-types";

function formatPhone(phone: string) {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}

export function NumberSettingsPanel({ initialData }: { initialData: NumberSettingsData }) {
  const router = useRouter();
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [removing, setRemoving] = useState<NumberClientDto | null>(null);
  const [notice, setNotice] = useState<NumberActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function result(actionResult: NumberActionResult) {
    setNotice(actionResult);
    if (actionResult.ok) router.refresh();
  }

  function removeNumber() {
    if (!removing) return;
    startTransition(async () => {
      const actionResult = await removePhoneNumberAction(removing.id);
      result(actionResult);
      if (actionResult.ok) setRemoving(null);
    });
  }

  const atLimit = initialData.includedNumberUnavailableReason === "limit";

  return (
    <div className="p-5 sm:p-6">
      {notice ? (
        <div
          className={`mb-4 rounded-lg border px-3.5 py-3 text-sm ${
            notice.ok
              ? "border-[#cce2d3] bg-[#eff8f2] text-[#235f43]"
              : "border-[#f0cbc6] bg-[#fff3f1] text-[#8f312a]"
          }`}
          role={notice.ok ? "status" : "alert"}
        >
          {notice.message}
        </div>
      ) : null}

      {/* Header row: counter + action buttons */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium text-[#738078]">
          {initialData.includedNumberCount} of {initialData.maxPhoneNumbers || "—"} numbers
        </p>
        <div className="flex items-center gap-2">
          {/* Import existing number — always visible */}
          <Button
            onClick={() => {
              setNotice(null);
              setImportOpen(true);
            }}
            size="sm"
            variant="secondary"
          >
            <ArrowDownToLine aria-hidden="true" size={15} />
            Import a number
          </Button>

          {/* Get a new provider number — disabled only when at plan limit */}
          <Button
            disabled={atLimit}
            onClick={() => {
              setNotice(null);
              setOnboardingOpen(true);
            }}
            size="sm"
          >
            <Plus aria-hidden="true" size={15} />
            Get a number
          </Button>
        </div>
      </div>

      {/* Phone number list */}
      {initialData.numbers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#d8dfda] bg-[#fafbfa] px-5 py-10 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#edf3ef] text-[#246b4a]">
            <Phone aria-hidden="true" size={19} />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-[#26342b]">No phone numbers yet</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-[#68736c]">
            Get a new number or import one you already own.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {initialData.numbers.map((number) => (
            <div className="rounded-xl border border-[#e2e7e3] bg-[#fafbfa] p-4" key={number.id}>
              <div className="flex items-start gap-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#edf3ef] text-[#246b4a]">
                  <Phone aria-hidden="true" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[#26342b]">{formatPhone(number.phoneNumber)}</p>
                    <Badge tone={number.status === "ready" ? "success" : "warning"}>
                      {number.statusLabel}
                    </Badge>
                    {number.isDefault ? <Badge>Default</Badge> : null}
                  </div>
                  {number.setup ? (
                    <div className="mt-2">
                      <p className="text-sm font-semibold text-[#536159]">{number.setup.title}</p>
                      <p className="mt-1 max-w-xl text-sm leading-6 text-[#68736c]">
                        {number.setup.description}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#7a857e]">
                        You can keep adding contacts and saving campaign drafts while setup is in
                        progress.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-sm text-[#68736c]">
                      Ready for campaigns and Inbox conversations.
                    </p>
                  )}
                </div>
                <button
                  aria-label={`Remove ${formatPhone(number.phoneNumber)}`}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-[#879189] hover:bg-[#fff0ee] hover:text-[#b33b32]"
                  onClick={() => {
                    setNotice(null);
                    setRemoving(number);
                  }}
                  title="Remove phone number"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* At-limit notice */}
      {atLimit ? (
        <p className="mt-4 rounded-lg bg-[#f4f6f4] px-3.5 py-3 text-xs leading-5 text-[#68736c]">
          {numberProductError("PHONE_NUMBER_LIMIT_REACHED").message}
        </p>
      ) : null}

      {/* Get a number dialog */}
      <NumberOnboardingDialog
        billingPublishableKey={initialData.billingPublishableKey}
        needsBillingSetup={initialData.needsBillingSetup}
        onClose={() => setOnboardingOpen(false)}
        onComplete={result}
        open={onboardingOpen}
      />

      {/* Import a number dialog */}
      <NumberImportDialog
        billingPublishableKey={initialData.billingPublishableKey}
        needsBillingSetup={initialData.needsBillingSetup}
        onClose={() => setImportOpen(false)}
        onComplete={result}
        open={importOpen}
      />

      {/* Remove confirmation modal */}
      <Modal
        description="This number will no longer be available for campaigns or conversations."
        onClose={() => {
          if (!isPending) setRemoving(null);
        }}
        open={Boolean(removing)}
        title="Remove phone number?"
      >
        <div className="p-5 sm:p-6">
          <p className="text-sm leading-6 text-[#536159]">
            Remove{" "}
            <span className="font-semibold text-[#26342b]">
              {removing ? formatPhone(removing.phoneNumber) : "this number"}
            </span>
            ? This cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
          <Button disabled={isPending} onClick={() => setRemoving(null)} variant="secondary">
            Cancel
          </Button>
          <Button disabled={isPending} onClick={removeNumber} variant="danger">
            Remove number
          </Button>
        </div>
      </Modal>
    </div>
  );
}
