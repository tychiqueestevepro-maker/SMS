// @vitest-environment node
import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  normalizeNumberImportPhone,
  NumberImportEligibilityTokenSigner,
} from "./import-eligibility-token.server";

const NOW = new Date("2026-08-10T12:00:00.000Z");

describe("number import eligibility", () => {
  it("normalizes supported North American numbers and rejects invalid input", () => {
    expect(normalizeNumberImportPhone("US", "(512) 555-0192")).toBe(
      "+15125550192",
    );
    expect(normalizeNumberImportPhone("CA", "+1 416 555 0192")).toBe(
      "+14165550192",
    );
    expect(() => normalizeNumberImportPhone("US", "123")).toThrow(
      "valid phone number",
    );
  });

  it("issues an opaque short-lived token bound to the workspace", () => {
    const signer = new NumberImportEligibilityTokenSigner(
      randomBytes(32).toString("base64"),
    );
    const token = signer.issue(
      {
        countryCode: "US",
        phoneNumber: "+15125550192",
        workspaceId: "workspace-1",
      },
      { now: NOW, ttlSeconds: 300 },
    );

    expect(token).not.toContain("+15125550192");
    expect(
      signer.verify(token, "workspace-1", new Date("2026-08-10T12:04:59.000Z")),
    ).toEqual({
      countryCode: "US",
      nonce: expect.any(String),
      phoneNumber: "+15125550192",
      workspaceId: "workspace-1",
    });
  });

  it("rejects expiry, tampering, and cross-workspace replay", () => {
    const signer = new NumberImportEligibilityTokenSigner(
      randomBytes(32).toString("base64"),
    );
    const token = signer.issue(
      {
        countryCode: "CA",
        phoneNumber: "+14165550192",
        workspaceId: "workspace-1",
      },
      { now: NOW, ttlSeconds: 60 },
    );

    expect(() => signer.verify(token, "workspace-2", NOW)).toThrow(
      "eligibility check has expired",
    );
    expect(() => signer.verify(`${token}x`, "workspace-1", NOW)).toThrow(
      "eligibility check has expired",
    );
    expect(() =>
      signer.verify(token, "workspace-1", new Date("2026-08-10T12:01:01.000Z")),
    ).toThrow("eligibility check has expired");
  });
});
