// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { loadBillingSettingsData } from "./billing-data";

function queryWithResult(result: unknown) {
  const query = {
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockResolvedValue(result);
  return query;
}

function billingClient(
  summaryOverrides: Record<string, unknown> = {},
  options: {
    readyCount?: number;
    user?: { email: string; id: string };
  } = {},
) {
  const workspace = queryWithResult({
    data: { billing_plan_id: "plan-1", id: "workspace-1" },
  });
  const plan = queryWithResult({
    data: {
      included_segments: 2_000,
      max_phone_numbers: 3,
      monthly_price_cents: 8_999,
      overage_price_micro_usd: 40_000,
      safety_cap_segments: 10_000,
    },
  });
  const numbers = queryWithResult({ count: options.readyCount ?? 0, data: null });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: options.user ?? { email: "owner@example.com", id: "user-1" },
        },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "workspaces") return workspace;
      if (table === "billing_plans") return plan;
      if (table === "phone_numbers") return numbers;
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({
      data: {
        actual_credits: 9_950,
        additional_credit_price_micro_usd: 40_000,
        additional_credits: 7_950,
        additional_usage_amount_micro_usd: 159_000_000,
        can_cancel_subscription: false,
        can_open_portal: false,
        can_setup_payment: false,
        effective_credits: 10_000,
        included_credits: 2_000,
        max_phone_numbers: 3,
        messaging_enabled: false,
        monthly_price_cents: 8_999,
        payment_method_status: "missing",
        reserved_credits: 50,
        safety_cap_credits: 10_000,
        safety_cap_reached: true,
        subscription_status: "awaiting_number",
        ...summaryOverrides,
      },
      error: null,
    }),
  };
}

describe("loadBillingSettingsData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses effective usage for the safety block while displaying actual credits", async () => {
    createClient.mockResolvedValue(billingClient());

    const data = await loadBillingSettingsData();

    expect(data.usage).toMatchObject({
      primaryText: "9,950 SMS credits used",
      safetyCapReached: true,
      usedCredits: 9_950,
    });
  });

  it("can derive the safety block from actual plus reserved credits", async () => {
    createClient.mockResolvedValue(
      billingClient({ effective_credits: undefined, safety_cap_reached: undefined }),
    );

    const data = await loadBillingSettingsData();

    expect(data.usage?.safetyCapReached).toBe(true);
    expect(data.usage?.usedCredits).toBe(9_950);
  });

  it("forces every billing capability off after the plan has ended", async () => {
    createClient.mockResolvedValue(
      billingClient({
        can_cancel_subscription: true,
        can_open_portal: true,
        can_setup_payment: true,
        subscription_status: "ended",
      }),
    );

    const data = await loadBillingSettingsData();

    expect(data.subscription).toMatchObject({
      canCancel: false,
      canManageBilling: false,
      canSetUpPayment: false,
      status: "ended",
    });
  });

  it("never substitutes live plan values when the period snapshot is unavailable", async () => {
    const client = billingClient();
    client.rpc.mockResolvedValue({ data: null, error: { code: "unavailable" } });
    createClient.mockResolvedValue(client);

    const data = await loadBillingSettingsData();

    expect(data.plan).toBeNull();
    expect(data.usage).toBeNull();
    expect(client.from).not.toHaveBeenCalledWith("billing_plans");
  });

  it("does not present a trialing subscription as active", async () => {
    createClient.mockResolvedValue(billingClient({ subscription_status: "trialing" }));

    const data = await loadBillingSettingsData();

    expect(data.subscription.status).not.toBe("active");
  });

  it("does not present messaging as available from subscription status alone", async () => {
    createClient.mockResolvedValue(billingClient({
      messaging_enabled: false,
      subscription_status: "active",
    }));

    const data = await loadBillingSettingsData();

    expect(data.subscription).toMatchObject({
      label: "Messaging unavailable",
      status: "attention_required",
    });
  });

  it("shows an active plan when the authoritative messaging gate is enabled", async () => {
    createClient.mockResolvedValue(billingClient({
      messaging_enabled: true,
      subscription_status: "active",
    }));

    const data = await loadBillingSettingsData();

    expect(data.subscription.status).toBe("active");
  });

  it("offers direct activation only to the configured owner with a ready number and saved card", async () => {
    createClient.mockResolvedValue(
      billingClient(
        {
          payment_method_status: "saved",
          subscription_status: "setup_required",
        },
        {
          readyCount: 1,
          user: {
            email: "tychiqueesteve2005@gmail.com",
            id: "813e98ef-74da-4752-a228-3a018e56d777",
          },
        },
      ),
    );

    const data = await loadBillingSettingsData();

    expect(data).toMatchObject({
      canActivateSubscriptionDirectly: true,
      directActivationAccount: true,
      subscription: {
        label: "Ready to start",
        status: "setup_required",
      },
    });
  });

  it("keeps normal saved cards uncharged while their number is pending", async () => {
    createClient.mockResolvedValue(
      billingClient({
        payment_method_status: "saved",
        subscription_status: "setup_required",
      }),
    );

    const data = await loadBillingSettingsData();

    expect(data).toMatchObject({
      canActivateSubscriptionDirectly: false,
      directActivationAccount: false,
      subscription: {
        description: "Billing starts when your phone number is ready.",
        status: "awaiting_number",
      },
    });
  });
});
