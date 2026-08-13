export const PAYMENT_DETAILS_INVALID_MESSAGE =
  "Check your card details and try again.";

export const PAYMENT_METHOD_SAVE_FAILED_MESSAGE =
  "Payment method couldn't be saved. Please try again.";

export function paymentSetupErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return PAYMENT_METHOD_SAVE_FAILED_MESSAGE;
  const type = "type" in error && typeof error.type === "string" ? error.type : null;
  return type === "card_error" || type === "validation_error"
    ? PAYMENT_DETAILS_INVALID_MESSAGE
    : PAYMENT_METHOD_SAVE_FAILED_MESSAGE;
}
