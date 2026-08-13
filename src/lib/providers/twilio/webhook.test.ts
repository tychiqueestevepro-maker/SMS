// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeTwilioSmsWebhookRequest } from "./webhook";

const MESSAGE_ID = "SM0123456789abcdef0123456789abcdef";
const RECEIVED_AT = "2026-08-10T12:00:00.000Z";

function headers(
  values: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    "x-twilio-signature": "signed-request",
  },
) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

function normalize(rawBody: string, headerValues?: Record<string, string>) {
  return normalizeTwilioSmsWebhookRequest({
    rawBody,
    headers: headers(headerValues),
    canonicalUrl: "https://www.riink.app/api/webhooks/sms",
    receivedAt: RECEIVED_AT,
  });
}

function inboundForm(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    MessageSid: MESSAGE_ID,
    SmsStatus: "received",
    From: "+12025550199",
    To: "+12025550101",
    Body: "Interested",
    AccountSid: "ACtest-account",
    FutureParameter: "must be signed too",
    ...overrides,
  }).toString();
}

describe("SMS webhook adapter normalization", () => {
  it("normalizes inbound SMS and retains every form parameter for signature validation", () => {
    const result = normalize(inboundForm());
    expect(result).toMatchObject({
      requestUrl: "https://www.riink.app/api/webhooks/sms",
      signature: "signed-request",
      event: {
        kind: "inbound",
        providerMessageId: MESSAGE_ID,
        fromPhoneNumber: "+12025550199",
        toPhoneNumber: "+12025550101",
        body: "Interested",
        occurredAt: RECEIVED_AT,
        confirmedConsent: null,
      },
    });
    expect(result?.signatureParameters).toMatchObject({
      AccountSid: "ACtest-account",
      FutureParameter: "must be signed too",
      SmsStatus: "received",
    });
  });

  it("uses the signed OptOutType signal for opt-in and opt-out confirmation", () => {
    expect(
      normalize(inboundForm({ Body: "UNSTOP", OptOutType: "START" }))?.event,
    ).toMatchObject({ kind: "inbound", confirmedConsent: "opt_in" });
    expect(
      normalize(inboundForm({ Body: "ARRET", OptOutType: "STOP" }))?.event,
    ).toMatchObject({ kind: "inbound", confirmedConsent: "opt_out" });
    expect(
      normalize(inboundForm({ Body: "START", OptOutType: "" }))?.event,
    ).toMatchObject({ kind: "inbound", confirmedConsent: null });
  });

  it("normalizes status callbacks and retains the internal error code", () => {
    const result = normalize(
      new URLSearchParams({
        MessageSid: MESSAGE_ID,
        MessageStatus: "undelivered",
        ErrorCode: "30005",
      }).toString(),
    );
    expect(result?.event).toMatchObject({
      kind: "status",
      providerMessageId: MESSAGE_ID,
      status: "failed",
      providerErrorCode: "30005",
      occurredAt: RECEIVED_AT,
    });
  });

  it("creates stable idempotency IDs for replay and distinct status states", () => {
    const firstInbound = normalize(inboundForm())!;
    const replayedInbound = normalize(inboundForm())!;
    expect(replayedInbound.event.eventId).toBe(firstInbound.event.eventId);

    const sent = normalize(
      new URLSearchParams({
        MessageSid: MESSAGE_ID,
        MessageStatus: "sent",
      }).toString(),
    )!;
    const delivered = normalize(
      new URLSearchParams({
        MessageSid: MESSAGE_ID,
        MessageStatus: "delivered",
      }).toString(),
    )!;
    expect(sent.event.eventId).not.toBe(delivered.event.eventId);

    const firstFailure = normalize(
      new URLSearchParams({
        MessageSid: MESSAGE_ID,
        MessageStatus: "failed",
        ErrorCode: "30005",
      }).toString(),
    )!;
    const correctedFailure = normalize(
      new URLSearchParams({
        MessageSid: MESSAGE_ID,
        MessageStatus: "failed",
        ErrorCode: "30007",
      }).toString(),
    )!;
    expect(firstFailure.event.eventId).not.toBe(correctedFailure.event.eventId);
  });

  it("rejects duplicate parameter names because they cannot be safely represented", () => {
    expect(
      normalize(
        `MessageSid=${MESSAGE_ID}&From=%2B12025550199&To=%2B12025550101&Body=one&Body=two`,
      ),
    ).toBeNull();
  });

  it("acknowledges unsupported inbound phone formats without sending them to storage", () => {
    expect(normalize(inboundForm({ From: "+442079460001" }))).toBeNull();
    expect(normalize(inboundForm({ To: "+442079460002" }))).toBeNull();
    expect(normalize(inboundForm({ From: "+12021550199" }))).toBeNull();
  });

  it("acknowledges an oversized inbound body before any persistence or usage lookup", () => {
    expect(normalize(inboundForm({ Body: "x".repeat(1_601) }))).toBeNull();
    expect(normalize(inboundForm({ Body: "x".repeat(1_600) }))).not.toBeNull();
  });

  it("rejects unsupported content, missing identifiers, and oversized forms", () => {
    expect(
      normalize(inboundForm(), {
        "content-type": "application/json",
        "x-twilio-signature": "signed-request",
      }),
    ).toBeNull();
    expect(normalize("From=%2B12025550199&To=%2B12025550101&Body=Hello")).toBeNull();
    expect(normalize(`MessageSid=${MESSAGE_ID}&Body=${"a".repeat(300_000)}`)).toBeNull();
  });

  it("passes a missing signature through as invalid rather than trusting it", () => {
    const result = normalize(inboundForm(), {
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(result?.signature).toBe("");
  });
});
