// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadCampaignLaunchContext: vi.fn(),
  loadCustomerBillingCapabilities: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/app/(app)/campaigns/data", () => ({
  loadCampaignLaunchContext: mocks.loadCampaignLaunchContext,
}));
vi.mock("@/lib/billing/customer-capabilities.server", () => ({
  loadCustomerBillingCapabilities: mocks.loadCustomerBillingCapabilities,
}));
vi.mock("@/lib/runtime/messaging.server", () => ({
  messagingRuntimeFromEnvironment: () => ({ provider: { sendMessage: mocks.sendMessage } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import {
  launchCampaignAction,
  retryFailedCampaignMessagesAction,
  saveCampaignDraftAction,
  sendCampaignTestMessageAction,
} from "./actions";
import { campaignLaunchConfirmationKey } from "@/lib/campaigns/launch";
import type { CampaignLaunchAssessment } from "@/lib/campaigns/types";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const PHONE_NUMBER_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";

const launchAssessment: CampaignLaunchAssessment = {
  currentEffectiveUsageCredits: 320,
  eligibleRecipientCount: 2,
  eligibleRecipientIds: [CONTACT_ID, "99999999-9999-4999-8999-999999999999"],
  estimatedFirstStepCredits: 4,
  estimatedMaximumAdditionalChargeMicroUsd: 0,
  estimatedMaximumNewOverageCredits: 0,
  estimatedMaximumSequenceCredits: 8,
  estimatedNewOverageCredits: 0,
  includedCredits: 2_000,
  includedCreditsRemaining: 1_680,
  maximumSegmentsPerMessage: 2,
  projectedUsageCredits: 324,
  reasons: [],
  requiresConfirmation: false,
  unsupportedCountryCount: 0,
  usesUnicode: true,
};

function client() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "55555555-5555-4555-8555-555555555555" } },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: WORKSPACE_ID } }),
        })),
      })),
    })),
    rpc: mocks.rpc,
  };
}

function payload() {
  return {
    campaignId: CAMPAIGN_ID,
    contactIds: [CONTACT_ID],
    dripIntervalMinutes: 2,
    name: "Web prospects",
    phoneNumberId: PHONE_NUMBER_ID,
    sendWindowEnd: "18:00:00",
    sendWindowStart: "09:00:00",
    sendingDays: [1, 2, 3, 4, 5],
    steps: [{ body: "Bonjour {{first_name}}", waitDaysAfterPrevious: 0 }],
    timezone: "Europe/Paris",
  };
}

describe("saveCampaignDraftAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client());
    mocks.loadCustomerBillingCapabilities.mockResolvedValue({
      canSendMessages: true,
      safetyCapReached: false,
    });
    mocks.rpc.mockResolvedValue({ data: CAMPAIGN_ID, error: null });
    mocks.sendMessage.mockResolvedValue({
      acceptedAt: "2026-08-14T05:00:00.000Z",
      providerMessageId: "SM_test",
      status: "accepted",
    });
  });

  it("accepts the persisted zero delay for the first campaign message", async () => {
    await expect(saveCampaignDraftAction(payload())).resolves.toMatchObject({
      campaignId: CAMPAIGN_ID,
      ok: true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_campaign_draft",
      expect.objectContaining({
        p_steps: [
          {
            body: "Bonjour {{first_name}}",
            step_order: 1,
            wait_days_after_previous: null,
          },
        ],
      }),
    );
  });

  it("still rejects a zero delay after the first campaign message", async () => {
    const input = payload();
    input.steps.push({ body: "Second message", waitDaysAfterPrevious: 0 });

    await expect(saveCampaignDraftAction(input)).resolves.toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("launchCampaignAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client());
    mocks.loadCampaignLaunchContext.mockResolvedValue({
      assessment: launchAssessment,
      campaign: {
        messagingAvailable: true,
        phoneNumberId: PHONE_NUMBER_ID,
        phoneNumbers: [{ id: PHONE_NUMBER_ID, status: "ready" }],
        safetyCapReached: false,
      },
      providerCostImpact: {
        byDestination: [{
          basePriceMicroUsdPerSegment: 79_800,
          carrierFeeMaximumMicroUsdPerSegment: 0,
          carrierFeeMinimumMicroUsdPerSegment: 0,
          countryCode: "FR",
          countryName: "France",
          estimatedProviderCostMaximumMicroUsd: 638_400,
          estimatedProviderCostMinimumMicroUsd: 638_400,
          pricingAvailable: true,
          recipientCount: 2,
          totalSegments: 8,
        }],
        maximumMicroUsd: 638_400,
        minimumMicroUsd: 638_400,
        pricingComplete: true,
      },
      workspaceId: WORKSPACE_ID,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("requires an exact impact review for every campaign", async () => {
    await expect(
      launchCampaignAction(CAMPAIGN_ID, null, true),
    ).resolves.toMatchObject({
      assessment: launchAssessment,
      code: "CONFIRM_CAMPAIGN_IMPACT",
      ok: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("launches after the reviewed estimate is confirmed", async () => {
    const confirmationKey = campaignLaunchConfirmationKey(launchAssessment);

    await expect(
      launchCampaignAction(CAMPAIGN_ID, confirmationKey, true),
    ).resolves.toMatchObject({ ok: true, status: "active" });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "launch_campaign",
      expect.objectContaining({
        p_confirmed_contact_count: 2,
        p_consent_confirmed: true,
      }),
    );
  });
});

describe("sendCampaignTestMessageAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client());
    mocks.loadCustomerBillingCapabilities.mockResolvedValue({
      canSendMessages: true,
      safetyCapReached: false,
    });
    mocks.rpc.mockResolvedValue({
      data: [{
        disposition: "claimed",
        source_phone_e164: "+33939245110",
        workspace_id: WORKSPACE_ID,
      }],
      error: null,
    });
    mocks.sendMessage.mockResolvedValue({
      acceptedAt: "2026-08-14T05:00:00.000Z",
      providerMessageId: "SM_test",
      status: "accepted",
    });
  });

  it("renders the first sequence with sample personalization and sends it once", async () => {
    const result = await sendCampaignTestMessageAction({
      body: "Bonjour {{first_name}} de {{company}}",
      phoneNumberId: PHONE_NUMBER_ID,
      recipientPhoneNumber: "06 12 34 56 78",
      requestId: "66666666-6666-4666-8666-666666666666",
    });

    expect(result).toMatchObject({ ok: true, phoneNumber: "+33612345678" });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Bonjour Test de Riink",
      from: "+33939245110",
      to: "+33612345678",
      workspaceId: WORKSPACE_ID,
    }));
  });

  it("does not call Twilio again when the durable request was already claimed", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        disposition: "already_claimed",
        source_phone_e164: "+33939245110",
        workspace_id: WORKSPACE_ID,
      }],
      error: null,
    });

    await expect(sendCampaignTestMessageAction({
      body: "Test message",
      phoneNumberId: PHONE_NUMBER_ID,
      recipientPhoneNumber: "+33612345678",
      requestId: "77777777-7777-4777-8777-777777777777",
    })).resolves.toMatchObject({ ok: true });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects an unsupported recipient before claiming or sending", async () => {
    await expect(sendCampaignTestMessageAction({
      body: "Test message",
      phoneNumberId: PHONE_NUMBER_ID,
      recipientPhoneNumber: "+442079460123",
      requestId: "88888888-8888-4888-8888-888888888888",
    })).resolves.toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});

describe("retryFailedCampaignMessagesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client());
    mocks.loadCustomerBillingCapabilities.mockResolvedValue({
      canSendMessages: true,
      safetyCapReached: false,
    });
  });

  it("queues only the failures selected by the database safety fence", async () => {
    mocks.rpc.mockResolvedValue({
      data: { protectedCount: 2, queuedCount: 3 },
      error: null,
    });

    await expect(retryFailedCampaignMessagesAction(CAMPAIGN_ID)).resolves.toMatchObject({
      ok: true,
      protectedCount: 2,
      queuedCount: 3,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "retry_failed_campaign_messages",
      expect.objectContaining({ p_campaign_id: CAMPAIGN_ID }),
    );
  });

  it("does not queue retries when customer messaging is disabled", async () => {
    mocks.loadCustomerBillingCapabilities.mockResolvedValue({
      canSendMessages: false,
      safetyCapReached: true,
    });

    await expect(retryFailedCampaignMessagesAction(CAMPAIGN_ID)).resolves.toMatchObject({
      ok: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
