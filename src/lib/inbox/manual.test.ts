import { describe, expect, it } from "vitest";

import { toInboxErrorResponse } from "./errors";
import { assertManualMessageAllowed, evaluateManualMessage } from "./manual";

const READY_INPUT = {
  body: "Hello",
  contact: { deletedAt: null, isSuppressed: false },
  phoneNumber: { status: "ready" as const },
};

describe("manual SMS rules", () => {
  it("allows an active contact with a ready phone number", () => {
    expect(evaluateManualMessage(READY_INPUT)).toEqual({
      allowed: true,
      error: null,
    });
    expect(() => assertManualMessageAllowed(READY_INPUT)).not.toThrow();
  });

  it("blocks deleted and suppressed contacts", () => {
    expect(
      evaluateManualMessage({
        ...READY_INPUT,
        contact: {
          deletedAt: "2026-08-01T00:00:00.000Z",
          isSuppressed: false,
        },
      }),
    ).toMatchObject({
      allowed: false,
      error: { code: "CONTACT_NOT_AVAILABLE" },
    });
    expect(
      evaluateManualMessage({
        ...READY_INPUT,
        contact: { deletedAt: null, isSuppressed: true },
      }),
    ).toMatchObject({
      allowed: false,
      error: { code: "CONTACT_CANNOT_RECEIVE_MESSAGES" },
    });
  });

  it("blocks a pending number and an empty message", () => {
    expect(
      evaluateManualMessage({
        ...READY_INPUT,
        phoneNumber: { status: "pending" },
      }),
    ).toMatchObject({
      allowed: false,
      error: { code: "PHONE_NUMBER_NOT_READY" },
    });
    expect(evaluateManualMessage({ ...READY_INPUT, body: "  " })).toMatchObject({
      allowed: false,
      error: { code: "MESSAGE_REQUIRED" },
    });
  });
});

describe("safe Inbox errors", () => {
  it("never exposes raw infrastructure failures", () => {
    const rawMessage = "Gateway credential and internal identifier leaked";
    const response = toInboxErrorResponse(new Error(rawMessage));

    expect(response).toEqual({
      error: {
        code: "MESSAGE_SEND_FAILED",
        message: "Message couldn't be sent. Please try again later.",
      },
    });
    expect(JSON.stringify(response)).not.toContain(rawMessage);
  });
});
