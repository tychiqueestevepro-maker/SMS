import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function associatedData(context: string): Buffer {
  if (context.length === 0) throw new Error("Credential context must not be empty.");
  return Buffer.from(`riink:credential:v1:${context}`, "utf8");
}

function decodeKey(base64Key: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(base64Key, "base64");
  } catch {
    throw new Error("Riink credential encryption configuration is invalid.");
  }
  if (key.length !== 32) {
    throw new Error("Riink credential encryption configuration is invalid.");
  }
  return key;
}

function decodePart(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Credential could not be decrypted.");
  }
  const decoded = Buffer.from(value, "base64url");
  // Reject non-canonical encodings whose unused trailing bits could otherwise
  // be changed without changing the decoded bytes.
  if (decoded.toString("base64url") !== value) {
    throw new Error("Credential could not be decrypted.");
  }
  return decoded;
}

export class CredentialVault {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = decodeKey(base64Key);
  }

  encrypt(plaintext: string, context: string): string {
    if (plaintext.length === 0) throw new Error("Credential must not be empty.");
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(associatedData(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
  }

  decrypt(envelope: string, context: string): string {
    try {
      const [version, encodedIv, encodedCiphertext, encodedTag, extra] = envelope.split(".");
      if (version !== VERSION || !encodedIv || !encodedCiphertext || !encodedTag || extra) {
        throw new Error("Invalid envelope");
      }
      const iv = decodePart(encodedIv);
      const ciphertext = decodePart(encodedCiphertext);
      const tag = decodePart(encodedTag);
      if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid envelope");

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAAD(associatedData(context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Credential could not be decrypted.");
    }
  }
}

export function credentialVaultFromEnvironment(): CredentialVault {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error("Riink credential encryption configuration is missing.");
  return new CredentialVault(key);
}
