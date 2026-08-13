import type { SmsWebhookRequest } from "./types";

export const MAX_SMS_WEBHOOK_BODY_BYTES = 256 * 1024;

export interface SmsWebhookHeaderSource {
  get(name: string): string | null;
}

export interface SmsWebhookHttpInput {
  rawBody: string;
  headers: SmsWebhookHeaderSource;
  canonicalUrl: string;
  receivedAt: string;
}

/** Provider adapter seam used by the route; malformed requests return null. */
export type NormalizeSmsWebhookHttpRequest = (
  input: SmsWebhookHttpInput,
) => SmsWebhookRequest | null;

function declaredLength(headers: SmsWebhookHeaderSource): number | null {
  const value = headers.get("content-length");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

/** Reads no more than the signed-form budget and preserves UTF-8 decoding. */
export async function readBoundedSmsWebhookBody(
  request: Pick<Request, "body" | "headers">,
): Promise<string | null> {
  const length = declaredLength(request.headers);
  if (
    (length !== null && !Number.isFinite(length)) ||
    (length !== null && length > MAX_SMS_WEBHOOK_BODY_BYTES)
  ) {
    return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let bytesRead = 0;
  let decoded = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_SMS_WEBHOOK_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      decoded += decoder.decode(chunk.value, { stream: true });
    }
    return decoded + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
