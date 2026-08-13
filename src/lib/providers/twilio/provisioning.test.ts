// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ProviderOperationError } from "../../messaging/errors";
import { TwilioWorkspaceSetupProvider } from "./provisioning";
import type {
  TwilioClientFactory,
  TwilioClientLike,
  TwilioMasterClientFactory,
  TwilioMasterClientLike,
} from "./types";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function harness() {
  const createAccount = vi.fn().mockResolvedValue({
    sid: "account-1",
    authToken: "one-time-secret",
    dateCreated: new Date("2026-08-10T11:58:00.000Z"),
  });
  const masterClient = {
    api: { v2010: { accounts: { create: createAccount } } },
  } satisfies TwilioMasterClientLike;
  const masterClientFactory = vi.fn(
    () => masterClient,
  ) as unknown as TwilioMasterClientFactory;

  const createService = vi.fn().mockResolvedValue({
    sid: "service-1",
    dateCreated: new Date("2026-08-10T11:59:00.000Z"),
  });
  const subaccountClient = {
    messaging: { v1: { services: { create: createService } } },
  } as unknown as TwilioClientLike;
  const subaccountClientFactory = vi.fn(
    () => subaccountClient,
  ) as unknown as TwilioClientFactory;

  const provider = new TwilioWorkspaceSetupProvider({
    masterClientFactory,
    masterCredentials: {
      accountSid: "master-account",
      authToken: "master-secret",
    },
    subaccountClientFactory,
    now: () => NOW,
  });
  return {
    createAccount,
    createService,
    masterClientFactory,
    provider,
    subaccountClientFactory,
  };
}

describe("TwilioWorkspaceSetupProvider", () => {
  it("creates the isolated account and service through the adapter", async () => {
    const mocks = harness();

    await expect(
      mocks.provider.createWorkspaceAccount({
        workspaceId: "workspace-1",
        displayName: "Riink workspace workspace-1",
      }),
    ).resolves.toEqual({
      accountId: "account-1",
      credential: "one-time-secret",
      createdAt: "2026-08-10T11:58:00.000Z",
    });
    expect(mocks.masterClientFactory).toHaveBeenCalledWith({
      accountSid: "master-account",
      authToken: "master-secret",
    });
    expect(mocks.createAccount).toHaveBeenCalledWith({
      friendlyName: "Riink workspace workspace-1",
    });

    await expect(
      mocks.provider.createMessagingService({
        workspaceId: "workspace-1",
        account: { accountId: "account-1", credential: "workspace-secret" },
        displayName: "Riink messaging workspace-1",
        inboundWebhookUrl: "https://www.riink.app/api/webhooks/sms",
      }),
    ).resolves.toEqual({
      serviceId: "service-1",
      createdAt: "2026-08-10T11:59:00.000Z",
    });
    expect(mocks.subaccountClientFactory).toHaveBeenCalledWith({
      accountSid: "account-1",
      authToken: "workspace-secret",
    });
    expect(mocks.createService).toHaveBeenCalledWith({
      friendlyName: "Riink messaging workspace-1",
      inboundMethod: "POST",
      inboundRequestUrl: "https://www.riink.app/api/webhooks/sms",
    });
  });

  it("classifies a missing response as ambiguous so callers never auto-repeat", async () => {
    const mocks = harness();
    mocks.createAccount.mockRejectedValue(new Error("connection closed"));

    const error = await mocks.provider
      .createWorkspaceAccount({
        workspaceId: "workspace-1",
        displayName: "Riink workspace workspace-1",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderOperationError);
    expect((error as ProviderOperationError).details).toMatchObject({
      kind: "ambiguous_result",
      operation: "createWorkspaceAccount",
      retryable: false,
    });
  });
});
