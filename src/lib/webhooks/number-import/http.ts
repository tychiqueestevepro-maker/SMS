export const MAX_NUMBER_IMPORT_WEBHOOK_BODY_BYTES = 32 * 1024;

const MAX_PARAMETERS = 64;
const HOSTED_NUMBER_ORDER_SID = /^HR[a-f\d]{32}$/i;
const NANP_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

export interface NumberImportWebhookHeaderSource {
  get(name: string): string | null;
}

export interface NumberImportWebhookRequest {
  parameters: Readonly<Record<string, string>>;
  phoneNumber: string;
  providerImportId: string;
  providerStatus: string;
  signature: string;
}

function declaredLength(headers: NumberImportWebhookHeaderSource): number | null {
  const value = headers.get("content-length");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function isFormContentType(value: string | null): boolean {
  return (
    value?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/x-www-form-urlencoded"
  );
}

function parseEveryParameter(rawBody: string): Record<string, string> | null {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_NUMBER_IMPORT_WEBHOOK_BODY_BYTES) {
    return null;
  }

  const parsed = new URLSearchParams(rawBody);
  const parameters: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of parsed) {
    count += 1;
    if (
      count > MAX_PARAMETERS ||
      !key ||
      Object.prototype.hasOwnProperty.call(parameters, key)
    ) {
      return null;
    }
    parameters[key] = value;
  }
  return count > 0 ? parameters : null;
}

export async function readBoundedNumberImportWebhookBody(
  request: Pick<Request, "body" | "headers">,
): Promise<string | null> {
  const length = declaredLength(request.headers);
  if (
    (length !== null && !Number.isFinite(length)) ||
    (length !== null && length > MAX_NUMBER_IMPORT_WEBHOOK_BODY_BYTES)
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
      if (bytesRead > MAX_NUMBER_IMPORT_WEBHOOK_BODY_BYTES) {
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

export function normalizeNumberImportWebhookRequest(input: {
  headers: NumberImportWebhookHeaderSource;
  rawBody: string;
}): NumberImportWebhookRequest | null {
  if (!isFormContentType(input.headers.get("content-type"))) return null;
  const parameters = parseEveryParameter(input.rawBody);
  if (!parameters) return null;

  const providerImportId = parameters.HostedNumberOrderSid?.trim();
  const providerStatus = parameters.Status?.trim();
  const phoneNumber = parameters.PhoneNumber?.trim();
  const signature = input.headers.get("x-twilio-signature")?.trim();
  if (
    !providerImportId ||
    !HOSTED_NUMBER_ORDER_SID.test(providerImportId) ||
    !providerStatus ||
    providerStatus.length > 64 ||
    !phoneNumber ||
    !NANP_E164.test(phoneNumber) ||
    !signature
  ) {
    return null;
  }

  return {
    parameters,
    phoneNumber,
    providerImportId,
    providerStatus,
    signature,
  };
}
