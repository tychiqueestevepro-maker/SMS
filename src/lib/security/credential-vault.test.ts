// @vitest-environment node
import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CredentialVault } from "./credential-vault";

describe("CredentialVault", () => {
  it("round-trips credentials without placing plaintext in the envelope", () => {
    const vault = new CredentialVault(randomBytes(32).toString("base64"));
    const envelope = vault.encrypt("sensitive-value", "workspace-1:auth-token");

    expect(envelope).not.toContain("sensitive-value");
    expect(vault.decrypt(envelope, "workspace-1:auth-token")).toBe("sensitive-value");
  });

  it("rejects tampering and a different encryption key", () => {
    const vault = new CredentialVault(randomBytes(32).toString("base64"));
    const otherVault = new CredentialVault(randomBytes(32).toString("base64"));
    const envelope = vault.encrypt("sensitive-value", "workspace-1:auth-token");
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;

    expect(() => vault.decrypt(tampered, "workspace-1:auth-token")).toThrow("Credential could not be decrypted.");
    expect(() => otherVault.decrypt(envelope, "workspace-1:auth-token")).toThrow("Credential could not be decrypted.");
    expect(() => vault.decrypt(envelope, "workspace-2:auth-token")).toThrow("Credential could not be decrypted.");
  });

  it("requires an exact 32-byte key and non-empty plaintext", () => {
    expect(() => new CredentialVault(Buffer.from("short").toString("base64"))).toThrow(
      "Riink credential encryption configuration is invalid.",
    );
    const vault = new CredentialVault(randomBytes(32).toString("base64"));
    expect(() => vault.encrypt("", "workspace-1:auth-token")).toThrow("Credential must not be empty.");
    expect(() => vault.encrypt("value", "")).toThrow("Credential context must not be empty.");
  });
});
