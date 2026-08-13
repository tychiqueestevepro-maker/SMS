"use client";

import { ArrowLeft, Check, LoaderCircle, MapPin, Search } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import {
  createBillingSetupSession,
  confirmPaymentSetupAction,
} from "@/app/(app)/settings/billing-actions";
import {
  searchAvailableNumbersAction,
  startNumberOnboardingWithPaymentAction,
} from "@/app/(app)/settings/numbers-actions";
import { Modal } from "@/components/contacts/modal";
import type { NumberActionResult } from "@/components/numbers/types";
import { Button } from "@/components/ui/button";
import { Elements, PaymentElement, loadStripe, useElements, useStripe } from "@/lib/providers/stripe/browser";
import {
  BUSINESS_VERIFICATION_DESCRIPTION,
  BUSINESS_VERIFICATION_TITLE,
  type BusinessVerificationField,
  type BusinessVerificationInput,
} from "@/lib/numbers/business";
import type { NumberSearchCandidateDto } from "@/lib/numbers/product-types";

type NumberOnboardingDialogProps = {
  onClose: () => void;
  onComplete: (result: NumberActionResult) => void;
  open: boolean;
  /** True when the user has not yet saved a payment method. */
  needsBillingSetup: boolean;
  /** Stripe publishable key — required when needsBillingSetup is true. */
  billingPublishableKey: string | null;
};

const baseInputClass =
  "h-10 w-full rounded-lg border bg-white px-3 text-sm text-[#26342b] shadow-sm placeholder:text-[#9aa39d] focus:outline-none focus:ring-3";

function formatPhone(phone: string) {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  const french = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(phone);
  return french
    ? `0${french[1]} ${french[2]} ${french[3]} ${french[4]} ${french[5]}`
    : phone;
}

// ---------------------------------------------------------------------------
// Payment step inner component (needs Stripe context)
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
      // 1. Confirm the SetupIntent client-side
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });
      if (confirmError) {
        setError(confirmError.message ?? "Payment confirmation failed. Please try again.");
        return;
      }
      // 2. Save payment method synchronously in DB before activating subscription
      const saved = await confirmPaymentSetupAction(setupIntent?.id ?? "");
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      // 3. Payment method persisted → parent activates subscription + provisions number
      onSuccess();
    });
  }

  const busy = isPending || confirming;

  return (
    <div>
      <div className="p-5 sm:p-6">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-[#26342b]">Add a payment method</h3>
          <p className="mt-1 text-sm text-[#738078]">
            Billing starts when your number is ready. You won&apos;t be charged during setup.
          </p>
        </div>
        <div className="rounded-xl border border-[#dbe2dd] bg-white p-4">
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
          Confirm payment method
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------
export function NumberOnboardingDialog({
  onClose,
  onComplete,
  open,
  needsBillingSetup,
  billingPublishableKey,
}: NumberOnboardingDialogProps) {
  // Steps: 1=area code, 2=pick number, 3=business, 4=payment (conditional)
  const totalSteps = needsBillingSetup ? 4 : 3;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [countryCode, setCountryCode] = useState<"US" | "FR">("US");
  const [areaCode, setAreaCode] = useState("");
  const [candidates, setCandidates] = useState<NumberSearchCandidateDto[]>([]);
  const [selected, setSelected] = useState<NumberSearchCandidateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Set<BusinessVerificationField>>(new Set());
  const [isPending, startTransition] = useTransition();
  // We hold the business FormData between step 3 → 4 so we can submit after payment.
  const pendingBusinessRef = useRef<{ selectionId: string; business: BusinessVerificationInput } | null>(null);
  // Stripe setup state (only used when needsBillingSetup)
  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  function reset() {
    setStep(1);
    setCountryCode("US");
    setAreaCode("");
    setCandidates([]);
    setSelected(null);
    setError(null);
    setFieldErrors(new Set());
    pendingBusinessRef.current = null;
    setStripeClientSecret(null);
    setPaymentConfirmed(false);
  }

  function close() {
    if (isPending) return;
    reset();
    onClose();
  }

  function searchNumbers(formData: FormData) {
    const value = String(formData.get("areaCode") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await searchAvailableNumbersAction(
        countryCode,
        value,
        crypto.randomUUID(),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAreaCode(value);
      setCandidates(result.candidates ?? []);
      setStep(2);
    });
  }

  function submitBusiness(formData: FormData) {
    if (!selected) return;
    const business: BusinessVerificationInput = {
      countryCode,
      businessAddress: {
        city: String(formData.get("city") ?? ""),
        line1: String(formData.get("line1") ?? ""),
        line2: String(formData.get("line2") ?? ""),
        postalCode: String(formData.get("postalCode") ?? ""),
        state: String(formData.get("state") ?? ""),
      },
      contactName: String(formData.get("contactName") ?? ""),
      ein: String(formData.get("ein") ?? ""),
      email: String(formData.get("email") ?? ""),
      legalBusinessName: String(formData.get("legalBusinessName") ?? ""),
      messagingUseCase: String(formData.get("messagingUseCase") ?? ""),
      optInMethod: String(formData.get("optInMethod") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      privacyPolicy: String(formData.get("privacyPolicy") ?? ""),
      sampleMessages: [
        String(formData.get("sampleMessage1") ?? ""),
        String(formData.get("sampleMessage2") ?? ""),
      ],
      terms: String(formData.get("terms") ?? ""),
      website: String(formData.get("website") ?? ""),
    };
    setError(null);
    setFieldErrors(new Set());

    if (needsBillingSetup && !paymentConfirmed) {
      // Need to collect payment first — fetch a SetupIntent client secret.
      startTransition(async () => {
        const session = await createBillingSetupSession();
        if (!session.ok) {
          setError(session.message);
          return;
        }
        pendingBusinessRef.current = { selectionId: selected.selectionId, business };
        setStripeClientSecret(session.clientSecret);
        setStep(4);
      });
      return;
    }

    // Payment already confirmed or not needed — go straight to onboarding.
    startTransition(async () => {
      const result = await startNumberOnboardingWithPaymentAction(selected.selectionId, business);
      if (!result.ok) {
        setError(result.message);
        setFieldErrors(new Set(result.fieldErrors ?? []));
        return;
      }
      onComplete(result);
      reset();
      onClose();
    });
  }

  function onPaymentConfirmed() {
    setPaymentConfirmed(true);
    const pending = pendingBusinessRef.current;
    if (!pending) return;
    setError(null);
    startTransition(async () => {
      const result = await startNumberOnboardingWithPaymentAction(
        pending.selectionId,
        pending.business,
      );
      if (!result.ok) {
        setError(result.message);
        setFieldErrors(new Set(result.fieldErrors ?? []));
        setStep(3);
        return;
      }
      onComplete(result);
      reset();
      onClose();
    });
  }

  function inputClass(field: BusinessVerificationField) {
    return `${baseInputClass} ${
      fieldErrors.has(field)
        ? "border-[#dc8f87] focus:border-[#b33b32] focus:ring-[#f6d9d5]"
        : "border-[#dbe2dd] focus:border-[#2e7d57] focus:ring-[#d8ebe0]"
    }`;
  }

  const stepLabels =
    totalSteps === 4
      ? ["Location", "Phone number", "Business details", "Payment"]
      : ["Location", "Phone number", "Business details"];

  const stripePromise =
    needsBillingSetup && billingPublishableKey
      ? loadStripe(billingPublishableKey)
      : null;

  return (
    <Modal
      description="Choose a number and provide the details needed to activate it."
      onClose={close}
      open={open}
      title="Get a phone number"
      width="xl"
    >
      {/* Step indicator */}
      <div className="border-b border-[#e7ebe8] bg-[#fafbfa] px-5 py-3 sm:px-6">
        <ol className="flex items-center justify-center gap-2 sm:gap-4">
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
                <span
                  className={`hidden text-xs font-semibold sm:block ${
                    active ? "text-[#26342b]" : "text-[#7a857e]"
                  }`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Step 1 — Area code */}
      {step === 1 ? (
        <form action={searchNumbers}>
          <div className="grid min-h-80 place-items-center p-6 sm:p-10">
            <div className="w-full max-w-md text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[#eaf3ed] text-[#246b4a]">
                <MapPin aria-hidden="true" size={20} />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-[#26342b]">Choose a country</h3>
              <p className="mt-2 text-sm leading-6 text-[#68736c]">
                Search for an SMS number in the United States or France.
              </p>
              <label className="mx-auto mt-6 block max-w-xs text-left">
                <span className="mb-1.5 block text-sm font-medium text-[#344139]">Country</span>
                <select
                  className={`${baseInputClass} border-[#dbe2dd] focus:border-[#2e7d57] focus:ring-[#d8ebe0]`}
                  name="countryCode"
                  onChange={(event) => setCountryCode(event.target.value as "US" | "FR")}
                  value={countryCode}
                >
                  <option value="US">United States (+1)</option>
                  <option value="FR">France (+33)</option>
                </select>
              </label>
              {countryCode === "US" ? (
              <div className="relative mx-auto mt-6 max-w-xs">
                <Search
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#879189]"
                  size={16}
                />
                <input
                  autoFocus
                  className={`${baseInputClass} border-[#dbe2dd] pl-9 text-center text-lg tracking-[0.18em] focus:border-[#2e7d57] focus:ring-[#d8ebe0]`}
                  defaultValue={areaCode}
                  inputMode="numeric"
                  maxLength={3}
                  name="areaCode"
                  pattern="[2-9][0-9]{2}"
                  placeholder="512"
                  required
                />
              </div>
              ) : (
                <div className="mx-auto mt-6 max-w-xs rounded-xl border border-[#dce6df] bg-[#f4f8f5] px-4 py-3 text-left text-xs leading-5 text-[#5f6c64]">
                  We&apos;ll show French numbers enabled for SMS. Activation may require regulatory
                  documents and a review.
                </div>
              )}
              {error ? (
                <p className="mt-4 text-sm text-[#a23a32]" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
            <Button disabled={isPending} onClick={close} variant="secondary">
              Cancel
            </Button>
            <Button disabled={isPending} type="submit">
              {isPending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
              ) : null}
              Search numbers
            </Button>
          </div>
        </form>
      ) : null}

      {/* Step 2 — Pick number */}
      {step === 2 ? (
        <div>
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-[#26342b]">
                  {countryCode === "FR" ? "Available in France" : `Available in ${areaCode}`}
                </h3>
                <p className="mt-1 text-xs text-[#738078]">
                  Choose the number you&apos;d like to use with Riink.
                </p>
              </div>
              <Button onClick={() => setStep(1)} size="sm" variant="ghost">
                <ArrowLeft aria-hidden="true" size={14} />
                Change area
              </Button>
            </div>
            <div className="mt-5 space-y-2">
              {candidates.map((candidate) => (
                <button
                  className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition-colors ${
                    selected?.selectionId === candidate.selectionId
                      ? "border-[#80aa91] bg-[#f1f8f3]"
                      : "border-[#e2e7e3] bg-white hover:border-[#b8c9bd]"
                  }`}
                  key={candidate.selectionId}
                  onClick={() => setSelected(candidate)}
                  type="button"
                >
                  <span>
                    <span className="block text-sm font-semibold text-[#26342b]">
                      {formatPhone(candidate.phoneNumber)}
                    </span>
                    <span className="mt-1 block text-xs text-[#738078]">
                      {[candidate.locality, candidate.region].filter(Boolean).join(", ") ||
                        (candidate.countryCode === "FR" ? "France" : "United States")}
                    </span>
                  </span>
                  <span
                    className={`grid size-5 place-items-center rounded-full border ${
                      selected?.selectionId === candidate.selectionId
                        ? "border-[#246b4a] bg-[#246b4a] text-white"
                        : "border-[#cfd7d1]"
                    }`}
                  >
                    {selected?.selectionId === candidate.selectionId ? (
                      <Check aria-hidden="true" size={12} />
                    ) : null}
                  </span>
                </button>
              ))}
              {candidates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#d8dfda] px-5 py-12 text-center text-sm text-[#68736c]">
                  {countryCode === "FR"
                    ? "No French SMS numbers are currently available."
                    : "No phone numbers were found. Try another area code."}
                </div>
              ) : null}
            </div>
            {error ? (
              <p className="mt-4 text-sm text-[#a23a32]" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-between gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
            <Button disabled={isPending} onClick={() => setStep(1)} variant="secondary">
              Back
            </Button>
            <Button disabled={!selected || isPending} onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {/* Step 3 — Business details */}
      {step === 3 ? (
        <form action={submitBusiness}>
          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#26342b]">
                  {BUSINESS_VERIFICATION_TITLE}
                </h3>
                <p className="mt-1 text-sm text-[#738078]">{BUSINESS_VERIFICATION_DESCRIPTION}</p>
              </div>
              {selected ? (
                <span className="rounded-lg bg-[#edf3ef] px-3 py-2 text-sm font-semibold text-[#246b4a]">
                  {formatPhone(selected.phoneNumber)}
                </span>
              ) : null}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Legal business name" error={fieldErrors.has("legalBusinessName")}>
                <input className={inputClass("legalBusinessName")} name="legalBusinessName" required />
              </Field>
              <Field
                label={countryCode === "FR" ? "SIREN or SIRET" : "EIN"}
                error={fieldErrors.has("ein")}
              >
                <input
                  className={inputClass("ein")}
                  inputMode="numeric"
                  name="ein"
                  placeholder={countryCode === "FR" ? "12345678900012" : "12-3456789"}
                  required
                />
              </Field>
              <Field
                className="sm:col-span-2"
                label="Business address"
                error={fieldErrors.has("businessAddress.line1")}
              >
                <input
                  className={inputClass("businessAddress.line1")}
                  name="line1"
                  placeholder="Street address"
                  required
                />
              </Field>
              <Field
                className="sm:col-span-2"
                label="Suite or unit (optional)"
                error={fieldErrors.has("businessAddress.line2")}
              >
                <input className={inputClass("businessAddress.line2")} name="line2" />
              </Field>
              <Field label="City" error={fieldErrors.has("businessAddress.city")}>
                <input className={inputClass("businessAddress.city")} name="city" required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={countryCode === "FR" ? "Region" : "State"}
                  error={fieldErrors.has("businessAddress.state")}
                >
                  <input
                    autoCapitalize={countryCode === "FR" ? "words" : "characters"}
                    className={inputClass("businessAddress.state")}
                    maxLength={countryCode === "FR" ? 100 : 2}
                    name="state"
                    placeholder={countryCode === "FR" ? "Ile de France" : "TX"}
                    required
                  />
                </Field>
                <Field
                  label={countryCode === "FR" ? "Postal code" : "ZIP code"}
                  error={fieldErrors.has("businessAddress.postalCode")}
                >
                  <input
                    className={inputClass("businessAddress.postalCode")}
                    name="postalCode"
                    placeholder={countryCode === "FR" ? "75001" : "78701"}
                    required
                  />
                </Field>
              </div>
              <Field label="Website" error={fieldErrors.has("website")}>
                <input
                  className={inputClass("website")}
                  name="website"
                  placeholder="https://example.com"
                  required
                  type="url"
                />
              </Field>
              <Field label="Contact name" error={fieldErrors.has("contactName")}>
                <input className={inputClass("contactName")} name="contactName" required />
              </Field>
              <Field label="Email" error={fieldErrors.has("email")}>
                <input className={inputClass("email")} name="email" required type="email" />
              </Field>
              <Field label="Phone" error={fieldErrors.has("phone")}>
                <input
                  className={inputClass("phone")}
                  name="phone"
                  placeholder={countryCode === "FR" ? "06 12 34 56 78" : "(512) 555-0192"}
                  required
                  type="tel"
                />
              </Field>
              <Field
                className="sm:col-span-2"
                label="Messaging use case"
                error={fieldErrors.has("messagingUseCase")}
              >
                <textarea
                  className={`${inputClass("messagingUseCase")} min-h-24 py-2.5`}
                  name="messagingUseCase"
                  placeholder="Describe the messages your business plans to send."
                  required
                />
              </Field>
              <Field
                className="sm:col-span-2"
                label="Opt-in method"
                error={fieldErrors.has("optInMethod")}
              >
                <textarea
                  className={`${inputClass("optInMethod")} min-h-20 py-2.5`}
                  name="optInMethod"
                  placeholder="Explain how contacts agree to receive messages."
                  required
                />
              </Field>
              <Field label="Privacy policy" error={fieldErrors.has("privacyPolicy")}>
                <input
                  className={inputClass("privacyPolicy")}
                  name="privacyPolicy"
                  placeholder="https://example.com/privacy"
                  required
                  type="url"
                />
              </Field>
              <Field label="Terms" error={fieldErrors.has("terms")}>
                <input
                  className={inputClass("terms")}
                  name="terms"
                  placeholder="https://example.com/terms"
                  required
                  type="url"
                />
              </Field>
              <Field
                className="sm:col-span-2"
                label="Sample message"
                error={fieldErrors.has("sampleMessages")}
              >
                <textarea
                  className={`${inputClass("sampleMessages")} min-h-20 py-2.5`}
                  name="sampleMessage1"
                  placeholder="Hi {{first_name}}, this is Alex from Example Co…"
                  required
                />
              </Field>
              <Field className="sm:col-span-2" label="Second sample (optional)">
                <textarea
                  className={`${baseInputClass} min-h-20 border-[#dbe2dd] py-2.5 focus:border-[#2e7d57] focus:ring-[#d8ebe0]`}
                  name="sampleMessage2"
                />
              </Field>
            </div>

            <div className="mt-6 rounded-xl border border-[#dce6df] bg-[#f4f8f5] px-4 py-3 text-xs leading-5 text-[#5f6c64]">
              {countryCode === "FR"
                ? "French number activation is subject to provider availability and regulatory review. We may contact you for supporting documents."
                : needsBillingSetup
                ? "You'll add payment details on the next step. Billing starts when your number is ready."
                : "Billing starts when your number is ready. You won't be charged during number setup."}
            </div>
            {error ? (
              <p
                className="mt-4 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3 py-2.5 text-sm text-[#8f312a]"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-between gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
            <Button disabled={isPending} onClick={() => setStep(2)} variant="secondary">
              Back
            </Button>
            <Button disabled={isPending} type="submit">
              {isPending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
              ) : null}
              {needsBillingSetup ? "Continue to payment" : "Start number setup"}
            </Button>
          </div>
        </form>
      ) : null}

      {/* Step 4 — Payment (only when needsBillingSetup) */}
      {step === 4 && stripeClientSecret && stripePromise ? (
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
            onBack={() => setStep(3)}
            onSuccess={onPaymentConfirmed}
          />
        </Elements>
      ) : null}
    </Modal>
  );
}

function Field({
  children,
  className = "",
  error = false,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  error?: boolean;
  label: string;
}) {
  return (
    <label className={className}>
      <span
        className={`mb-1.5 block text-sm font-medium ${error ? "text-[#a23a32]" : "text-[#344139]"}`}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-[#a23a32]">Check this field.</span>
      ) : null}
    </label>
  );
}
