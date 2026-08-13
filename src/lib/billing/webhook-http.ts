import "server-only";

import type { BillingWebhookService } from "./webhook-service";
import { BillingWebhookServiceError } from "./webhook-service";

const MAX_WEBHOOK_BYTES = 1_000_000;
export const BILLING_WEBHOOK_ACKNOWLEDGEMENT = Object.freeze({ received: true });
const BILLING_WEBHOOK_REJECTION = Object.freeze({ received: false });

export interface BillingWebhookHttpRuntime {
  service: BillingWebhookService;
  webhookSecret: string;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

async function readBoundedPayload(request: Request): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The size rejection is authoritative even if the sender has already
        // interrupted the stream.
      }
      return null;
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function processBillingWebhookRequest(
  request: Request,
  runtime: BillingWebhookHttpRuntime,
  receivedAt = new Date().toISOString(),
): Promise<Response> {
  const signature = request.headers.get("stripe-signature")?.trim();
  if (!signature) return json(BILLING_WEBHOOK_REJECTION, 400);
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return json(BILLING_WEBHOOK_REJECTION, 413);
  }

  try {
    // Signature verification receives the exact, unparsed request bytes. The
    // bounded reader also protects requests with a missing/incorrect length.
    const payload = await readBoundedPayload(request);
    if (!payload) {
      return json(BILLING_WEBHOOK_REJECTION, 413);
    }
    await runtime.service.handleRaw({
      payload,
      receivedAt,
      signature,
      webhookSecret: runtime.webhookSecret,
    });
    return json(BILLING_WEBHOOK_ACKNOWLEDGEMENT, 200);
  } catch (error) {
    if (
      error instanceof BillingWebhookServiceError &&
      error.code === "INVALID_SIGNATURE"
    ) {
      return json(BILLING_WEBHOOK_REJECTION, 400);
    }
    return json(BILLING_WEBHOOK_REJECTION, 503);
  }
}
