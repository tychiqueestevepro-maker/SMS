// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { BillingWebhookService } from "./webhook-service";
import { BillingWebhookServiceError } from "./webhook-service";
import { processBillingWebhookRequest } from "./webhook-http";

describe("processBillingWebhookRequest", () => {
  it("passes the exact raw bytes and signature to verification", async () => {
    const handleRaw = vi.fn(async () => ({ eventId: "evt_1", replayed: false }));
    const response = await processBillingWebhookRequest(
      new Request("https://www.riink.app/api/webhooks/stripe", {
        body: "{\n  \"raw\": true\n}",
        headers: { "stripe-signature": "signature" },
        method: "POST",
      }),
      {
        service: { handleRaw } as unknown as BillingWebhookService,
        webhookSecret: "secret",
      },
      "2026-08-10T12:00:00.000Z",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(handleRaw).toHaveBeenCalledWith({
      payload: Buffer.from("{\n  \"raw\": true\n}"),
      receivedAt: "2026-08-10T12:00:00.000Z",
      signature: "signature",
      webhookSecret: "secret",
    });
  });

  it("returns a stable 400 without leaking signature diagnostics", async () => {
    const handleRaw = vi.fn(async () => {
      throw new BillingWebhookServiceError("INVALID_SIGNATURE");
    });
    const response = await processBillingWebhookRequest(
      new Request("https://www.riink.app/api/webhooks/stripe", {
        body: "payload",
        headers: { "stripe-signature": "bad" },
        method: "POST",
      }),
      {
        service: { handleRaw } as unknown as BillingWebhookService,
        webhookSecret: "secret",
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ received: false });
  });

  it("returns 503 for a busy event so delivery is retried", async () => {
    const handleRaw = vi.fn(async () => {
      throw new BillingWebhookServiceError("EVENT_BUSY");
    });
    const response = await processBillingWebhookRequest(
      new Request("https://www.riink.app/api/webhooks/stripe", {
        body: "payload",
        headers: { "stripe-signature": "signature" },
        method: "POST",
      }),
      {
        service: { handleRaw } as unknown as BillingWebhookService,
        webhookSecret: "secret",
      },
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("EVENT_BUSY");
  });

  it("rejects an oversized payload before signature verification", async () => {
    const handleRaw = vi.fn();
    const response = await processBillingWebhookRequest(
      new Request("https://www.riink.app/api/webhooks/stripe", {
        body: "small-body",
        headers: {
          "content-length": "1000001",
          "stripe-signature": "signature",
        },
        method: "POST",
      }),
      {
        service: { handleRaw } as unknown as BillingWebhookService,
        webhookSecret: "secret",
      },
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ received: false });
    expect(handleRaw).not.toHaveBeenCalled();
  });

  it("enforces the byte cap even when content-length is omitted", async () => {
    const handleRaw = vi.fn();
    const response = await processBillingWebhookRequest(
      new Request("https://www.riink.app/api/webhooks/stripe", {
        body: "x".repeat(1_000_001),
        headers: { "stripe-signature": "signature" },
        method: "POST",
      }),
      {
        service: { handleRaw } as unknown as BillingWebhookService,
        webhookSecret: "secret",
      },
    );

    expect(response.status).toBe(413);
    expect(handleRaw).not.toHaveBeenCalled();
  });

  it("rejects a missing signature without reading or processing the body", async () => {
    const handleRaw = vi.fn();
    const response = await processBillingWebhookRequest(
      new Request("https://www.riink.app/api/webhooks/stripe", {
        body: "payload",
        method: "POST",
      }),
      {
        service: { handleRaw } as unknown as BillingWebhookService,
        webhookSecret: "secret",
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ received: false });
    expect(handleRaw).not.toHaveBeenCalled();
  });
});
