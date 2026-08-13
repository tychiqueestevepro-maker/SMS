import { parsePhoneNumberWithError } from "libphonenumber-js";

/**
 * Normalizes a structurally valid US/NANP or French number to E.164.
 * Also enforces destination protection by rejecting known premium numbers (surtaxé).
 */
export function normalizePhoneNumber(input: string): string | null {
  const result = parseAndNormalizePhoneNumber(input);
  return result ? result.phoneE164 : null;
}

export function parseAndNormalizePhoneNumber(input: string): { phoneE164: string; countryCode: string } | null {
  const trimmed = input.trim();
  if (!trimmed || /[A-Za-z]/.test(trimmed)) {
    return null;
  }

  const compact = trimmed.replace(/[\s().-]/g, "");

  // France (+33)
  // French numbers typically have 9 digits after +33 (e.g. +33 6 12 34 56 78)
  // 08 is premium (surtaxé), so we only allow 1-7, 9
  if (compact.startsWith("+33") || (compact.length === 10 && compact.startsWith("0"))) {
    let e164 = compact;
    if (compact.length === 10 && compact.startsWith("0")) {
      e164 = `+33${compact.slice(1)}`;
    }
    if (/^\+33[1-79]\d{8}$/.test(e164)) {
      return { phoneE164: e164, countryCode: "FR" };
    }
    return null;
  }

  try {
    const phoneNumber = parsePhoneNumberWithError(compact.startsWith("+") ? compact : `+1${compact}`);
    if (phoneNumber.isValid()) {
      const e164 = phoneNumber.format("E.164");
      const countryCode = phoneNumber.country;

      if (!countryCode) return null;

      // Only US and CA are accepted from the NANP block (not other +1 countries)
      if (countryCode !== "US" && countryCode !== "CA") return null;

      // NANP validation logic (US/CA area codes and central-office codes cannot begin with 0 or 1)
      const nationalNumber = phoneNumber.nationalNumber;
      if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nationalNumber)) {
        return null;
      }

      return { phoneE164: e164, countryCode };
    }
  } catch (err) {
    // libphonenumber-js throws if it cannot parse
  }

  return null;
}

export function phoneSearchKey(input: string): string {
  return input.replace(/\D/g, "");
}
