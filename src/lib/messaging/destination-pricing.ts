import "server-only";

import { safeAdd } from "@/lib/billing/integer";

export const SMS_DESTINATION_PRICING_EFFECTIVE_ON = "2026-08-14";

export type SmsDestinationCountryCode = "CA" | "FR" | "US";

export type SmsDestinationPrice = Readonly<{
  basePriceMicroUsdPerSegment: number;
  carrierFeeMaximumMicroUsdPerSegment: number;
  carrierFeeMinimumMicroUsdPerSegment: number;
  countryCode: SmsDestinationCountryCode;
  countryName: string;
  sourceUrl: string;
}>;

/**
 * Public Twilio pay as you go rates for the destinations Riink currently
 * supports. US and Canadian carrier fees are ranges because the destination
 * carrier is not known before Twilio accepts the message.
 */
export const SMS_DESTINATION_PRICES: Readonly<
  Record<SmsDestinationCountryCode, SmsDestinationPrice>
> = {
  CA: {
    basePriceMicroUsdPerSegment: 8_300,
    carrierFeeMaximumMicroUsdPerSegment: 8_700,
    carrierFeeMinimumMicroUsdPerSegment: 6_400,
    countryCode: "CA",
    countryName: "Canada",
    sourceUrl: "https://www.twilio.com/en-us/sms/pricing/ca",
  },
  FR: {
    basePriceMicroUsdPerSegment: 79_800,
    carrierFeeMaximumMicroUsdPerSegment: 0,
    carrierFeeMinimumMicroUsdPerSegment: 0,
    countryCode: "FR",
    countryName: "France",
    sourceUrl: "https://www.twilio.com/en-us/sms/pricing/fr",
  },
  US: {
    basePriceMicroUsdPerSegment: 8_300,
    carrierFeeMaximumMicroUsdPerSegment: 5_000,
    carrierFeeMinimumMicroUsdPerSegment: 3_500,
    countryCode: "US",
    countryName: "United States",
    sourceUrl: "https://www.twilio.com/en-us/sms/pricing/usa",
  },
};

export function smsDestinationPrice(
  countryCode: string | null | undefined,
): SmsDestinationPrice | null {
  const normalized = countryCode?.trim().toUpperCase();
  if (normalized !== "CA" && normalized !== "FR" && normalized !== "US") {
    return null;
  }
  return SMS_DESTINATION_PRICES[normalized];
}

export function smsDestinationPriceRange(price: SmsDestinationPrice): {
  maximumMicroUsdPerSegment: number;
  minimumMicroUsdPerSegment: number;
} {
  return {
    maximumMicroUsdPerSegment: safeAdd(
      price.basePriceMicroUsdPerSegment,
      price.carrierFeeMaximumMicroUsdPerSegment,
      "Maximum destination price per segment",
    ),
    minimumMicroUsdPerSegment: safeAdd(
      price.basePriceMicroUsdPerSegment,
      price.carrierFeeMinimumMicroUsdPerSegment,
      "Minimum destination price per segment",
    ),
  };
}

export function formatMicroUsdPerSegment(amountMicroUsd: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    minimumFractionDigits: 4,
    style: "currency",
  }).format(amountMicroUsd / 1_000_000);
}
