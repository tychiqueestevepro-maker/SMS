// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applicationOrigin: vi.fn(() => "https://www.riink.app"),
  getCallbackContext: vi.fn(),
  importRuntime: vi.fn(),
  log: vi.fn(),
  messagingRuntime: vi.fn(),
  refreshImport: vi.fn(),
  verifyWebhook: vi.fn(),
}));

vi.mock("@/lib/application-url", () => ({
  getApplicationOrigin: mocks.applicationOrigin,
}));
vi.mock("@/lib/observability/logger", () => ({ logServerEvent: mocks.log }));
vi.mock("@/lib/runtime/messaging.server", () => ({
  messagingRuntimeFromEnvironment: mocks.messagingRuntime,
  numberImportServiceFromEnvironment: mocks.importRuntime,
}));

import { MAX_NUMBER_IMPORT_WEBHOOK_BODY_BYTES } from "@/lib/webhooks/number-import/http";

import { POST } from "./route";

const PROVIDER_IMPORT_ID = `HR${"a".repeat(32)}`;

function webhookRequest(input?: {
  body?: string;
  contentType?: string;
  signature?: string;
}) {
  const body =
    input?.body ??
    new URLSearchParams({
      HostedNumberOrderSid: PROVIDER_IMPORT_ID,
      PhoneNumber: "+12025550199",
      Status: "carrier-processing",
    }).toString();
  return new Request("https://untrusted-host.test/api/webhooks/number-imports", {
    method: "POST",
    headers: {
      "content-type": input?.contentType ?? "application/x-www-form-urlencoded",
      "x-twilio-signature": input?.signature ?? "signed-by-twilio",
    },
    body,
  });
}

describe("POST /api/webhooks/number-imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applicationOrigin.mockReturnValue("https://www.riink.app");
    mocks.getCallbackContext.mockResolvedValue({
      phoneNumberId: "phone-number-1",
      workspaceId: "workspace-1",
    });
    mocks.refreshImport.mockResolvedValue("importing");
    mocks.verifyWebhook.mockResolvedValue({ valid: true });
    mocks.importRuntime.mockReturnValue({
      getCallbackContext: mocks.getCallbackContext,
      refreshImport: mocks.refreshImport,
    });
    mocks.messagingRuntime.mockReturnValue({
      provider: { verifyWebhook: mocks.verifyWebhook },
      providerName: "twilio",
    });
  });

  it("verifies every callback parameter against the canonical production URL", async () => {
    const request = webhookRequest();
    const expectedParameters = Object.fromEntries(
      new URLSearchParams(await request.clone().text()),
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.getCallbackContext).toHaveBeenCalledWith(PROVIDER_IMPORT_ID);
    expect(mocks.verifyWebhook).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      url: "https://www.riink.app/api/webhooks/number-imports",
      signature: "signed-by-twilio",
      parameters: expectedParameters,
    });
    expect(mocks.refreshImport).toHaveBeenCalledWith({
      phoneNumberId: "phone-number-1",
      workspaceId: "workspace-1",
    });
  });

  it("acknowledges malformed callbacks without initializing provider services", async () => {
    const response = await POST(
      webhookRequest({
        body: "HostedNumberOrderSid=invalid&Status=completed",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.importRuntime).not.toHaveBeenCalled();
    expect(mocks.messagingRuntime).not.toHaveBeenCalled();
  });

  it("rejects duplicated parameters before signature validation", async () => {
    const body = new URLSearchParams({
      HostedNumberOrderSid: PROVIDER_IMPORT_ID,
      PhoneNumber: "+12025550199",
      Status: "pending-loa",
    }).toString();
    const response = await POST(webhookRequest({ body: `${body}&Status=completed` }));

    expect(response.status).toBe(200);
    expect(mocks.importRuntime).not.toHaveBeenCalled();
  });

  it("acknowledges an invalid signature without refreshing the import", async () => {
    mocks.verifyWebhook.mockResolvedValue({ valid: false });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.refreshImport).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(
      "warn",
      {
        event: "number_import_webhook_signature_rejected",
        workspace_id: "workspace-1",
        phone_number_id: "phone-number-1",
      },
      {},
    );
  });

  it("returns a neutral retry response when the callback arrives before correlation is durable", async () => {
    mocks.getCallbackContext.mockResolvedValue(null);

    const response = await POST(webhookRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ received: false });
    expect(mocks.messagingRuntime).not.toHaveBeenCalled();
    expect(mocks.refreshImport).not.toHaveBeenCalled();
  });

  it("acknowledges an oversized declared body before runtime initialization", async () => {
    const response = await POST(
      new Request("https://untrusted-host.test/api/webhooks/number-imports", {
        method: "POST",
        headers: {
          "content-length": String(MAX_NUMBER_IMPORT_WEBHOOK_BODY_BYTES + 1),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "small",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.importRuntime).not.toHaveBeenCalled();
  });

  it("returns a neutral 503 without leaking internal failures", async () => {
    mocks.refreshImport.mockRejectedValue(new Error("private provider detail"));

    const response = await POST(webhookRequest());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ received: false });
    expect(body).not.toContain("private provider detail");
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(
      "private provider detail",
    );
  });
});
