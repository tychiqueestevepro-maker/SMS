import { NumberProductError } from "./errors";

export function normalizeUsAreaCode(input: string): string | null {
  const areaCode = input.trim();
  return /^[2-9]\d{2}$/.test(areaCode) ? areaCode : null;
}

export function assertUsAreaCode(input: string): string {
  const areaCode = normalizeUsAreaCode(input);
  if (!areaCode) throw new NumberProductError("INVALID_AREA_CODE");
  return areaCode;
}

export function areaCodeFromUsE164(phoneNumber: string): string | null {
  const match = /^\+1([2-9]\d{2})[2-9]\d{6}$/.exec(phoneNumber);
  return match?.[1] ?? null;
}
