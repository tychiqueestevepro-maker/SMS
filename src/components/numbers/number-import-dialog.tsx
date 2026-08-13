"use client";

import { ArrowDownToLine, ArrowLeft, Check, LoaderCircle, Phone } from "lucide-react";
import { useState, useTransition } from "react";

import { createBillingSetupSession, confirmPaymentSetupAction } from "@/app/(app)/settings/billing-actions";
import {
  checkNumberImportEligibilityAction,
  requestFrenchNumberImportAction,
  startNumberImportAction,
} from "@/app/(app)/settings/numbers-actions";
import { Modal } from "@/components/contacts/modal";
import type { NumberActionResult } from "@/components/numbers/types";
import { Button } from "@/components/ui/button";
import { Elements, PaymentElement, loadStripe, useElements, useStripe } from "@/lib/providers/stripe/browser";

type NumberImportDialogProps = {
  onClose: () => void;
  onComplete: (result: NumberActionResult) => void;
  open: boolean;
  needsBillingSetup: boolean;
  billingPublishableKey: string | null;
};

const baseInputClass =
  "h-10 w-full rounded-lg border bg-white px-3 text-sm text-[#26342b] shadow-sm placeholder:text-[#9aa39d] focus:outline-none focus:ring-3 border-[#dbe2dd] focus:border-[#2e7d57] focus:ring-[#d8ebe0]";

// ---------------------------------------------------------------------------
// Payment step (inside Stripe Elements context)
// ---------------------------------------------------------------------------
function PaymentStep({
  onSuccess,
  onBack,
  isPending,
}: {
  onSuccess: () => void;
  onBack: () => void;
  isPending: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [confirming, startConfirm] = useTransition();

  function confirmPayment() {
    if (!stripe || !elements) return;
    setError(null);
    startConfirm(async () => {
      // 1. Confirm the SetupIntent client-side with Stripe
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });
      if (confirmError) {
        setError(confirmError.message ?? "Payment confirmation failed. Please try again.");
        return;
      }
      // 2. Save the payment method synchronously in our DB (no webhook timing issue)
      const saved = await confirmPaymentSetupAction(setupIntent?.id ?? "");
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      // 3. The saved card lets the import start. Billing begins only when the number is Ready.
      onSuccess();
    });
  }

  const busy = isPending || confirming;

  return (
    <div>
      <div className="p-5 sm:p-6">
        <h3 className="text-base font-semibold text-[#26342b]">Add a payment method</h3>
        <p className="mt-1 text-sm text-[#738078]">
          Billing starts once your number is active. You won&apos;t be charged during the import
          process.
        </p>
        <div className="mt-5 rounded-xl border border-[#dbe2dd] bg-white p-4">
          <PaymentElement />
        </div>
        {error ? (
          <p className="mt-4 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3 py-2.5 text-sm text-[#8f312a]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-between gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
        <Button disabled={busy} onClick={onBack} variant="secondary">
          <ArrowLeft aria-hidden="true" size={14} />
          Back
        </Button>
        <Button disabled={busy || !stripe} onClick={confirmPayment}>
          {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} /> : null}
          Save payment method
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main import dialog
// ---------------------------------------------------------------------------
export function NumberImportDialog({
  onClose,
  onComplete,
  open,
  needsBillingSetup,
  billingPublishableKey,
}: NumberImportDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [country, setCountry] = useState<"US" | "CA" | "FR">("US");
  const [phone, setPhone] = useState("");
  const [eligibilityToken, setEligibilityToken] = useState<string | null>(null);
  const [manualImport, setManualImport] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const totalSteps = country === "FR" ? 2 : needsBillingSetup ? 3 : 2;

  function reset() {
    setStep(1);
    setCountry("US");
    setPhone("");
    setEligibilityToken(null);
    setManualImport(false);
    setEmail("");
    setError(null);
    setStripeClientSecret(null);
    setPaymentConfirmed(false);
  }

  function close() {
    if (isPending) return;
    reset();
    onClose();
  }

  function checkEligibility(formData: FormData) {
    const phoneValue = String(formData.get("phone") ?? "");
    const countryValue = String(formData.get("country") ?? "US") as "US" | "CA" | "FR";
    setError(null);
    startTransition(async () => {
      const result = await checkNumberImportEligibilityAction(phoneValue, countryValue);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (!result.eligibilityToken && !result.manualImport) {
        setError("This number is not eligible for import.");
        return;
      }
      setCountry(countryValue);
      setPhone(result.phoneNumber ?? phoneValue);
      setEligibilityToken(result.eligibilityToken ?? null);
      setManualImport(Boolean(result.manualImport));
      setStep(2);
    });
  }

  function submitEmail(formData: FormData) {
    const emailValue = String(formData.get("email") ?? "");
    setError(null);

    if (!manualImport && needsBillingSetup && !paymentConfirmed) {
      // Fetch SetupIntent before going to payment step.
      setEmail(emailValue);
      startTransition(async () => {
        const session = await createBillingSetupSession();
        if (!session.ok) {
          setError(session.message);
          return;
        }
        setStripeClientSecret(session.clientSecret);
        setStep(3);
      });
      return;
    }

    // The card is already saved or the subscription is active, so the import can start.
    submitImport(emailValue);
  }

  function submitImport(emailValue: string) {
    if (!manualImport && !eligibilityToken) return;
    setError(null);
    startTransition(async () => {
      const result = manualImport
        ? await requestFrenchNumberImportAction(phone, emailValue)
        : await startNumberImportAction(eligibilityToken!, emailValue);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onComplete(result);
      reset();
      onClose();
    });
  }

  function onPaymentConfirmed() {
    setPaymentConfirmed(true);
    submitImport(email);
  }

  const stepLabels =
    totalSteps === 3
      ? ["Your number", "Confirm", "Card details"]
      : ["Your number", "Confirm"];

  const stripePromise =
    needsBillingSetup && billingPublishableKey ? loadStripe(billingPublishableKey) : null;

  return (
    <Modal
      description="Transfer a number you already own into your Riink workspace."
      onClose={close}
      open={open}
      title="Import a number"
    >
      {/* Step indicator */}
      <div className="border-b border-[#e7ebe8] bg-[#fafbfa] px-5 py-3 sm:px-6">
        <ol className="flex items-center justify-center gap-2 sm:gap-6">
          {stepLabels.map((label, index) => {
            const number = index + 1;
            const active = step === number;
            const complete = step > number;
            return (
              <li className="flex items-center gap-2" key={label}>
                {index > 0 ? <span className="hidden h-px w-8 bg-[#dbe2dd] sm:block" /> : null}
                <span
                  className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                    active
                      ? "bg-[#246b4a] text-white"
                      : complete
                        ? "bg-[#dceee3] text-[#246b4a]"
                        : "bg-[#edf0ee] text-[#879189]"
                  }`}
                >
                  {complete ? <Check aria-hidden="true" size={12} /> : number}
                </span>
                <span className={`hidden text-xs font-semibold sm:block ${active ? "text-[#26342b]" : "text-[#7a857e]"}`}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Step 1 — Enter number */}
      {step === 1 ? (
        <form action={checkEligibility}>
          <div className="p-5 sm:p-6">
            <div className="mb-6 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[#eaf3ed] text-[#246b4a]">
                <ArrowDownToLine aria-hidden="true" size={20} />
              </span>
              <h3 className="mt-4 text-base font-semibold text-[#26342b]">Enter your number</h3>
              <p className="mt-1 text-sm text-[#738078]">
                We&apos;ll check if your number can be transferred to Riink.
              </p>
            </div>

            <div className="space-y-4">
              <label>
                <span className="mb-1.5 block text-sm font-medium text-[#344139]">Country</span>
                <select
                  className={baseInputClass}
                  name="country"
                  onChange={(event) => {
                    setCountry(event.target.value as "US" | "CA" | "FR");
                    setError(null);
                  }}
                  value={country}
                >
                  <option value="US">United States (+1)</option>
                  <option value="CA">Canada (+1)</option>
                  <option value="FR">France (+33)</option>
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-medium text-[#344139]">Phone number</span>
                <input
                  autoFocus
                  className={baseInputClass}
                  defaultValue={phone}
                  inputMode="tel"
                  name="phone"
                  placeholder={country === "FR" ? "01 23 45 67 89" : "(512) 555-0192"}
                  required
                  type="tel"
                />
              </label>
            </div>

            {error ? (
              <p className="mt-4 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3 py-2.5 text-sm text-[#8f312a]" role="alert">
                {error}
              </p>
            ) : null}

            <div className="mt-6 rounded-xl border border-[#dce6df] bg-[#f4f8f5] px-4 py-3 text-xs leading-5 text-[#5f6c64]">
              {country === "FR"
                ? "French porting is reviewed manually and can take several weeks. Keep your current carrier service active until the transfer is complete."
                : "Number import can take 2 to 5 business days and requires your current carrier to release the number. An automated call will verify ownership."}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
            <Button disabled={isPending} onClick={close} variant="secondary">
              Cancel
            </Button>
            <Button disabled={isPending} type="submit">
              {isPending ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} /> : null}
              Check eligibility
            </Button>
          </div>
        </form>
      ) : null}

      {/* Step 2 — Confirm & email */}
      {step === 2 ? (
        <form action={submitEmail}>
          <div className="p-5 sm:p-6">
            <div className="mb-6 flex items-center gap-4 rounded-xl border border-[#d3e9db] bg-[#f0f8f3] p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#daeee2] text-[#246b4a]">
                <Phone aria-hidden="true" size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-[#26342b]">{phone}</p>
                <p className="mt-0.5 text-xs text-[#5f6c64]">
                  <Check aria-hidden="true" className="mr-1 inline text-[#246b4a]" size={11} />
                  {manualImport ? "Ready for manual porting review" : "Eligible for import"}
                </p>
              </div>
              <Button className="ml-auto" onClick={() => setStep(1)} size="sm" type="button" variant="ghost">
                Change
              </Button>
            </div>

            <label>
              <span className="mb-1.5 block text-sm font-medium text-[#344139]">
                Contact email
              </span>
              <input
                autoFocus
                className={baseInputClass}
                defaultValue={email}
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />
              <p className="mt-1.5 text-xs text-[#738078]">
                {manualImport
                  ? "We will use this email to request the SIRET, RIO, carrier details, address and compliance documents."
                  : "Our messaging provider may contact this email for ownership verification documents."}
              </p>
            </label>

            {error ? (
              <p className="mt-4 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3 py-2.5 text-sm text-[#8f312a]" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-between gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
            <Button disabled={isPending} onClick={() => setStep(1)} variant="secondary">
              <ArrowLeft aria-hidden="true" size={14} />
              Back
            </Button>
            <Button disabled={isPending} type="submit">
              {isPending ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} /> : null}
              {manualImport
                ? "Send porting request"
                : needsBillingSetup
                  ? "Continue to card setup"
                  : "Start import"}
            </Button>
          </div>
        </form>
      ) : null}

      {/* Step 3: save a card without starting billing. */}
      {step === 3 && !manualImport && stripeClientSecret && stripePromise ? (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret: stripeClientSecret,
            appearance: {
              theme: "stripe",
              variables: {
                colorPrimary: "#246b4a",
                borderRadius: "8px",
                fontFamily: "inherit",
              },
            },
          }}
        >
          <PaymentStep
            isPending={isPending}
            onBack={() => setStep(2)}
            onSuccess={onPaymentConfirmed}
          />
        </Elements>
      ) : null}
    </Modal>
  );
}
