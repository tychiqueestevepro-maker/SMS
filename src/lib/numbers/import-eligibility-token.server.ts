import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 10 * 60;
const TOKEN_PREFIX = "v1";
const TOKEN_ALGORITHM = "aes-256-gcm";
const TOKEN_AAD = Buffer.from("riink:number-import-eligibility:v1", "utf8");

export type NumberImportCountryCode = "US" | "CA";

type EligibilityPayload = {
  countryCode: NumberImportCountryCode;
  expiresAt: number;
  nonce: string;
  phoneNumber: string;
  version: number;
  workspaceId: string;
};

export type VerifiedNumberImportEligibility = Pick<
  EligibilityPayload,
  "countryCode" | "nonce" | "phoneNumber" | "workspaceId"
>;

function encryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("Riink number import configuration is invalid.");
  }
  return key;
}

function invalidEligibility(): never {
  throw new Error("This eligibility check has expired. Check the number again.");
}

function canonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalidEligibility();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) invalidEligibility();
  return decoded;
}

export function normalizeNumberImportPhone(
  countryCode: NumberImportCountryCode,
  value: string,
): string {
  if (countryCode !== "US" && countryCode !== "CA") {
    throw new Error("This country is not supported for number import.");
  }
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  if (!/^[2-9]\d{9}$/.test(national)) {
    throw new Error("Enter a valid phone number.");
  }
  return `+1${national}`;
}

export class NumberImportEligibilityTokenSigner {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = encryptionKey(base64Key);
  }

  issue(
    eligibility: {
      countryCode: NumberImportCountryCode;
      phoneNumber: string;
      workspaceId: string;
    },
    options: { now?: Date; ttlSeconds?: number } = {},
  ): string {
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 15 * 60) {
      throw new Error("Number import eligibility TTL is invalid.");
    }
    const phoneNumber = normalizeNumberImportPhone(
      eligibility.countryCode,
      eligibility.phoneNumber,
    );
    if (!eligibility.workspaceId.trim()) {
      throw new Error("Number import eligibility data is invalid.");
    }

    const now = options.now ?? new Date();
    const payload: EligibilityPayload = {
      countryCode: eligibility.countryCode,
      expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
      nonce: randomBytes(12).toString("base64url"),
      phoneNumber,
      version: TOKEN_VERSION,
      workspaceId: eligibility.workspaceId,
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

  verify(
    token: string,
    expectedWorkspaceId: string,
    now = new Date(),
  ): VerifiedNumberImportEligibility {
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
        invalidEligibility();
      }
      const iv = canonicalBase64Url(encodedIv);
      const ciphertext = canonicalBase64Url(encodedCiphertext);
      const tag = canonicalBase64Url(encodedTag);
      if (iv.length !== 12 || tag.length !== 16) invalidEligibility();
      const decipher = createDecipheriv(TOKEN_ALGORITHM, this.key, iv);
      decipher.setAAD(TOKEN_AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
      const payload = JSON.parse(plaintext) as Partial<EligibilityPayload>;
      const nowSeconds = Math.floor(now.getTime() / 1000);
      if (
        payload.version !== TOKEN_VERSION ||
        payload.workspaceId !== expectedWorkspaceId ||
        typeof payload.expiresAt !== "number" ||
        payload.expiresAt <= nowSeconds ||
        typeof payload.nonce !== "string" ||
        payload.nonce.length < 8 ||
        (payload.countryCode !== "US" && payload.countryCode !== "CA") ||
        typeof payload.phoneNumber !== "string" ||
        normalizeNumberImportPhone(payload.countryCode, payload.phoneNumber) !==
          payload.phoneNumber
      ) {
        invalidEligibility();
      }
      return {
        countryCode: payload.countryCode,
        nonce: payload.nonce,
        phoneNumber: payload.phoneNumber,
        workspaceId: payload.workspaceId,
      };
    } catch {
      invalidEligibility();
    }
  }
}

export function numberImportEligibilitySignerFromEnvironment(): NumberImportEligibilityTokenSigner {
  const key =
    process.env.NUMBER_IMPORT_SIGNING_KEY ??
    process.env.NUMBER_SELECTION_SIGNING_KEY;
  if (!key) throw new Error("Riink number import configuration is missing.");
  return new NumberImportEligibilityTokenSigner(key);
}
