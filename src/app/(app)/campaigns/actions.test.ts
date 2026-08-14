// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/app/(app)/campaigns/data", () => ({
  loadCampaignLaunchContext: vi.fn(),
}));
vi.mock("@/lib/billing/customer-capabilities.server", () => ({
  loadCustomerBillingCapabilities: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { saveCampaignDraftAction } from "./actions";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const PHONE_NUMBER_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";

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
    mocks.rpc.mockResolvedValue({ data: CAMPAIGN_ID, error: null });
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
