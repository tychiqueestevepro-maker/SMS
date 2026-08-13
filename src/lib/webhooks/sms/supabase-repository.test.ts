// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildVerifiedSmsWebhookMutation } from "./mutation";
import {
  SmsWebhookRepositoryError,
  SupabaseSmsWebhookRepository,
} from "./supabase-repository";
import { inboundEvent, statusEvent } from "./test-fixtures";
import type {
  ResolvedSmsWebhookContext,
} from "./types";

const inboundContext: ResolvedSmsWebhookContext = {
  workspaceId: "workspace-1",
  phoneNumberId: "number-1",
  messageId: null,
  campaignId: null,
  campaignRecipientId: null,
  contactId: null,
};
const statusContext: ResolvedSmsWebhookContext = {
  workspaceId: "workspace-1",
  phoneNumberId: "number-1",
  messageId: "message-1",
  campaignId: "campaign-1",
  campaignRecipientId: "recipient-1",
  contactId: "contact-1",
};

function rpcClient(
  implementation: (
    name: string,
    args: Record<string, unknown>,
  ) => { data: unknown; error: unknown },
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
    implementation(name, args),
  );
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("SupabaseSmsWebhookRepository", () => {
  it("strictly maps the server-resolved inbound number context", async () => {
    const { client, rpc } = rpcClient(() => ({
      data: inboundContext,
      error: null,
    }));
    const repository = new SupabaseSmsWebhookRepository(client);

    await expect(
      repository.resolveWebhookContext({
        kind: "inbound_number",
        value: "+12025550101",
      }),
    ).resolves.toEqual(inboundContext);
    expect(rpc).toHaveBeenCalledWith("resolve_sms_webhook_context", {
      p_kind: "inbound_number",
      p_value: "+12025550101",
    });
  });

  it("returns null for an unknown route and rejects malformed correlation", async () => {
    const unknown = rpcClient(() => ({ data: null, error: null }));
    await expect(
      new SupabaseSmsWebhookRepository(
        unknown.client,
      ).resolveWebhookContext({ kind: "outbound_message", value: "provider-1" }),
    ).resolves.toBeNull();

    const malformed = rpcClient(() => ({
      data: { ...statusContext, unexpected: "field" },
      error: null,
    }));
    await expect(
      new SupabaseSmsWebhookRepository(
        malformed.client,
      ).resolveWebhookContext({ kind: "outbound_message", value: "provider-1" }),
    ).rejects.toBeInstanceOf(SmsWebhookRepositoryError);
  });

  it("passes the exact camelCase mutation to the one atomic RPC", async () => {
    const mutation = buildVerifiedSmsWebhookMutation(
      inboundContext,
      inboundEvent(),
      { actualSegments: 2, providerCostMicroUsd: 16_000 },
    );
    const result = {
      duplicate: false,
      contactId: "contact-created",
      inboundMessageId: "inbound-1",
      deletedContact: false,
      associatedCampaignRecipientId: null,
    };
    const { client, rpc } = rpcClient(() => ({ data: result, error: null }));

    await expect(
      new SupabaseSmsWebhookRepository(client).applyVerifiedEvent(mutation),
    ).resolves.toEqual(result);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("apply_verified_sms_webhook_event", {
      p_mutation: mutation,
    });
  });

  it("accepts an idempotent duplicate result without replaying locally", async () => {
    const mutation = buildVerifiedSmsWebhookMutation(
      statusContext,
      statusEvent(),
      { actualSegments: 1, providerCostMicroUsd: 8_000 },
    );
    const duplicate = {
      duplicate: true,
      contactId: null,
      inboundMessageId: null,
      deletedContact: false,
      associatedCampaignRecipientId: null,
    };
    const { client, rpc } = rpcClient(() => ({ data: duplicate, error: null }));
    await expect(
      new SupabaseSmsWebhookRepository(client).applyVerifiedEvent(mutation),
    ).resolves.toEqual(duplicate);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails before RPC for a forged opt-in confirmation or customer charge", async () => {
    const valid = buildVerifiedSmsWebhookMutation(
      inboundContext,
      inboundEvent({ body: "START", confirmedConsent: "opt_in" }),
      { actualSegments: 1, providerCostMicroUsd: 8_000 },
    );
    if (valid.kind !== "inbound") throw new Error("Expected inbound fixture.");
    const forgedConsent = {
      ...valid,
      event: { ...valid.event, confirmedConsent: null },
    };
    const forgedCharge = structuredClone(valid);
    Reflect.set(forgedCharge.usage, "customerBillableAmountMicroUsd", 20_000);
    const { client, rpc } = rpcClient(() => ({ data: null, error: null }));
    const repository = new SupabaseSmsWebhookRepository(client);

    await expect(repository.applyVerifiedEvent(forgedConsent)).rejects.toBeInstanceOf(
      SmsWebhookRepositoryError,
    );
    await expect(repository.applyVerifiedEvent(forgedCharge)).rejects.toBeInstanceOf(
      SmsWebhookRepositoryError,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed on an RPC correlation mismatch", async () => {
    const mutation = buildVerifiedSmsWebhookMutation(
      statusContext,
      statusEvent({ status: "failed" }),
      { actualSegments: 2, providerCostMicroUsd: 16_000 },
    );
    const { client } = rpcClient(() => ({
      data: {
        duplicate: false,
        contactId: "different-contact",
        inboundMessageId: null,
        deletedContact: false,
        associatedCampaignRecipientId: "recipient-1",
      },
      error: null,
    }));

    await expect(
      new SupabaseSmsWebhookRepository(client).applyVerifiedEvent(mutation),
    ).rejects.toMatchObject({
      name: "SmsWebhookRepositoryError",
      operation: "correlation_mismatch",
      message: "Messaging webhook persistence is temporarily unavailable.",
    });
  });

  it("does not propagate raw RPC errors", async () => {
    const { client } = rpcClient(() => ({
      data: null,
      error: { message: "raw database function detail" },
    }));
    await expect(
      new SupabaseSmsWebhookRepository(client).resolveWebhookContext({
        kind: "inbound_number",
        value: "+12025550101",
      }),
    ).rejects.toMatchObject({
      message: "Messaging webhook persistence is temporarily unavailable.",
    });
  });
});
