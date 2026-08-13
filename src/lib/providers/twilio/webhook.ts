import "server-only";

import { createHash } from "node:crypto";

import type { ProviderMessageStatus } from "../../messaging/types";
import {
  MAX_SMS_WEBHOOK_BODY_BYTES,
  type NormalizeSmsWebhookHttpRequest,
} from "../../webhooks/sms/http";
import type {
  InboundSmsWebhookEvent,
  SmsStatusWebhookEvent,
} from "../../webhooks/sms/types";

const MAX_PARAMETERS = 256;
const MAX_INBOUND_BODY_CHARACTERS = 1_600;
const SMS_MESSAGE_ID = /^SM[a-f\d]{32}$/i;
// Riink V1 contact and number storage is intentionally US/NANP-only.
const US_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

function formContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/x-www-form-urlencoded";
}

function parseEveryFormParameter(rawBody: string): Record<string, string> | null {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_SMS_WEBHOOK_BODY_BYTES) {
    return null;
  }
  const parsed = new URLSearchParams(rawBody);
  const parameters: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of parsed) {
    count += 1;
    if (
      count > MAX_PARAMETERS ||
      !key ||
      Object.prototype.hasOwnProperty.call(parameters, key)
    ) {
      return null;
    }
    parameters[key] = value;
  }
  return count === 0 ? null : parameters;
}

function messageId(parameters: Record<string, string>): string | null {
  const value = parameters.MessageSid || parameters.SmsSid;
  return value && SMS_MESSAGE_ID.test(value) ? value : null;
}

function eventId(kind: "inbound" | "status", ...parts: string[]): string {
  const digest = createHash("sha256")
    .update([kind, ...parts].join("\0"), "utf8")
    .digest("hex");
  return `sms-${kind}:${digest}`;
}

function providerStatus(value: string): ProviderMessageStatus {
  switch (value.trim().toLowerCase()) {
    case "accepted":
      return "accepted";
    case "queued":
    case "scheduled":
    case "sending":
      return "queued";
    case "sent":
      return "sent";
    case "delivered":
    case "read":
      return "delivered";
    case "failed":
    case "undelivered":
    case "canceled":
      return "failed";
    default:
      return "unknown";
  }
}

function consentSignal(
  value: string | undefined,
): InboundSmsWebhookEvent["confirmedConsent"] {
  switch (value?.trim().toUpperCase()) {
    case "STOP":
      return "opt_out";
    case "START":
      return "opt_in";
    case "HELP":
      return "help";
    default:
      return null;
  }
}

function statusEvent(
  parameters: Record<string, string>,
  providerMessageId: string,
  occurredAt: string,
  rawStatus: string,
): SmsStatusWebhookEvent {
  const status = providerStatus(rawStatus);
  const rawErrorCode = parameters.ErrorCode?.trim();
  const providerErrorCode =
    rawErrorCode && rawErrorCode.length <= 64 ? rawErrorCode : null;
  return {
    kind: "status",
    eventId: eventId(
      "status",
      providerMessageId,
      status,
      status === "failed" ? (providerErrorCode ?? "") : "",
    ),
    providerMessageId,
    status,
    occurredAt,
    providerErrorCode,
  };
}

function inboundEvent(
  parameters: Record<string, string>,
  providerMessageId: string,
  occurredAt: string,
): InboundSmsWebhookEvent | null {
  const from = parameters.From;
  const to = parameters.To;
  if (
    !from ||
    !to ||
    !US_E164.test(from) ||
    !US_E164.test(to) ||
    !Object.prototype.hasOwnProperty.call(parameters, "Body") ||
    parameters.Body!.length > MAX_INBOUND_BODY_CHARACTERS
  ) {
    return null;
  }
  return {
    kind: "inbound",
    eventId: eventId("inbound", providerMessageId),
    providerMessageId,
    fromPhoneNumber: from,
    toPhoneNumber: to,
    body: parameters.Body!,
    occurredAt,
    confirmedConsent: consentSignal(parameters.OptOutType),
  };
}

/**
 * Provider-specific HTTP normalization. Every form field is retained for SDK
 * signature validation; only the generic normalized event crosses the adapter.
 */
export const normalizeTwilioSmsWebhookRequest: NormalizeSmsWebhookHttpRequest = (
  input,
) => {
  if (
    !formContentType(input.headers.get("content-type")) ||
    !Number.isFinite(Date.parse(input.receivedAt))
  ) {
    return null;
  }
  const parameters = parseEveryFormParameter(input.rawBody);
  if (!parameters) return null;
  const providerMessageId = messageId(parameters);
  if (!providerMessageId) return null;
  const occurredAt = new Date(input.receivedAt).toISOString();

  const explicitStatus = parameters.MessageStatus;
  const hasInboundShape =
    Object.prototype.hasOwnProperty.call(parameters, "Body") &&
    Boolean(parameters.From && parameters.To);
  let event: InboundSmsWebhookEvent | SmsStatusWebhookEvent | null;
  if (
    explicitStatus &&
    !["received", "receiving"].includes(explicitStatus.trim().toLowerCase())
  ) {
    event = statusEvent(
      parameters,
      providerMessageId,
      occurredAt,
      explicitStatus,
    );
  } else if (hasInboundShape) {
    event = inboundEvent(parameters, providerMessageId, occurredAt);
  } else if (parameters.SmsStatus) {
    event = statusEvent(
      parameters,
      providerMessageId,
      occurredAt,
      parameters.SmsStatus,
    );
  } else {
    event = null;
  }
  if (!event) return null;

  return {
    requestUrl: input.canonicalUrl,
    signature: input.headers.get("x-twilio-signature") ?? "",
    signatureParameters: parameters,
    event,
  };
};
