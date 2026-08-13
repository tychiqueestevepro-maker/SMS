import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { parseAndNormalizePhoneNumber } from "@/lib/contacts/phone";

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 5 * 60;
const TOKEN_PREFIX = "v1";
const TOKEN_ALGORITHM = "aes-256-gcm";
const TOKEN_AAD = Buffer.from("riink:number-selection:v1", "utf8");
type SelectionCountryCode = "US" | "CA" | "FR";

type SelectionPayload = {
  areaCode: string | null;
  countryCode: SelectionCountryCode;
  expiresAt: number;
  nonce: string;
  phoneNumber: string;
  providerNumberId: string;
  version: number;
  workspaceId: string;
};

export type VerifiedNumberSelection = Pick<
  SelectionPayload,
  "areaCode" | "countryCode" | "nonce" | "phoneNumber" | "providerNumberId" | "workspaceId"
>;

function validPhoneNumber(phoneNumber: string, countryCode: SelectionCountryCode): boolean {
  const normalized = parseAndNormalizePhoneNumber(phoneNumber);
  return normalized?.phoneE164 === phoneNumber && normalized.countryCode === countryCode;
}

function validAreaCode(countryCode: SelectionCountryCode, areaCode: string | null): boolean {
  return countryCode === "FR" ? areaCode === null : /^\d{3}$/.test(areaCode ?? "");
}

function signingKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("Riink number selection configuration is invalid.");
  return key;
}

function invalidSelection(): never {
  throw new Error("This phone number selection has expired. Search again.");
}

function canonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalidSelection();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) invalidSelection();
  return decoded;
}

export class NumberSelectionTokenSigner {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = signingKey(base64Key);
  }

  issue(
    selection: {
      areaCode: string | null;
      countryCode: SelectionCountryCode;
      phoneNumber: string;
      providerNumberId: string;
      workspaceId: string;
    },
    options: { now?: Date; ttlSeconds?: number } = {},
  ): string {
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 15 * 60) {
      throw new Error("Number selection TTL is invalid.");
    }
    if (
      !validAreaCode(selection.countryCode, selection.areaCode) ||
      !validPhoneNumber(selection.phoneNumber, selection.countryCode) ||
      !selection.providerNumberId.trim() ||
      selection.providerNumberId.length > 255 ||
      !selection.workspaceId
    ) {
      throw new Error("Number selection data is invalid.");
    }

    const now = options.now ?? new Date();
    const payload: SelectionPayload = {
      areaCode: selection.areaCode,
      countryCode: selection.countryCode,
      expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
      nonce: randomBytes(12).toString("base64url"),
      phoneNumber: selection.phoneNumber,
      providerNumberId: selection.providerNumberId,
      version: TOKEN_VERSION,
      workspaceId: selection.workspaceId,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv(TOKEN_ALGORITHM, this.key, iv);
    cipher.setAAD(TOKEN_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      TOKEN_PREFIX,
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join(".");
  }

  verify(token: string, expectedWorkspaceId: string, now = new Date()): VerifiedNumberSelection {
    try {
      const [prefix, encodedIv, encodedCiphertext, encodedTag, extra] =
        token.split(".");
      if (
        prefix !== TOKEN_PREFIX ||
        !encodedIv ||
        !encodedCiphertext ||
        !encodedTag ||
        extra
      ) {
        invalidSelection();
      }
      const iv = canonicalBase64Url(encodedIv);
      const ciphertext = canonicalBase64Url(encodedCiphertext);
      const tag = canonicalBase64Url(encodedTag);
      if (iv.length !== 12 || tag.length !== 16) invalidSelection();
      const decipher = createDecipheriv(TOKEN_ALGORITHM, this.key, iv);
      decipher.setAAD(TOKEN_AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
      const payload = JSON.parse(plaintext) as Partial<SelectionPayload>;
      const currentEpochSeconds = Math.floor(now.getTime() / 1000);
      if (
        payload.version !== TOKEN_VERSION ||
        payload.workspaceId !== expectedWorkspaceId ||
        typeof payload.expiresAt !== "number" ||
        payload.expiresAt <= currentEpochSeconds ||
        typeof payload.nonce !== "string" ||
        payload.nonce.length < 8 ||
        typeof payload.providerNumberId !== "string" ||
        !payload.providerNumberId.trim() ||
        payload.providerNumberId.length > 255 ||
        (payload.countryCode !== "US" &&
          payload.countryCode !== "CA" &&
          payload.countryCode !== "FR") ||
        !validAreaCode(payload.countryCode, payload.areaCode ?? null) ||
        typeof payload.phoneNumber !== "string" ||
        !validPhoneNumber(
          payload.phoneNumber,
          payload.countryCode,
        )
      ) {
        invalidSelection();
      }
      return {
        areaCode: payload.areaCode,
        countryCode: payload.countryCode,
        nonce: payload.nonce,
        phoneNumber: payload.phoneNumber,
        providerNumberId: payload.providerNumberId,
        workspaceId: payload.workspaceId,
      } as VerifiedNumberSelection;
    } catch {
      invalidSelection();
    }
  }
}

export function numberSelectionSignerFromEnvironment(): NumberSelectionTokenSigner {
  const key = process.env.NUMBER_SELECTION_SIGNING_KEY;
  if (!key) throw new Error("Riink number selection configuration is missing.");
  return new NumberSelectionTokenSigner(key);
}
