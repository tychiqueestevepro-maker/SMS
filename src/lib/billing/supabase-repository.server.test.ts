// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BillingRepositoryError,
  SupabaseBillingRepository,
} from "./supabase-repository.server";

describe("SupabaseBillingRepository", () => {
  it("claims payment setup before any provider call", async () => {
    const rpc = vi.fn(async () => ({
      data: { allowed: true, replayed: false, retry_after_seconds: 0 },
      error: null,
    }));
    const repository = new SupabaseBillingRepository(
      { rpc } as unknown as SupabaseClient,
    );

    await expect(repository.claimPaymentSetupAttempt({
      requestedAt: "2026-08-10T12:00:00.000Z",
      requestId: "request-1",
      workspaceId: "workspace-1",
    })).resolves.toEqual({
      allowed: true,
      replayed: false,
      retryAfterSeconds: 0,
    });
    expect(rpc).toHaveBeenCalledWith("billing_claim_payment_setup_attempt", {
      p_request_id: "request-1",
      p_requested_at: "2026-08-10T12:00:00.000Z",
      p_workspace_id: "workspace-1",
    });
  });

  it("maps only the internal billing account fields required by the service", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        customer_id: "customer-1",
        current_period_end: "2026-09-10T12:00:00.000Z",
        current_period_start: "2026-08-10T12:00:00.000Z",
        default_payment_method_id: "payment-method-1",
        monthly_price_cents: 8_999,
        subscription_id: null,
        subscription_price_id: null,
        subscription_status: null,
        workspace_id: "workspace-1",
      },
      error: null,
    }));
    const repository = new SupabaseBillingRepository(
      { rpc } as unknown as SupabaseClient,
    );

    await expect(repository.getWorkspaceAccount("workspace-1")).resolves.toEqual({
      customerId: "customer-1",
      currentPeriodEndsAt: "2026-09-10T12:00:00.000Z",
      currentPeriodStartsAt: "2026-08-10T12:00:00.000Z",
      defaultPaymentMethodId: "payment-method-1",
      monthlyPriceCents: 8_999,
      subscriptionId: null,
      subscriptionPriceId: null,
      subscriptionStatus: null,
      workspaceId: "workspace-1",
    });
  });

  it("fails closed if the service RPC returns another workspace", async () => {
    const repository = new SupabaseBillingRepository({
      rpc: vi.fn(async () => ({
        data: { workspace_id: "workspace-other" },
        error: null,
      })),
    } as unknown as SupabaseClient);

    await expect(repository.getWorkspaceAccount("workspace-1")).rejects.toBeInstanceOf(
      BillingRepositoryError,
    );
  });

  it("persists the exact correlated price with the subscription", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repository = new SupabaseBillingRepository(
      { rpc } as unknown as SupabaseClient,
    );

    await repository.recordSubscription({
      customerId: "customer-1",
      latestInvoiceId: "invoice-1",
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      priceId: "price-1",
      recordedAt: "2026-08-10T12:00:00.000Z",
      status: "active",
      subscriptionId: "subscription-1",
      workspaceId: "workspace-1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "billing_record_subscription",
      expect.objectContaining({ p_price_id: "price-1" }),
    );
  });
});
