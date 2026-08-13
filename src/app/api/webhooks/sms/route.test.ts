// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applicationOrigin: vi.fn(() => "https://www.riink.app"),
  log: vi.fn(),
  runtime: vi.fn(),
}));

vi.mock("@/lib/application-url", () => ({
  getApplicationOrigin: mocks.applicationOrigin,
}));
vi.mock("@/lib/observability/logger", () => ({ logServerEvent: mocks.log }));
vi.mock("@/lib/runtime/sms-webhook.server", () => ({
  smsWebhookRuntimeFromEnvironment: mocks.runtime,
}));

import type { SmsProvider } from "@/lib/messaging/provider";
import type { NormalizeSmsWebhookHttpRequest } from "@/lib/webhooks/sms/http";
import type { SmsWebhookRepository } from "@/lib/webhooks/sms/repository";
import { MAX_SMS_WEBHOOK_BODY_BYTES } from "@/lib/webhooks/sms/http";
import {
  inboundEvent,
  MemorySmsWebhookRepository,
  webhookProvider,
  webhookRequest,
} from "@/lib/webhooks/sms/test-fixtures";

import { POST } from "./route";

function request(body = "opaque=form") {
  return new Request("https://untrusted-host.test/api/webhooks/sms", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function setRuntime(input: {
  normalizeRequest: NormalizeSmsWebhookHttpRequest;
  provider: SmsProvider;
  repository: SmsWebhookRepository;
}) {
  mocks.runtime.mockReturnValue(input);
}

describe("POST /api/webhooks/sms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applicationOrigin.mockReturnValue("https://www.riink.app");
  });

  it("uses the canonical APP_URL rather than the incoming host for signature input", async () => {
    const normalizeRequest = vi.fn(() => null);
    setRuntime({
      normalizeRequest,
      provider: webhookProvider(),
      repository: new MemorySmsWebhookRepository(),
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(normalizeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalUrl: "https://www.riink.app/api/webhooks/sms",
        rawBody: "opaque=form",
      }),
    );
  });

  it("acknowledges an invalid signature with safe telemetry and no business processing", async () => {
    const malformedNormalizer = vi.fn(() => null);
    const malformedRepository = new MemorySmsWebhookRepository();
    const malformedProvider = webhookProvider();
    const signatureLookup = vi.spyOn(malformedProvider, "verifyWebhook");
    setRuntime({
      normalizeRequest: malformedNormalizer,
      provider: malformedProvider,
      repository: malformedRepository,
    });
    expect((await POST(request(`Body=${"x".repeat(1_601)}`))).status).toBe(200);
    expect(malformedRepository.transactionAttempts).toBe(0);
    expect(signatureLookup).not.toHaveBeenCalled();

    const invalidRepository = new MemorySmsWebhookRepository();
    invalidRepository.contacts.push({
      id: "contact-1",
      phoneE164: "+12025550199",
      deletedAt: null,
    });
    setRuntime({
      normalizeRequest: () => webhookRequest(inboundEvent(), "invalid"),
      provider: webhookProvider(),
      repository: invalidRepository,
    });
    const invalidResponse = await POST(request());
    expect(invalidResponse.status).toBe(200);
    expect(await invalidResponse.json()).toEqual({ received: true });
    expect(invalidRepository.transactionAttempts).toBe(0);
    expect(mocks.log).toHaveBeenCalledWith(
      "warn",
      {
        event: "signature_rejected",
        provider_message_id: "provider-inbound-1",
        workspace_id: "workspace-1",
      },
      {},
    );
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("invalid-signature");
  });

  it("acknowledges an oversized declared body before runtime initialization", async () => {
    const oversized = new Request(
      "https://untrusted-host.test/api/webhooks/sms",
      {
        method: "POST",
        headers: {
          "content-length": String(MAX_SMS_WEBHOOK_BODY_BYTES + 1),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "small-body",
      },
    );

    const response = await POST(oversized);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it("stops reading an oversized chunked body before runtime initialization", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_SMS_WEBHOOK_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const oversized = new Request(
      "https://untrusted-host.test/api/webhooks/sms",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    const response = await POST(oversized);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it("keeps webhook replay idempotent through the repository", async () => {
    const repository = new MemorySmsWebhookRepository();
    repository.contacts.push({
      id: "contact-1",
      phoneE164: "+12025550199",
      deletedAt: null,
    });
    setRuntime({
      normalizeRequest: () => webhookRequest(),
      provider: webhookProvider(),
      repository,
    });

    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    expect(repository.transactionAttempts).toBe(2);
    expect(repository.transactionProcesses).toBe(1);
    expect(repository.inboundMessages).toHaveLength(1);
  });

  it("returns a neutral 503 for retry without leaking internal errors", async () => {
    const rawInternalDetail = "private rpc failure detail";
    const repository: SmsWebhookRepository = {
      resolveWebhookContext: async () => {
        throw new Error(rawInternalDetail);
      },
      applyVerifiedEvent: async () => {
        throw new Error(rawInternalDetail);
      },
    };
    setRuntime({
      normalizeRequest: () => webhookRequest(),
      provider: webhookProvider(),
      repository,
    });

    const response = await POST(request());
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ received: false });
    expect(body).not.toContain(rawInternalDetail);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(rawInternalDetail);
    expect(mocks.log).toHaveBeenCalledWith(
      "error",
      { event: "sms_webhook_unavailable" },
      { error_code: "INTERNAL_UNAVAILABLE" },
    );
  });
});
