// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateNumber: vi.fn(),
  loadContext: vi.fn(),
  startOnboarding: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/(app)/settings/numbers-data", () => ({
  loadNumberServerContext: mocks.loadContext,
}));
vi.mock("@/lib/runtime/billing.server", () => ({
  automaticNumberActivationServiceFromEnvironment: () => ({
    activate: mocks.activateNumber,
  }),
}));
vi.mock("@/lib/runtime/messaging.server", () => ({
  configuredNumberServiceFromEnvironment: vi.fn(),
  numberImportServiceFromEnvironment: vi.fn(),
  numberProvisioningServiceFromEnvironment: () => ({
    startNumberOnboarding: mocks.startOnboarding,
  }),
}));

import { startNumberOnboardingAction } from "./numbers-actions";

const BUSINESS = {
  businessAddress: {
    city: "Austin",
    line1: "100 Main Street",
    line2: "",
    postalCode: "78701",
    state: "TX",
  },
  contactName: "Ada Lovelace",
  countryCode: "US" as const,
  ein: "12-3456789",
  email: "ada@riink.example",
  legalBusinessName: "Riink, Inc.",
  messagingUseCase: "Customer approved sales follow up",
  optInMethod: "Written form consent",
  phone: "+15125550192",
  privacyPolicy: "https://riink.example/privacy",
  sampleMessages: ["Hi Ada, this is Riink."],
  terms: "https://riink.example/terms",
  website: "https://riink.example",
};

function context(paymentMethodSaved: boolean) {
  return {
    maxPhoneNumbers: 3,
    numberAcquisitionAllowed: true,
    ownerEmail: "ada@riink.example",
    ownerUserId: "user-1",
    paymentMethodSaved,
    records: [],
    supabase: {},
    workspaceId: "workspace-1",
  };
}

describe("number onboarding billing timing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startOnboarding.mockResolvedValue({
      phoneNumberId: "number-1",
      status: "pending",
    });
    mocks.activateNumber.mockResolvedValue({
      alreadyReady: false,
      numberId: "number-1",
      subscriptionId: "sub-1",
      workspaceId: "workspace-1",
    });
  });

  it("requires a saved card before reserving a number", async () => {
    mocks.loadContext.mockResolvedValue(context(false));

    await expect(startNumberOnboardingAction("selection-1", BUSINESS)).resolves.toMatchObject({
      code: "PAYMENT_METHOD_REQUIRED",
      ok: false,
    });
    expect(mocks.startOnboarding).not.toHaveBeenCalled();
    expect(mocks.activateNumber).not.toHaveBeenCalled();
  });

  it("automatically activates billing only after the provider purchase completes", async () => {
    mocks.loadContext.mockResolvedValue(context(true));

    await expect(startNumberOnboardingAction("selection-1", BUSINESS)).resolves.toMatchObject({
      message: "Your number is ready to use.",
      ok: true,
    });
    expect(mocks.startOnboarding).toHaveBeenCalledOnce();
    expect(mocks.activateNumber).toHaveBeenCalledWith({
      numberId: "number-1",
      workspaceId: "workspace-1",
    });
    expect(mocks.startOnboarding.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateNumber.mock.invocationCallOrder[0]!,
    );
  });
});
