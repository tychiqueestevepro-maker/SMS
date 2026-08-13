import { describe, expect, it } from "vitest";

import { SimulatedMessagingProvider } from "./provider";

describe("SimulatedMessagingProvider", () => {
  it("is deterministic and idempotent for the same send key", async () => {
    const provider = new SimulatedMessagingProvider({
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    });
    const input = {
      workspaceId: "workspace-1",
      messageId: "message-1",
      from: "+12025550101",
      to: "+12025550199",
      body: "a".repeat(161),
      idempotencyKey: "dispatch-1",
    };

    const first = await provider.sendMessage(input);
    const second = await provider.sendMessage(input);

    expect(second).toEqual(first);
    await expect(
      provider.getActualSegments({
        workspaceId: "workspace-1",
        providerMessageId: first.providerMessageId,
      }),
    ).resolves.toEqual({
      providerMessageId: first.providerMessageId,
      numSegments: 2,
    });
  });

  it("returns stable webhook verification results", async () => {
    const provider = new SimulatedMessagingProvider({
      validWebhookSignature: "valid-signature",
    });
    const baseInput = {
      workspaceId: "workspace-1",
      url: "https://example.test/webhook",
      parameters: { MessageId: "message-1" },
    };

    await expect(
      provider.verifyWebhook({ ...baseInput, signature: "valid-signature" }),
    ).resolves.toEqual({ valid: true });
    await expect(
      provider.verifyWebhook({ ...baseInput, signature: "invalid" }),
    ).resolves.toEqual({ valid: false });
  });
});
