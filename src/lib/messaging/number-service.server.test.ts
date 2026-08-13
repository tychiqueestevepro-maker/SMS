// @vitest-environment node
import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ProviderOperationError, ProductMessagingError } from "./errors";
import { NumberProvisioningService } from "./number-service.server";
import type {
  SmsProvider,
  WorkspaceMessagingSetupProvider,
} from "./provider";
import type { NormalizedBusinessVerification } from "../numbers/business";
import type { NumberProvisioningRepository } from "../numbers/provisioning-repository";
import { NumberSelectionTokenSigner } from "../numbers/selection-token.server";

const NOW = new Date("2026-08-10T12:00:00.000Z");

const BUSINESS: NormalizedBusinessVerification = {
  legalBusinessName: "Example LLC",
  ein: "12-3456789",
  businessAddress: {
    line1: "1 Main St",
    line2: "",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    country: "US",
  },
  website: "https://example.test",
  contactName: "Alex Smith",
  email: "alex@example.test",
  phoneE164: "+15125550199",
  messagingUseCase: "Appointment reminders",
  optInMethod: "Website form",
  privacyPolicy: "https://example.test/privacy",
  terms: "https://example.test/terms",
  sampleMessages: ["Hello from Example"],
};

function repositoryMock(): NumberProvisioningRepository {
  return {
    claimNumberSearchAttempt: vi.fn().mockResolvedValue({
      allowed: true,
      replayed: false,
      retryAfterSeconds: 0,
    }),
    claimWorkspaceSetup: vi.fn().mockResolvedValue({
      disposition: "ready",
      operationId: "existing-setup",
    }),
    recordWorkspaceAccount: vi.fn().mockResolvedValue(true),
    completeWorkspaceSetup: vi.fn().mockResolvedValue(true),
    markWorkspaceSetupUnknown: vi.fn().mockResolvedValue(true),
    claimNumberPurchase: vi.fn().mockImplementation(async (input) => ({
      disposition: "claimed",
      operationId: input.operationId,
      phoneNumberId: "number-1",
    })),
    completeNumberPurchase: vi.fn().mockResolvedValue({
      completed: true,
      phoneNumberId: "number-1",
    }),
    markNumberPurchaseUnknown: vi.fn().mockResolvedValue(true),
    claimNumberRelease: vi.fn().mockImplementation(async (input) => ({
      disposition: "claimed",
      operationId: input.operationId,
      providerNumberId: "number-resource-1",
    })),
    completeNumberRelease: vi.fn().mockResolvedValue(true),
    markNumberReleaseUnknown: vi.fn().mockResolvedValue(true),
  };
}

function smsProviderMock(): SmsProvider {
  return {
    sendMessage: vi.fn(),
    searchNumbers: vi.fn().mockResolvedValue([
      {
        providerNumberId: "available-1",
        phoneNumber: "+15125550192",
        locality: "Austin",
        region: "TX",
        supportsSms: true,
      },
    ]),
    purchaseNumber: vi.fn().mockResolvedValue({
      providerNumberId: "number-resource-1",
      phoneNumber: "+15125550192",
      purchasedAt: NOW.toISOString(),
      state: "provisioning",
    }),
    releaseNumber: vi.fn().mockResolvedValue({
      providerNumberId: "number-resource-1",
      releasedAt: NOW.toISOString(),
    }),
    getMessageStatus: vi.fn(),
    getMessageCost: vi.fn(),
    getActualSegments: vi.fn(),
    verifyWebhook: vi.fn(),
  };
}

function setupProviderMock(): WorkspaceMessagingSetupProvider {
  return {
    createWorkspaceAccount: vi.fn().mockResolvedValue({
      accountId: "account-1",
      credential: "one-time-secret",
      createdAt: NOW.toISOString(),
    }),
    createMessagingService: vi.fn().mockResolvedValue({
      serviceId: "service-1",
      createdAt: NOW.toISOString(),
    }),
  };
}

function createHarness(input: {
  repository?: NumberProvisioningRepository;
  provider?: SmsProvider;
  setupProvider?: WorkspaceMessagingSetupProvider;
} = {}) {
  const repository = input.repository ?? repositoryMock();
  const provider = input.provider ?? smsProviderMock();
  const setupProvider = input.setupProvider ?? setupProviderMock();
  const signer = new NumberSelectionTokenSigner(
    randomBytes(32).toString("base64"),
  );
  let operationIndex = 0;
  const service = new NumberProvisioningService(
    repository,
    provider,
    setupProvider,
    signer,
    {
      applicationOrigin: "https://www.riink.app/path-is-ignored",
      credentialVault: {
        encrypt: vi.fn(() => "encrypted-secret"),
      },
      providerName: "internal-provider",
      operationId: () => `operation-${++operationIndex}`,
      now: () => NOW,
    },
  );
  const token = signer.issue(
    {
      areaCode: "512",
      phoneNumber: "+15125550192",
      providerNumberId: "available-1",
      workspaceId: "workspace-1",
    },
    { now: NOW },
  );
  return { provider, repository, service, setupProvider, signer, token };
}

describe("NumberProvisioningService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bootstraps an isolated workspace before search and returns only signed selections", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.claimWorkspaceSetup).mockImplementation(async (input) => ({
      disposition: "claimed",
      operationId: input.operationId,
    }));
    const harness = createHarness({ repository });

    const candidates = await harness.service.searchNumbers({
      areaCode: "512",
      requestId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "workspace-1",
    });

    expect(harness.setupProvider.createWorkspaceAccount).toHaveBeenCalledOnce();
    expect(repository.recordWorkspaceAccount).toHaveBeenCalledWith({
      encryptedCredential: "encrypted-secret",
      operationId: "operation-1",
      providerAccountId: "account-1",
      providerName: "internal-provider",
      workspaceId: "workspace-1",
    });
    expect(harness.setupProvider.createMessagingService).toHaveBeenCalledWith(
      expect.objectContaining({
        inboundWebhookUrl: "https://www.riink.app/api/webhooks/sms",
      }),
    );
    expect(repository.completeWorkspaceSetup).toHaveBeenCalledWith({
      messagingServiceId: "service-1",
      operationId: "operation-1",
      workspaceId: "workspace-1",
    });
    expect(candidates).toHaveLength(1);
    const verified = harness.signer.verify(
      candidates[0]!.selectionId,
      "workspace-1",
      NOW,
    );
    expect(verified).toMatchObject({
      phoneNumber: "+15125550192",
      providerNumberId: "available-1",
      workspaceId: "workspace-1",
    });
    expect(JSON.stringify(candidates)).not.toContain("available-1");
  });

  it("never calls setup again while an earlier setup needs reconciliation", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.claimWorkspaceSetup).mockResolvedValue({
      disposition: "reconciliation_required",
      operationId: "existing-operation",
    });
    const harness = createHarness({ repository });

    await expect(
      harness.service.searchNumbers({
        areaCode: "512",
        requestId: "22222222-2222-4222-8222-222222222222",
        workspaceId: "workspace-1",
      }),
    ).rejects.toMatchObject({ code: "PHONE_NUMBER_OPERATION_FAILED" });
    expect(harness.setupProvider.createWorkspaceAccount).not.toHaveBeenCalled();
    expect(harness.provider.searchNumbers).not.toHaveBeenCalled();
  });

  it("does not initialize a workspace or search when the request is throttled", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.claimNumberSearchAttempt).mockResolvedValue({
      allowed: false,
      replayed: false,
      retryAfterSeconds: 60,
    });
    const harness = createHarness({ repository });

    await expect(harness.service.searchNumbers({
      areaCode: "512",
      requestId: "33333333-3333-4333-8333-333333333333",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "PHONE_NUMBER_OPERATION_FAILED" });
    expect(repository.claimWorkspaceSetup).not.toHaveBeenCalled();
    expect(harness.provider.searchNumbers).not.toHaveBeenCalled();
  });

  it("marks an ambiguous purchase for reconciliation and a replay cannot repurchase", async () => {
    const repository = repositoryMock();
    let purchaseClaimCount = 0;
    vi.mocked(repository.claimNumberPurchase).mockImplementation(async (input) => {
      purchaseClaimCount += 1;
      return purchaseClaimCount === 1
        ? {
            disposition: "claimed" as const,
            operationId: input.operationId,
            phoneNumberId: "number-1",
          }
        : {
            disposition: "reconciliation_required" as const,
            operationId: "operation-2",
            phoneNumberId: "number-1",
          };
    });
    const provider = smsProviderMock();
    vi.mocked(provider.purchaseNumber).mockRejectedValue(
      new ProviderOperationError({
        operation: "purchaseNumber",
        kind: "ambiguous_result",
        providerCode: null,
        providerMessage: "request result unknown",
        providerResourceId: null,
        retryable: false,
      }),
    );
    const harness = createHarness({ provider, repository });

    await expect(
      harness.service.startNumberOnboarding({
        businessVerification: BUSINESS,
        selectionToken: harness.token,
        workspaceId: "workspace-1",
      }),
    ).rejects.toBeInstanceOf(ProductMessagingError);
    await expect(
      harness.service.startNumberOnboarding({
        businessVerification: BUSINESS,
        selectionToken: harness.token,
        workspaceId: "workspace-1",
      }),
    ).rejects.toMatchObject({ code: "PHONE_NUMBER_OPERATION_FAILED" });

    expect(provider.purchaseNumber).toHaveBeenCalledOnce();
    expect(repository.markNumberPurchaseUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: expect.objectContaining({
          providerMessage: "request result unknown",
        }),
      }),
    );
  });

  it("persists the purchased resource as uncertain if completion fails", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.completeNumberPurchase).mockRejectedValue(
      new Error("database unavailable"),
    );
    const harness = createHarness({ repository });

    await expect(
      harness.service.startNumberOnboarding({
        businessVerification: BUSINESS,
        selectionToken: harness.token,
        workspaceId: "workspace-1",
      }),
    ).rejects.toMatchObject({ code: "PHONE_NUMBER_OPERATION_FAILED" });
    expect(repository.markNumberPurchaseUnknown).toHaveBeenCalledWith({
      failure: {
        providerCode: null,
        providerMessage: "database unavailable",
        providerResourceId: "number-resource-1",
      },
      operationId: "operation-2",
      workspaceId: "workspace-1",
    });
  });

  it("soft-removes before release and records an uncertain external result", async () => {
    const repository = repositoryMock();
    const provider = smsProviderMock();
    vi.mocked(provider.releaseNumber).mockRejectedValue(new Error("timeout"));
    const harness = createHarness({ provider, repository });

    await expect(
      harness.service.releaseNumber({
        phoneNumberId: "number-1",
        workspaceId: "workspace-1",
      }),
    ).rejects.toMatchObject({ code: "PHONE_NUMBER_OPERATION_FAILED" });
    expect(repository.claimNumberRelease).toHaveBeenCalledBefore(
      vi.mocked(provider.releaseNumber),
    );
    expect(repository.markNumberReleaseUnknown).toHaveBeenCalledWith({
      failure: expect.objectContaining({
        providerResourceId: "number-resource-1",
      }),
      operationId: "operation-1",
      phoneNumberId: "number-1",
      workspaceId: "workspace-1",
    });
  });
});
