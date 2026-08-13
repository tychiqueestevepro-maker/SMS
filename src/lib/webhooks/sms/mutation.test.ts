import { describe, expect, it } from "vitest";

import {
  buildVerifiedSmsWebhookMutation,
  normalizeWebhookConsent,
} from "./mutation";
import { inboundEvent, statusEvent } from "./test-fixtures";
import type { ResolvedSmsWebhookContext } from "./types";

const context: ResolvedSmsWebhookContext = {
  workspaceId: "workspace-1",
  phoneNumberId: "number-1",
  messageId: null,
  campaignId: null,
  campaignRecipientId: null,
  contactId: null,
};

describe("atomic webhook mutation payload", () => {
  it("normalizes STOP as suppress-and-stop with no resume path", () => {
    expect(normalizeWebhookConsent(" stop ", null)).toEqual({
      command: "opt_out",
      keyword: "STOP",
      suppressionAction: "upsert_and_stop",
      stopForReplyWhenAssociated: false,
      resumeCampaigns: false,
    });
  });

  it("allows START removal only when the signed event confirms opt-in", () => {
    expect(normalizeWebhookConsent("START", null)).toMatchObject({
      command: "opt_in",
      suppressionAction: "none",
      resumeCampaigns: false,
    });
    expect(normalizeWebhookConsent("START", "opt_in")).toMatchObject({
      command: "opt_in",
      suppressionAction: "remove_without_resume",
      resumeCampaigns: false,
    });
    expect(normalizeWebhookConsent("YES", "opt_in")).toMatchObject({
      command: null,
      suppressionAction: "none",
      resumeCampaigns: false,
    });
  });

  it("honors a signed provider opt-out signal for a configured custom keyword", () => {
    expect(normalizeWebhookConsent("ARRET", "opt_out")).toEqual({
      command: "opt_out",
      keyword: null,
      suppressionAction: "upsert_and_stop",
      stopForReplyWhenAssociated: false,
      resumeCampaigns: false,
    });
  });

  it("hard-codes inbound customer billing to zero in the RPC payload", () => {
    const mutation = buildVerifiedSmsWebhookMutation(
      context,
      inboundEvent(),
      { actualSegments: 3, providerCostMicroUsd: 24_000 },
    );
    expect(mutation).toMatchObject({
      kind: "inbound",
      expectedContext: context,
      usage: {
        direction: "inbound",
        numSegments: 3,
        providerCostMicroUsd: 24_000,
        includedSegments: 0,
        overageSegments: 0,
        customerBillableAmountMicroUsd: 0,
      },
    });
  });

  it("maps a late status failure before invoking the atomic RPC", () => {
    expect(
      buildVerifiedSmsWebhookMutation(
        context,
        statusEvent({ status: "failed" }),
        { actualSegments: 2, providerCostMicroUsd: 16_000 },
      ),
    ).toMatchObject({
      kind: "status",
      deliveryState: "failed",
      usage: { actualSegments: 2, providerCostMicroUsd: 16_000 },
    });
  });
});
