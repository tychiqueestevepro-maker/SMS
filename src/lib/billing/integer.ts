export function assertNonNegativeSafeInteger(
  value: number,
  name: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

export function safeAdd(left: number, right: number, name: string): number {
  assertNonNegativeSafeInteger(left, name);
  assertNonNegativeSafeInteger(right, name);
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} exceeds the safe integer range.`);
  }
  return result;
}

export function safeMultiply(
  left: number,
  right: number,
  name: string,
): number {
  assertNonNegativeSafeInteger(left, name);
  assertNonNegativeSafeInteger(right, name);
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} exceeds the safe integer range.`);
  }
  return result;
}

export function formatMicroUsd(amountMicroUsd: number): string {
  assertNonNegativeSafeInteger(amountMicroUsd, "USD amount");
  // Product display is rounded to cents using integer half-up arithmetic.
  const cents = Math.floor((amountMicroUsd + 5_000) / 10_000);
  const dollars = Math.floor(cents / 100);
  const remainder = String(cents % 100).padStart(2, "0");
  return `$${dollars.toLocaleString("en-US")}.${remainder}`;
}
