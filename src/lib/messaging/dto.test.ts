import { describe, expect, it } from "vitest";

import { toMessageDto, toPhoneNumberDto } from "./dto";

describe("product DTO sanitization", () => {
  it("maps an internal message to provider-independent product fields", () => {
    const dto = toMessageDto({
      id: "message-1",
      direction: "outbound",
      body: "Hello",
      createdAt: "2026-08-10T12:00:00.000Z",
      sentAt: "2026-08-10T12:00:01.000Z",
      dispatchState: "accepted",
      deliveryState: null,
      estimatedSegments: 1,
      actualSegments: 2,
      providerMessageId: "external-message-1",
      providerErrorCode: "INTERNAL_CODE",
      providerErrorMessage: "Internal provider detail",
      providerCostMicroUsd: 16_000,
    });

    expect(dto).toEqual({
      id: "message-1",
      direction: "outbound",
      body: "Hello",
      createdAt: "2026-08-10T12:00:00.000Z",
      sentAt: "2026-08-10T12:00:01.000Z",
      deliveryStatus: "sent",
      smsCredits: 2,
    });
    expect(Object.keys(dto)).not.toContain("providerMessageId");
    expect(Object.keys(dto)).not.toContain("providerErrorCode");
    expect(Object.keys(dto)).not.toContain("providerCostMicroUsd");
    expect(Object.keys(dto)).not.toContain("actualSegments");
  });

  it("maps phone numbers without provider identifiers or statuses", () => {
    const dto = toPhoneNumberDto({
      id: "number-1",
      phoneNumber: "+12025550101",
      status: "pending",
      createdAt: "2026-08-10T12:00:00.000Z",
      providerNumberId: "external-number-1",
      providerAccountId: "external-account-1",
      providerStatus: "registration_pending",
    });

    expect(dto).toEqual({
      id: "number-1",
      phoneNumber: "+12025550101",
      status: "pending",
      createdAt: "2026-08-10T12:00:00.000Z",
    });
    expect(JSON.stringify(dto)).not.toContain("external-");
    expect(JSON.stringify(dto)).not.toContain("registration_pending");
  });
});
