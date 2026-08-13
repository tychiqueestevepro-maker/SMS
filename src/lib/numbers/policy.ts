import { numberProductError } from "./errors";
import type { InternalPhoneNumberRecord } from "./internal-types";
import type {
  BillingNumberAllowance,
  CampaignUsingNumber,
  NumberCapacityDecision,
  NumberRemovalDecision,
} from "./product-types";

export function evaluateNumberCapacity(
  records: readonly InternalPhoneNumberRecord[],
  allowance: BillingNumberAllowance,
): NumberCapacityDecision {
  if (!Number.isInteger(allowance.maxPhoneNumbers) || allowance.maxPhoneNumbers < 0) {
    throw new RangeError("maxPhoneNumbers must come from a valid billing plan.");
  }
  const currentNumberCount = records.filter(
    (record) =>
      record.source === "included" &&
      record.deletedAt === null &&
      record.adminState !== "released",
  ).length;
  const remainingSlots = Math.max(
    0,
    allowance.maxPhoneNumbers - currentNumberCount,
  );
  const allowed = currentNumberCount < allowance.maxPhoneNumbers;

  return {
    allowed,
    currentNumberCount,
    maxPhoneNumbers: allowance.maxPhoneNumbers,
    remainingSlots,
    error: allowed
      ? null
      : numberProductError("PHONE_NUMBER_LIMIT_REACHED"),
  };
}

export function evaluateNumberRemoval(
  phoneNumberId: string,
  campaigns: readonly CampaignUsingNumber[],
): NumberRemovalDecision {
  const blockingCampaignIds = campaigns
    .filter(
      (campaign) =>
        campaign.phoneNumberId === phoneNumberId &&
        (campaign.state === "active" || campaign.state === "paused"),
    )
    .map((campaign) => campaign.id);
  const allowed = blockingCampaignIds.length === 0;

  return {
    allowed,
    blockingCampaignIds,
    error: allowed
      ? null
      : numberProductError("PHONE_NUMBER_IN_ACTIVE_CAMPAIGN"),
  };
}
