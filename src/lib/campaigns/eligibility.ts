import type {
  CampaignRecipientCandidate,
  RecipientEligibilityResult,
  RecipientIneligibilityReason,
} from "./types";

function ineligibilityReason(
  candidate: CampaignRecipientCandidate,
): RecipientIneligibilityReason | null {
  if (candidate.deletedAt !== null) return "deleted";
  if (candidate.isSuppressed) return "opted_out";
  if (candidate.hasActiveSequence) return "active_sequence";
  return null;
}

export function evaluateRecipientEligibility(
  selected: readonly CampaignRecipientCandidate[],
): RecipientEligibilityResult {
  const eligible: CampaignRecipientCandidate[] = [];
  const skipped: RecipientEligibilityResult["skipped"] = [];
  const seenContactIds = new Set<string>();

  for (const candidate of selected) {
    if (seenContactIds.has(candidate.contactId)) {
      skipped.push({
        contactId: candidate.contactId,
        reason: "duplicate_selection",
      });
      continue;
    }
    seenContactIds.add(candidate.contactId);

    const reason = ineligibilityReason(candidate);
    if (reason) {
      skipped.push({ contactId: candidate.contactId, reason });
    } else {
      eligible.push({ ...candidate });
    }
  }

  return {
    eligible,
    skipped,
    counts: {
      selected: selected.length,
      eligible: eligible.length,
      skipped: skipped.length,
      duplicateSelection: skipped.filter(
        ({ reason }) => reason === "duplicate_selection",
      ).length,
      deleted: skipped.filter(({ reason }) => reason === "deleted").length,
      optedOut: skipped.filter(({ reason }) => reason === "opted_out").length,
      activeSequence: skipped.filter(({ reason }) => reason === "active_sequence")
        .length,
      unsupportedCountry: skipped.filter(({ reason }) => reason === "unsupported_country")
        .length,
    },
  };
}
