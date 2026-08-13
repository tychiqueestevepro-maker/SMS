// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({
  createTwilioSdkClient: vi.fn(),
  createTwilioSubaccountClient: vi.fn(),
}));

import { createTwilioSdkClient, createTwilioSubaccountClient } from "./client";
import { TwilioConfiguredNumberConnector } from "./existing-number";

describe("TwilioConfiguredNumberConnector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clones compliance resources, moves the number and adds it to the sender pool", async () => {
    const bundleCreate = vi.fn().mockResolvedValue({
      bundleSid: "BUaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "twilio-approved",
    });
    const addressFetch = vi.fn().mockResolvedValue({
      city: "Paris",
      customerName: "Riink",
      friendlyName: "Riink France",
      isoCountry: "FR",
      postalCode: "75001",
      region: "Ile de France",
      street: "1 rue de Rivoli",
      streetSecondary: "",
    });
    const numberUpdate = vi.fn().mockResolvedValue({
      accountSid: "ACtarget",
      phoneNumber: "+33939245110",
      sid: "PNe5c6311d0e30ca70e0c49e923757e8e9",
    });
    const master = {
      numbers: {
        v2: { bundleClone: vi.fn(() => ({ create: bundleCreate })) },
      },
      api: {
        v2010: {
          accounts: vi.fn(() => ({
            addresses: vi.fn(() => ({ fetch: addressFetch })),
            incomingPhoneNumbers: vi.fn(() => ({ update: numberUpdate })),
          })),
        },
      },
    };
    const addressCreate = vi.fn().mockResolvedValue({
      sid: "ADaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    vi.mocked(createTwilioSdkClient)
      .mockReturnValueOnce(master)
      .mockReturnValueOnce({ addresses: { create: addressCreate } });
    const senderCreate = vi.fn().mockResolvedValue({ sid: "sender-1" });
    vi.mocked(createTwilioSubaccountClient).mockReturnValue({
      messaging: {
        v1: {
          services: vi.fn(() => ({
            phoneNumbers: { create: senderCreate },
          })),
        },
      },
    } as never);

    const connector = new TwilioConfiguredNumberConnector({
      masterAccountSid: "ACmaster",
      masterAuthToken: "secret",
      resolveCredentials: vi.fn().mockResolvedValue({
        accountSid: "ACtarget",
        authToken: "target-secret",
        messagingServiceSid: "MGservice",
      }),
    });

    await expect(
      connector.connect({
        addressSid: "ADd9447bc87874941ef20cef80c3872546",
        bundleSid: "BU261723150ab7ceaaf04d95802faf3380",
        inboundWebhookUrl: "https://www.riink.app/api/webhooks/sms",
        phoneNumber: "+33939245110",
        providerNumberId: "PNe5c6311d0e30ca70e0c49e923757e8e9",
        statusCallbackUrl: "https://www.riink.app/api/webhooks/sms",
        workspaceId: "workspace-1",
      }),
    ).resolves.toEqual({
      phoneNumber: "+33939245110",
      providerNumberId: "PNe5c6311d0e30ca70e0c49e923757e8e9",
      status: "active",
    });
    expect(bundleCreate).toHaveBeenCalledWith({
      friendlyName: "Riink workspace workspace-1",
      targetAccountSid: "ACtarget",
    });
    expect(addressCreate).toHaveBeenCalledWith(
      expect.objectContaining({ isoCountry: "FR", postalCode: "75001" }),
    );
    expect(numberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        accountSid: "ACtarget",
        addressSid: "ADaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        bundleSid: "BUaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(senderCreate).toHaveBeenCalledWith({
      phoneNumberSid: "PNe5c6311d0e30ca70e0c49e923757e8e9",
    });
  });
});
