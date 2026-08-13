"use client";

import {
  CardElement,
  Elements,
  useElements,
  useStripe,
  loadStripe,
} from "@/lib/providers/stripe/browser";
import { useMemo, useState, type FormEvent } from "react";

import { Modal } from "@/components/contacts/modal";
import type { BillingSetupActionSuccess } from "@/components/billing/types";
import { Button } from "@/components/ui/button";
import {
  PAYMENT_DETAILS_INVALID_MESSAGE,
  PAYMENT_METHOD_SAVE_FAILED_MESSAGE,
  paymentSetupErrorMessage,
} from "@/components/billing/payment-errors";

type CardSetupFormProps = {
  clientSecret: string;
  onCancel: () => void;
  onComplete: () => void;
};

const cardOptions = {
  style: {
    base: {
      color: "#26342b",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: "15px",
      fontSmoothing: "antialiased",
      iconColor: "#536159",
      "::placeholder": { color: "#9aa39d" },
    },
    invalid: {
      color: "#8f312a",
      iconColor: "#8f312a",
    },
  },
} as const;

function CardSetupForm({ clientSecret, onCancel, onComplete }: CardSetupFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || isSaving) return;
    const card = elements.getElement(CardElement);
    if (!card) {
      setErrorMessage(PAYMENT_METHOD_SAVE_FAILED_MESSAGE);
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);
    try {
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card },
        return_url: `${window.location.origin}/settings#billing`,
      });
      if (result.error) {
        setErrorMessage(paymentSetupErrorMessage(result.error));
        return;
      }
      if (
        result.setupIntent?.status !== "succeeded" &&
        result.setupIntent?.status !== "processing"
      ) {
        setErrorMessage(PAYMENT_METHOD_SAVE_FAILED_MESSAGE);
        return;
      }
      onComplete();
    } catch (error) {
      setErrorMessage(paymentSetupErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="p-5 sm:p-6">
        <label className="text-sm font-semibold text-[#26342b]" htmlFor="riink-card-details">
          Card details
        </label>
        <div
          className="mt-2 rounded-lg border border-[#d7dfd9] bg-white px-3.5 py-3.5 focus-within:border-[#78a58b] focus-within:ring-2 focus-within:ring-[#dbece1]"
          id="riink-card-details"
        >
          <CardElement
            onChange={(event) => {
              setErrorMessage(event.error ? PAYMENT_DETAILS_INVALID_MESSAGE : null);
            }}
            onLoadError={() => setErrorMessage(PAYMENT_METHOD_SAVE_FAILED_MESSAGE)}
            onReady={() => setIsReady(true)}
            options={cardOptions}
          />
        </div>
        {!isReady && !errorMessage ? (
          <p className="mt-2 text-xs text-[#7a857e]" role="status">Loading card form…</p>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-[#738078]">
          Your card will be saved securely for your Riink subscription. Billing starts when your phone number is ready.
        </p>
        {errorMessage ? (
          <p className="mt-3 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3.5 py-3 text-sm text-[#8f312a]" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
        <Button disabled={isSaving} onClick={onCancel} variant="secondary">
          Cancel
        </Button>
        <Button disabled={!stripe || !elements || !isReady || isSaving} type="submit">
          {isSaving ? "Saving…" : "Save card"}
        </Button>
      </div>
    </form>
  );
}

export function PaymentMethodDialog({
  onClose,
  onComplete,
  session,
}: {
  onClose: () => void;
  onComplete: () => void;
  session: BillingSetupActionSuccess;
}) {
  const paymentClient = useMemo(
    () => loadStripe(session.publishableKey),
    [session.publishableKey],
  );

  return (
    <Modal
      description="Add a card for your Riink subscription and additional SMS usage."
      onClose={onClose}
      open
      title="Add payment method"
    >
      <Elements key={session.clientSecret} stripe={paymentClient}>
        <CardSetupForm
          clientSecret={session.clientSecret}
          onCancel={onClose}
          onComplete={onComplete}
        />
      </Elements>
    </Modal>
  );
}
