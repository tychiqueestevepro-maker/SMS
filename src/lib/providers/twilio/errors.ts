import {
  ProviderOperationError,
  type ProviderFailureKind,
} from "../../messaging/errors";
import type {
  TwilioProviderFailureContext,
  TwilioRestErrorShape,
} from "./types";

const INVALID_RECIPIENT_CODES = new Set([21211, 21614]);
const UNREACHABLE_RECIPIENT_CODES = new Set([
  30003, 30005, 30006, 30007, 30008,
]);
const NUMBER_NOT_READY_CODES = new Set([21606, 21612, 21659, 21704]);

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function errorShape(error: unknown): TwilioRestErrorShape {
  return typeof error === "object" && error !== null
    ? (error as TwilioRestErrorShape)
    : {};
}

function safeTechnicalMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof errorShape(error).message === "string"
        ? (errorShape(error).message as string)
        : "Unknown SMS provider failure";

  return message
    .slice(0, 1_000)
    .replace(
      /\b(auth(?:entication)?[ _-]?token|api[ _-]?key|secret|password)\s*(?:[:=]\s*|\s+)\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[a-f\d]{32}\b/gi, "[redacted]");
}

function classifyFailure(code: number | null, status: number | null): {
  kind: ProviderFailureKind;
  retryable: boolean;
} {
  if (code !== null && INVALID_RECIPIENT_CODES.has(code)) {
    return { kind: "invalid_recipient", retryable: false };
  }
  if (code !== null && UNREACHABLE_RECIPIENT_CODES.has(code)) {
    return { kind: "recipient_unreachable", retryable: false };
  }
  if (code !== null && NUMBER_NOT_READY_CODES.has(code)) {
    return { kind: "number_not_ready", retryable: false };
  }
  if (status === 401 || status === 403) {
    return { kind: "authentication", retryable: false };
  }
  if (status === 404) {
    return { kind: "not_found", retryable: false };
  }
  if (status === 409) {
    return { kind: "conflict", retryable: false };
  }
  if (status === 429) {
    return { kind: "rate_limited", retryable: true };
  }
  if (status !== null && status >= 500) {
    return { kind: "temporary", retryable: true };
  }
  if (status === 400 || status === 422) {
    return { kind: "invalid_request", retryable: false };
  }
  return { kind: "unknown", retryable: false };
}

export function isTwilioNotFoundError(error: unknown): boolean {
  return numericValue(errorShape(error).status) === 404;
}

export function toTwilioProviderError(
  error: unknown,
  context: TwilioProviderFailureContext,
): ProviderOperationError {
  if (error instanceof ProviderOperationError) return error;

  const shape = errorShape(error);
  const code = numericValue(shape.code);
  const status = numericValue(shape.status);
  const hasNoProviderResponse = status === null;
  const ambiguousResult =
    context.ambiguousWithoutResponse === true &&
    hasNoProviderResponse;
  const classification = ambiguousResult
    ? ({ kind: "ambiguous_result", retryable: false } as const)
    : classifyFailure(code, status);
  const rawCode =
    typeof shape.code === "string" || typeof shape.code === "number"
      ? String(shape.code)
      : null;

  return new ProviderOperationError({
    operation: context.operation,
    kind: classification.kind,
    providerCode: rawCode,
    providerMessage: safeTechnicalMessage(error),
    providerResourceId: context.providerResourceId ?? null,
    retryable: classification.retryable,
  });
}
