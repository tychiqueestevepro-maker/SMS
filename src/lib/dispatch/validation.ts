import type {
  FinalDispatchValidationSnapshot,
  FinalValidationFailureReason,
} from "./types";

function nonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Mirrors the mandatory checks a repository performs while holding the final
 * message/reservation lock immediately before authorizing a provider attempt.
 */
export function finalValidationFailure(
  snapshot: FinalDispatchValidationSnapshot,
): FinalValidationFailureReason | null {
  if (!snapshot.campaignActive) return "campaign_inactive";
  if (!snapshot.recipientActive) return "recipient_inactive";
  if (!snapshot.contactActive) return "contact_inactive";
  if (snapshot.suppressed) return "suppressed";
  if (!snapshot.workspaceAuthorized) return "workspace_unauthorized";
  if (!snapshot.phoneNumberReady) return "phone_number_not_ready";
  if (!snapshot.reservationValid) return "reservation_invalid";
  if (
    !nonNegativeSafeInteger(snapshot.actualOutboundSegments) ||
    !nonNegativeSafeInteger(snapshot.reservedOutboundSegments) ||
    !nonNegativeSafeInteger(snapshot.safetyCapSegments)
  ) {
    return "reservation_invalid";
  }
  const effectiveUsage =
    snapshot.actualOutboundSegments + snapshot.reservedOutboundSegments;
  if (
    !Number.isSafeInteger(effectiveUsage) ||
    effectiveUsage > snapshot.safetyCapSegments
  ) {
    return "safety_cap_reached";
  }
  return null;
}

