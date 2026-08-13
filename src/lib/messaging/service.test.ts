import { describe, expect, it } from "vitest";

import {
  ProductMessagingError,
  toProductErrorResponse,
} from "./errors";
import { MessagingService, type ProviderFailureEvent } from "./service";
import { SimulatedMessagingProvider } from "../providers/simulated";

const SEND_INPUT = {
  workspaceId: "workspace-1",
  messageId: "message-1",
  from: "+12025550101",
  to: "+12025550199",
  body: "Hello",
  idempotencyKey: "dispatch-1",
};

describe("MessagingService", () => {
  it("preserves raw provider details internally but exposes only a safe product error", async () => {
    const reports: ProviderFailureEvent[] = [];
    const rawMessage = "Gateway credential secret-value was rejected";
    const provider = new SimulatedMessagingProvider({
      failureFor: (operation) =>
        operation === "sendMessage"
          ? {
              kind: "temporary",
              providerCode: "GATEWAY_500",
              providerMessage: rawMessage,
              providerResourceId: "external-message-123",
              retryable: true,
            }
          : null,
    });
    const service = new MessagingService(provider, {
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      reportProviderFailure: (event) => {
        reports.push(event);
      },
    });

    let productError: ProductMessagingError | null = null;
    try {
      await service.sendMessage(SEND_INPUT);
    } catch (error) {
      expect(error).toBeInstanceOf(ProductMessagingError);
      productError = error as ProductMessagingError;
    }

    expect(reports).toHaveLength(1);
    expect(reports[0]?.failure.providerMessage).toBe(rawMessage);
    expect(reports[0]?.failure.providerCode).toBe("GATEWAY_500");
    expect(productError).not.toBeNull();

    const response = toProductErrorResponse(productError!);
    expect(response).toEqual({
      error: {
        code: "MESSAGE_SEND_FAILED",
        message: "Message couldn't be sent. Please try again later.",
      },
    });
    expect(JSON.stringify(response)).not.toContain(rawMessage);
    expect(JSON.stringify(response)).not.toContain("GATEWAY_500");
    expect(JSON.stringify(response)).not.toContain("external-message-123");
  });

  it("does not allow a reporting failure to replace the safe product error", async () => {
    const provider = new SimulatedMessagingProvider({
      failureFor: () => ({
        kind: "temporary",
        providerCode: null,
        providerMessage: "Internal gateway detail",
        providerResourceId: null,
        retryable: true,
      }),
    });
    const service = new MessagingService(provider, {
      reportProviderFailure: () => {
        throw new Error("Log transport failed");
      },
    });

    await expect(service.sendMessage(SEND_INPUT)).rejects.toMatchObject({
      code: "MESSAGE_SEND_FAILED",
      message: "Message couldn't be sent. Please try again later.",
    });
  });
});
