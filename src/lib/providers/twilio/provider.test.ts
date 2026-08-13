import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

import { ProductMessagingError } from "../../messaging/errors";
import { MessagingService } from "../../messaging/service";
import { toTwilioProviderError } from "./errors";
import { TwilioSmsProvider, mapTwilioMessageStatus } from "./provider";
import type {
  TwilioClientLike,
  TwilioIncomingPhoneNumberList,
  TwilioMessageList,
  TwilioMessageResource,
  TwilioMessagingServicePhoneNumberList,
  TwilioClientFactory,
  TwilioWebhookValidator,
  TwilioWorkspaceCredentials,
} from "./types";

const CREDENTIALS: TwilioWorkspaceCredentials = {
  accountSid: "AC_subaccount",
  authToken: "internal-auth-token",
  messagingServiceSid: "MG_service",
};

function messageResource(
  overrides: Partial<TwilioMessageResource> = {},
): TwilioMessageResource {
  return {
    sid: "SM_message",
    status: "accepted",
    dateCreated: new Date("2026-08-10T12:00:00.000Z"),
    dateUpdated: new Date("2026-08-10T12:01:00.000Z"),
    price: "-0.015",
    priceUnit: "usd",
    numSegments: "2",
    ...overrides,
  };
}

function mockClient() {
  const messageFetch = vi.fn().mockResolvedValue(messageResource());
  const messagesCreate = vi.fn().mockResolvedValue(messageResource());
  const messages = Object.assign(
    vi.fn(() => ({ fetch: messageFetch })),
    { create: messagesCreate },
  ) as unknown as TwilioMessageList;

  const availableList = vi.fn().mockResolvedValue([
    {
      phoneNumber: "+12025550101",
      locality: "Washington",
      region: "DC",
      capabilities: { sms: true },
    },
  ]);
  const availablePhoneNumbers = vi.fn(() => ({
    local: { list: availableList },
  }));

  const incomingRemove = vi.fn().mockResolvedValue(true);
  const incomingCreate = vi.fn().mockResolvedValue({
    sid: "PN_number",
    phoneNumber: "+12025550101",
    dateCreated: new Date("2026-08-10T12:02:00.000Z"),
  });
  const incomingPhoneNumbers = Object.assign(
    vi.fn(() => ({ remove: incomingRemove })),
    { create: incomingCreate },
  ) as unknown as TwilioIncomingPhoneNumberList;

  const serviceNumberRemove = vi.fn().mockResolvedValue(true);
  const serviceNumberCreate = vi.fn().mockResolvedValue({ sid: "PN_number" });
  const servicePhoneNumbers = Object.assign(
    vi.fn(() => ({ remove: serviceNumberRemove })),
    { create: serviceNumberCreate },
  ) as unknown as TwilioMessagingServicePhoneNumberList;
  const services = Object.assign(
    vi.fn(() => ({ phoneNumbers: servicePhoneNumbers })),
    {
      create: vi.fn().mockResolvedValue({
        sid: "MG_service",
        dateCreated: new Date("2026-08-10T12:01:00.000Z"),
      }),
    },
  );

  const client: TwilioClientLike = {
    messages,
    availablePhoneNumbers,
    incomingPhoneNumbers,
    messaging: { v1: { services } },
  };

  return {
    client,
    messageFetch,
    messagesCreate,
    availableList,
    availablePhoneNumbers,
    incomingCreate,
    incomingRemove,
    serviceNumberCreate,
    serviceNumberRemove,
    services,
  };
}

describe("TwilioSmsProvider", () => {
  let mocks: ReturnType<typeof mockClient>;
  let resolveCredentials: Mock<
    (workspaceId: string) => Promise<TwilioWorkspaceCredentials>
  >;
  let clientFactory: Mock<TwilioClientFactory>;
  let validateWebhook: Mock<TwilioWebhookValidator>;
  let provider: TwilioSmsProvider;

  beforeEach(() => {
    mocks = mockClient();
    resolveCredentials = vi.fn(async () => CREDENTIALS);
    clientFactory = vi.fn(() => mocks.client);
    validateWebhook = vi.fn(() => true);
    provider = new TwilioSmsProvider({
      resolveCredentials,
      clientFactory,
      validateWebhook,
      now: () => new Date("2026-08-10T13:00:00.000Z"),
    });
  });

  it("creates a workspace-scoped client and sends through its Messaging Service", async () => {
    await expect(
      provider.sendMessage({
        workspaceId: "workspace-1",
        messageId: "message-1",
        from: "+12025550101",
        to: "+12025550199",
        body: "Hello",
        idempotencyKey: "dispatch-1",
        statusCallbackUrl: "https://riink.test/status",
      }),
    ).resolves.toEqual({
      providerMessageId: "SM_message",
      acceptedAt: "2026-08-10T12:00:00.000Z",
      status: "accepted",
    });

    expect(resolveCredentials).toHaveBeenCalledWith("workspace-1");
    expect(clientFactory).toHaveBeenCalledWith(CREDENTIALS);
    expect(mocks.messagesCreate).toHaveBeenCalledWith({
      to: "+12025550199",
      from: "+12025550101",
      body: "Hello",
      messagingServiceSid: "MG_service",
      statusCallback: "https://riink.test/status",
    });
  });

  it("searches SMS-capable US numbers with a bounded area-code query", async () => {
    await expect(
      provider.searchNumbers({
        workspaceId: "workspace-1",
        countryCode: "US",
        areaCode: "202",
        limit: 100,
      }),
    ).resolves.toEqual([
      {
        providerNumberId: "+12025550101",
        phoneNumber: "+12025550101",
        locality: "Washington",
        region: "DC",
        supportsSms: true,
      },
    ]);
    expect(mocks.availablePhoneNumbers).toHaveBeenCalledWith("US");
    expect(mocks.availableList).toHaveBeenCalledWith({
      areaCode: 202,
      smsEnabled: true,
      limit: 50,
    });
  });

  it("searches French SMS numbers without a NANP area code", async () => {
    mocks.availableList.mockResolvedValueOnce([
      {
        phoneNumber: "+33939031234",
        locality: "France",
        region: null,
        capabilities: { sms: true },
      },
    ]);

    await expect(
      provider.searchNumbers({
        workspaceId: "workspace-1",
        countryCode: "FR",
        limit: 10,
      }),
    ).resolves.toMatchObject([{ phoneNumber: "+33939031234", supportsSms: true }]);
    expect(mocks.availablePhoneNumbers).toHaveBeenCalledWith("FR");
    expect(mocks.availableList).toHaveBeenCalledWith({
      smsEnabled: true,
      limit: 10,
    });
  });

  it("purchases, configures, attaches and releases a number", async () => {
    await expect(
      provider.purchaseNumber({
        workspaceId: "workspace-1",
        providerNumberId: "+12025550101",
        phoneNumber: "+12025550101",
        idempotencyKey: "purchase-1",
        inboundWebhookUrl: "https://riink.test/inbound",
        statusCallbackUrl: "https://riink.test/status",
      }),
    ).resolves.toEqual({
      providerNumberId: "PN_number",
      phoneNumber: "+12025550101",
      purchasedAt: "2026-08-10T12:02:00.000Z",
      state: "provisioning",
    });
    expect(mocks.incomingCreate).toHaveBeenCalledWith({
      phoneNumber: "+12025550101",
      smsUrl: "https://riink.test/inbound",
      smsMethod: "POST",
      statusCallback: "https://riink.test/status",
      statusCallbackMethod: "POST",
    });
    expect(mocks.services).toHaveBeenCalledWith("MG_service");
    expect(mocks.serviceNumberCreate).toHaveBeenCalledWith({
      phoneNumberSid: "PN_number",
    });

    await expect(
      provider.releaseNumber({
        workspaceId: "workspace-1",
        providerNumberId: "PN_number",
        idempotencyKey: "release-1",
      }),
    ).resolves.toEqual({
      providerNumberId: "PN_number",
      releasedAt: "2026-08-10T13:00:00.000Z",
    });
    expect(mocks.serviceNumberRemove).toHaveBeenCalledOnce();
    expect(mocks.incomingRemove).toHaveBeenCalledOnce();
  });

  it("retrieves normalized status, absolute micro-USD cost and actual segments", async () => {
    const lookup = {
      workspaceId: "workspace-1",
      providerMessageId: "SM_message",
    };
    await expect(provider.getMessageStatus(lookup)).resolves.toEqual({
      providerMessageId: "SM_message",
      status: "accepted",
      updatedAt: "2026-08-10T12:01:00.000Z",
    });
    await expect(provider.getMessageCost(lookup)).resolves.toEqual({
      providerMessageId: "SM_message",
      amountMicroUsd: 15_000,
      currency: "USD",
    });
    await expect(provider.getActualSegments(lookup)).resolves.toEqual({
      providerMessageId: "SM_message",
      numSegments: 2,
    });
  });

  it("verifies signatures with only the resolved account token", async () => {
    await expect(
      provider.verifyWebhook({
        workspaceId: "workspace-1",
        url: "https://riink.test/inbound",
        signature: "signed-request",
        parameters: { MessageSid: "SM_message" },
      }),
    ).resolves.toEqual({ valid: true });
    expect(validateWebhook).toHaveBeenCalledWith(
      "internal-auth-token",
      "signed-request",
      "https://riink.test/inbound",
      { MessageSid: "SM_message" },
    );
  });
});

describe("status and failure mapping", () => {
  it.each([
    ["queued", "queued"],
    ["scheduled", "queued"],
    ["accepted", "accepted"],
    ["sent", "sent"],
    ["partially_delivered", "sent"],
    ["delivered", "delivered"],
    ["undelivered", "failed"],
    ["canceled", "failed"],
    ["new-status", "unknown"],
  ] as const)("maps %s to %s", (raw, expected) => {
    expect(mapTwilioMessageStatus(raw)).toBe(expected);
  });

  it.each([
    [{ status: 400, code: 21211, message: "bad recipient" }, "invalid_recipient", false],
    [{ status: 400, code: 21606, message: "bad sender" }, "number_not_ready", false],
    [{ status: 429, message: "limited" }, "rate_limited", true],
    [{ status: 503, message: "down" }, "temporary", true],
    [{ status: 401, message: "denied" }, "authentication", false],
    [{ status: 404, message: "missing" }, "not_found", false],
  ] as const)("classifies internal failure %#", (raw, kind, retryable) => {
    expect(
      toTwilioProviderError(raw, { operation: "sendMessage" }).details,
    ).toMatchObject({ kind, retryable });
  });

  it("keeps raw detail internal while MessagingService returns only a safe product error", async () => {
    const rawMessage = "Internal gateway request detail";
    const mocks = mockClient();
    mocks.messagesCreate.mockRejectedValue({
      status: 400,
      code: 21211,
      message: rawMessage,
      requestPayload: { authToken: "must-not-be-copied" },
    });
    const provider = new TwilioSmsProvider({
      resolveCredentials: () => CREDENTIALS,
      clientFactory: () => mocks.client,
      validateWebhook: () => true,
    });
    const reports: string[] = [];
    const service = new MessagingService(provider, {
      reportProviderFailure: ({ failure }) => {
        reports.push(JSON.stringify(failure));
      },
    });

    let error: unknown;
    try {
      await service.sendMessage({
        workspaceId: "workspace-1",
        messageId: "message-1",
        from: "+12025550101",
        to: "+12025550199",
        body: "Hello",
        idempotencyKey: "dispatch-1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProductMessagingError);
    expect(error).toMatchObject({
      code: "CONTACT_CANNOT_RECEIVE_MESSAGES",
      message: "This contact can't receive messages.",
    });
    expect(JSON.stringify(error)).not.toContain(rawMessage);
    expect(reports[0]).toContain(rawMessage);
    expect(reports[0]).not.toContain("must-not-be-copied");
  });

  it("marks a transport result as ambiguous and never retryable after send begins", async () => {
    const mocks = mockClient();
    mocks.messagesCreate.mockRejectedValue({
      code: "ETIMEDOUT",
      message: "Connection ended before a response was received",
    });
    const provider = new TwilioSmsProvider({
      resolveCredentials: () => CREDENTIALS,
      clientFactory: () => mocks.client,
      validateWebhook: () => true,
    });

    await expect(
      provider.sendMessage({
        workspaceId: "workspace-1",
        messageId: "message-1",
        from: "+12025550101",
        to: "+12025550199",
        body: "Hello",
        idempotencyKey: "dispatch-1",
      }),
    ).rejects.toMatchObject({
      details: {
        operation: "sendMessage",
        kind: "ambiguous_result",
        providerCode: "ETIMEDOUT",
        retryable: false,
      },
    });
  });

  it("does not classify credential resolution failures as ambiguous", async () => {
    const mocks = mockClient();
    const provider = new TwilioSmsProvider({
      resolveCredentials: () => {
        throw { status: 401, message: "Credentials rejected" };
      },
      clientFactory: () => mocks.client,
      validateWebhook: () => true,
    });

    await expect(
      provider.sendMessage({
        workspaceId: "workspace-1",
        messageId: "message-1",
        from: "+12025550101",
        to: "+12025550199",
        body: "Hello",
        idempotencyKey: "dispatch-1",
      }),
    ).rejects.toMatchObject({
      details: {
        operation: "sendMessage",
        kind: "authentication",
        retryable: false,
      },
    });
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });
});
