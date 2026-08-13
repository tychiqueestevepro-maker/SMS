"use client";

import Link from "next/link";

import { AlertTriangle, CheckCircle2, CreditCard, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createBillingPortalSession,
  createBillingSetupSession,
  requestBillingCancellation,
  updateSafetyCapAction,
} from "@/app/(app)/settings/billing-actions";
import type {
  BillingSettingsData,
  BillingSetupActionSuccess,
} from "@/components/billing/types";
import { PaymentMethodDialog } from "@/components/billing/payment-method-dialog";
import { Modal } from "@/components/contacts/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatMonthlyPrice(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    currency: "USD",
    style: "currency",
  });
}

function formatCreditPrice(amountMicroUsd: number) {
  return (amountMicroUsd / 1_000_000).toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
    style: "currency",
  });
}

function subscriptionTone(status: BillingSettingsData["subscription"]["status"]) {
  if (status === "active") return "success" as const;
  if (status === "attention_required" || status === "grace_period") return "warning" as const;
  return "neutral" as const;
}

export function BillingSettingsPanel({ data }: { data: BillingSettingsData }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ message: string; tone: "error" | "success" } | null>(null);
  const [setupSession, setSetupSession] = useState<BillingSetupActionSuccess | null>(null);
  const [showCancellationConfirmation, setShowCancellationConfirmation] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitInput, setLimitInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const { paymentMethod, plan, subscription, usage } = data;
  const usagePercent = usage?.includedCredits
    ? Math.min(100, Math.round((usage.usedCredits / usage.includedCredits) * 100))
    : 0;

  function openSetupSession() {
    setNotice(null);
    startTransition(async () => {
      const result = await createBillingSetupSession();
      if (!result.ok) {
        setNotice({ message: result.message, tone: "error" });
        return;
      }
      if (!result.clientSecret.trim() || !result.publishableKey.trim()) {
        setNotice({
          message: "Billing setup is temporarily unavailable. Please try again later.",
          tone: "error",
        });
        return;
      }
      setSetupSession(result);
    });
  }

  function openPortalSession() {
    setNotice(null);
    startTransition(async () => {
      const result = await createBillingPortalSession();
      if (!result.ok) {
        setNotice({ message: result.message, tone: "error" });
        return;
      }
      window.location.assign(result.redirectUrl);
    });
  }

  function completePaymentSetup() {
    setSetupSession(null);
    setNotice({ message: "Payment method saved.", tone: "success" });
    router.refresh();
  }

  function scheduleCancellation() {
    setNotice(null);
    startTransition(async () => {
      const result = await requestBillingCancellation();
      setShowCancellationConfirmation(false);
      if (!result.ok) {
        setNotice({ message: result.message, tone: "error" });
        return;
      }
      setNotice({ message: result.message, tone: "success" });
      router.refresh();
    });
  }

  return (
    <>
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        {usage ? (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#26342b]">{usage.title}</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#17211b]">
                  {usage.primaryText}
                </p>
                {usage.additionalCreditsText ? (
                  <p className="mt-2 text-sm font-medium text-[#536159]">
                    {usage.additionalCreditsText}
                  </p>
                ) : null}
                {usage.additionalUsageText ? (
                  <p className="mt-1 text-sm font-semibold text-[#26342b]">
                    {usage.additionalUsageText}
                  </p>
                ) : null}
              </div>
              <span className="pb-1 text-xs font-semibold text-[#587064]">
                {usagePercent}%
              </span>
            </div>
            <div
              aria-label={`${usagePercent}% of included SMS credits used`}
              aria-valuemax={usage.includedCredits}
              aria-valuemin={0}
              aria-valuenow={Math.min(usage.usedCredits, usage.includedCredits)}
              className="mt-4 h-2 overflow-hidden rounded-full bg-[#e8ede9]"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-[#2e7d57]"
                style={{ width: `${usagePercent}%` }}
              />
            </div>

            {usage.warning ? (
              <div
                className={`mt-4 flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm ${
                  usage.warning.level === "100"
                    ? "border-[#efd6a8] bg-[#fff8e8] text-[#795116]"
                    : "border-[#dbe5de] bg-[#f5f8f6] text-[#536159]"
                }`}
                role="status"
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
                {usage.warning.text}
              </div>
            ) : null}

            {usage.safetyCapReached ? (
              <div
                className="mt-4 flex items-start gap-2 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3.5 py-3 text-sm text-[#8f312a]"
                role="alert"
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
                Sending is paused because your SMS credit safety limit has been reached.
              </div>
            ) : null}

            <p className="mt-4 flex max-w-lg items-start gap-2 text-xs leading-5 text-[#7a857e]">
              <Info aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
              {usage.helperText}
            </p>

            <div className="mt-4 flex items-center justify-between rounded-lg border border-[#e1e5e3] bg-[#f9faf9] p-3 sm:px-4">
              <div>
                <p className="text-sm font-medium text-[#26342b]">Monthly SMS Limit (Safety Cap)</p>
                <p className="mt-0.5 text-xs text-[#536159]">
                  {usage.safetyCapCredits.toLocaleString("en-US")} credits
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => { setLimitInput(usage.safetyCapCredits.toString()); setShowLimitModal(true); }}>
                Edit
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-[#d8dfda] bg-[#fafbfa] px-5 py-10 text-center">
            <p className="text-sm font-semibold text-[#26342b]">SMS usage</p>
            <p className="mt-2 text-sm text-[#68736c]">
              Current SMS usage is temporarily unavailable.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#dfe6e1] bg-[#f6f9f7] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#26342b]">Riink monthly</p>
            <p className="mt-1 text-xs text-[#68736c]">Current plan</p>
          </div>
          <Badge tone={subscriptionTone(subscription.status)}>{subscription.label}</Badge>
        </div>

        {plan ? (
          <>
            <p className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-[#17211b]">
              {formatMonthlyPrice(plan.monthlyPriceCents)}
              <span className="text-sm font-normal text-[#68736c]"> / month</span>
            </p>
            <div className="mt-5 border-t border-[#dfe6e1] pt-4 text-xs leading-5 text-[#637068]">
              {plan.includedCredits.toLocaleString("en-US")} SMS credits included. Additional
              credits are {formatCreditPrice(plan.additionalCreditPriceMicroUsd)} each.
            </div>
          </>
        ) : (
          <p className="mt-5 text-sm text-[#68736c]">Plan details are temporarily unavailable.</p>
        )}

        <p className="mt-4 text-xs leading-5 text-[#68736c]">{subscription.description}</p>

        <div className="mt-5 border-t border-[#dfe6e1] pt-4">
          <div className="flex items-center gap-2">
            {paymentMethod.status === "saved" ? (
              <CheckCircle2 aria-hidden="true" className="text-[#2e7d57]" size={16} />
            ) : (
              <CreditCard aria-hidden="true" className="text-[#68736c]" size={16} />
            )}
            <div>
              <p className="text-xs font-semibold text-[#26342b]">Payment method</p>
              <p className="mt-0.5 text-xs text-[#68736c]">{paymentMethod.label}</p>
            </div>
          </div>

          {subscription.canSetUpPayment && subscription.status !== "awaiting_number" ? (
            <Button
              className="mt-4 w-full"
              disabled={isPending}
              onClick={openSetupSession}
              size="sm"
            >
              Add payment method
            </Button>
          ) : null}
          {subscription.status === "awaiting_number" ? (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-[#e1e5e3] bg-[#f9faf9] p-3 sm:px-4">
              <div>
                <p className="text-sm font-medium text-[#26342b]">Phone number required</p>
                <p className="mt-0.5 text-xs text-[#536159]">
                  Get a phone number to activate your subscription.
                </p>
              </div>
              <Link href="#numbers">
                <Button size="sm" variant="secondary">
                  Get a number
                </Button>
              </Link>
            </div>
          ) : null}
          {subscription.canManageBilling ? (
            <Button
              className="mt-4 w-full"
              disabled={isPending}
              onClick={openPortalSession}
              size="sm"
              variant="secondary"
            >
              Manage billing
            </Button>
          ) : null}
          {subscription.canCancel ? (
            <Button
              className="mt-3 w-full"
              disabled={isPending}
              onClick={() => {
                setNotice(null);
                setShowCancellationConfirmation(true);
              }}
              size="sm"
              variant="ghost"
            >
              Cancel plan
            </Button>
          ) : null}
          {notice ? (
            <p
              className={`mt-3 text-xs leading-5 ${notice.tone === "success" ? "text-[#246b4a]" : "text-[#8f312a]"}`}
              role={notice.tone === "success" ? "status" : "alert"}
            >
              {notice.message}
            </p>
          ) : null}
        </div>
      </div>
      </div>
      {setupSession ? (
        <PaymentMethodDialog
          onClose={() => setSetupSession(null)}
          onComplete={completePaymentSetup}
          session={setupSession}
        />
      ) : null}
      <Modal
        description="Your plan will remain available through the end of the current billing period. A seven-day grace period follows."
        onClose={() => {
          if (!isPending) setShowCancellationConfirmation(false);
        }}
        open={showCancellationConfirmation}
        title="Cancel Riink plan?"
      >
        <div className="flex justify-end gap-3 px-5 py-4 sm:px-6">
          <Button
            onClick={() => setShowCancellationConfirmation(false)}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button disabled={isPending} onClick={scheduleCancellation} type="button" variant="danger">
            {isPending ? "Scheduling..." : "Schedule cancellation"}
          </Button>
        </div>
      </Modal>

      <Modal onClose={() => setShowLimitModal(false)} open={showLimitModal} title="Edit Monthly SMS Limit">
        <form
          action={() => {
            const val = parseInt(limitInput, 10);
            if (isNaN(val) || val < (plan?.includedCredits ?? 0)) {
               setNotice({ message: `Limit must be at least ${plan?.includedCredits ?? 0} (included in plan).`, tone: "error" });
               return;
            }
            startTransition(async () => {
              const res = await updateSafetyCapAction(val);
              if (res.ok) {
                 setShowLimitModal(false);
                 setNotice({ message: "Safety cap updated.", tone: "success" });
                 router.refresh();
              } else {
                 setNotice({ message: res.message || "Failed to update safety cap.", tone: "error" });
              }
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5 px-5 pt-4 sm:px-6">
            <label className="text-sm font-medium text-[#26342b]">
              New safety cap (SMS credits)
            </label>
            <input
              className="w-full rounded-md border border-[#e2e7e3] px-3 py-2 text-sm text-[#26342b] outline-none transition-colors focus:border-[#2e7d57]"
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="e.g. 10000"
              required
              type="number"
              value={limitInput}
            />
            <p className="text-xs text-[#7a857e]">
              Must be at least {plan?.includedCredits.toLocaleString() ?? 0} credits.
            </p>
          </div>
          <div className="flex justify-end gap-3 px-5 py-4 sm:px-6">
            <Button
              onClick={() => setShowLimitModal(false)}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button disabled={isPending} type="submit">
              {isPending ? "Saving..." : "Save limit"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
