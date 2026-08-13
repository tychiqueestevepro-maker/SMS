// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BillingRuntimeRepositoryError,
  SupabaseBillingRuntimeRepository,
} from "./supabase-runtime-repository.server";

function repositoryWith(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  return {
    repository: new SupabaseBillingRuntimeRepository(
      { rpc } as unknown as SupabaseClient,
    ),
    rpc,
  };
}

describe("SupabaseBillingRuntimeRepository", () => {
  it("claims events with a correlation-bound token", async () => {
    const { repository, rpc } = repositoryWith({
      claim_state: "claimed",
      claim_token: "claim_1",
      event_id: "evt_1",
    });

    await expect(repository.claimWebhookEvent({
      eventId: "evt_1",
      eventType: "invoice.created",
      occurredAt: "2026-08-10T12:00:00.000Z",
      receivedAt: "2026-08-10T12:00:01.000Z",
    })).resolves.toEqual({ claimToken: "claim_1", state: "claimed" });
    expect(rpc).toHaveBeenCalledWith("billing_claim_webhook_event", {
      p_event_created_at: "2026-08-10T12:00:00.000Z",
      p_event_id: "evt_1",
      p_event_type: "invoice.created",
      p_received_at: "2026-08-10T12:00:01.000Z",
    });
  });

  it("strictly maps a prepared run that can contain late deltas from multiple periods", async () => {
    const { repository, rpc } = repositoryWith({
      amount_micro_usd: 9_000_000,
      billing_invoice_run_id: "run_1",
      customer_id: "cus_1",
      event_id: "evt_1",
      invoice_id: "in_1",
      ledger_entry_count: 451,
      run_state: "ready",
      source_period_ids: ["period_july", "period_august"],
      workspace_id: "ws_1",
    });

    await expect(repository.prepareAdditionalUsageInvoiceRun({
      billingReason: "subscription_cycle",
      claimToken: "claim_1",
      customerId: "cus_1",
      eventId: "evt_1",
      invoiceCreatedAt: "2026-08-10T12:00:00.000Z",
      invoiceId: "in_1",
      invoicePeriodEndsAt: "2026-08-10T12:00:00.000Z",
      invoicePeriodStartsAt: "2026-07-10T12:00:00.000Z",
      preparedAt: "2026-08-10T12:00:01.000Z",
      subscriptionId: "sub_1",
    })).resolves.toEqual({
      amountMicroUsd: 9_000_000,
      billingInvoiceRunId: "run_1",
      customerId: "cus_1",
      invoiceId: "in_1",
      ledgerEntryCount: 451,
      sourcePeriodIds: ["period_july", "period_august"],
      state: "ready",
      workspaceId: "ws_1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "billing_prepare_additional_usage_invoice_run",
      expect.objectContaining({
        p_billing_reason: "subscription_cycle",
        p_claim_token: "claim_1",
        p_invoice_id: "in_1",
      }),
    );
  });

  it("fails closed when a run response is correlated to another invoice", async () => {
    const { repository } = repositoryWith({
      customer_id: "cus_1",
      event_id: "evt_1",
      invoice_id: "in_other",
      run_state: "no_usage",
    });

    await expect(repository.prepareAdditionalUsageInvoiceRun({
      billingReason: "subscription_cycle",
      claimToken: "claim_1",
      customerId: "cus_1",
      eventId: "evt_1",
      invoiceCreatedAt: "2026-08-10T12:00:00.000Z",
      invoiceId: "in_1",
      invoicePeriodEndsAt: "2026-08-10T12:00:00.000Z",
      invoicePeriodStartsAt: "2026-07-10T12:00:00.000Z",
      preparedAt: "2026-08-10T12:00:01.000Z",
      subscriptionId: "sub_1",
    })).rejects.toBeInstanceOf(BillingRuntimeRepositoryError);
  });

  it("persists provider diagnostics only through the internal failure RPC", async () => {
    const { repository, rpc } = repositoryWith({
      event_id: "evt_1",
      event_status: "failed",
    });

    await repository.failWebhookEvent({
      claimToken: "claim_1",
      eventId: "evt_1",
      failedAt: "2026-08-10T12:00:00.000Z",
      failureCode: "provider_add_invoice_line",
      providerCode: "invoice_not_editable",
      providerMessage: "internal technical detail",
    });
    expect(rpc).toHaveBeenCalledWith("billing_fail_webhook_event", {
      p_claim_token: "claim_1",
      p_event_id: "evt_1",
      p_failed_at: "2026-08-10T12:00:00.000Z",
      p_failure_code: "provider_add_invoice_line",
      p_provider_code: "invoice_not_editable",
      p_provider_message: "internal technical detail",
    });
  });

  it("forbids terminal reactivation in every webhook lifecycle mutation", async () => {
    const { repository, rpc } = repositoryWith({
      event_id: "evt_paid",
      subscription_id: "sub_1",
      workspace_id: "ws_1",
    });

    await repository.applyLifecycleEvent({
      allowTerminalReactivation: false,
      cancelAtPeriodEnd: null,
      claimToken: "claim_1",
      customerId: "cus_1",
      eventId: "evt_paid",
      eventKind: "invoice_paid",
      eventOccurredAt: "2026-08-10T12:00:00.000Z",
      graceEndsAt: null,
      invoiceId: "in_1",
      periodEndsAt: null,
      periodStartsAt: null,
      status: "active",
      subscriptionId: "sub_1",
      workspaceIdHint: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "billing_apply_lifecycle_event",
      expect.objectContaining({ p_allow_terminal_reactivation: false }),
    );
  });
});
