// @vitest-environment node
import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NumberSelectionTokenSigner } from "./selection-token.server";

const NOW = new Date("2026-08-10T12:00:00.000Z");

describe("NumberSelectionTokenSigner", () => {
  it("issues a short-lived token bound to a workspace", () => {
    const signer = new NumberSelectionTokenSigner(randomBytes(32).toString("base64"));
    const token = signer.issue(
      {
        areaCode: "512",
        countryCode: "US",
        phoneNumber: "+15125550192",
        providerNumberId: "candidate-1",
        workspaceId: "workspace-1",
      },
      { now: NOW, ttlSeconds: 300 },
    );

    expect(token).not.toContain("+15125550192");
    expect(
      Buffer.from(token.split(".")[2]!, "base64url").toString("utf8"),
    ).not.toContain("candidate-1");
    expect(signer.verify(token, "workspace-1", new Date("2026-08-10T12:04:59.000Z"))).toEqual({
      areaCode: "512",
      countryCode: "US",
      nonce: expect.any(String),
      phoneNumber: "+15125550192",
      providerNumberId: "candidate-1",
      workspaceId: "workspace-1",
    });
  });

  it("issues selections for French SMS numbers without a US area code", () => {
    const signer = new NumberSelectionTokenSigner(randomBytes(32).toString("base64"));
    const token = signer.issue(
      {
        areaCode: null,
        countryCode: "FR",
        phoneNumber: "+33939031234",
        providerNumberId: "+33939031234",
        workspaceId: "workspace-1",
      },
      { now: NOW },
    );

    expect(signer.verify(token, "workspace-1", NOW)).toMatchObject({
      areaCode: null,
      countryCode: "FR",
      phoneNumber: "+33939031234",
    });
  });

  it("issues selections for Canadian SMS numbers with a NANP area code", () => {
    const signer = new NumberSelectionTokenSigner(randomBytes(32).toString("base64"));
    const token = signer.issue(
      {
        areaCode: "343",
        countryCode: "CA",
        phoneNumber: "+13435550104",
        providerNumberId: "+13435550104",
        workspaceId: "workspace-1",
      },
      { now: NOW },
    );

    expect(signer.verify(token, "workspace-1", NOW)).toMatchObject({
      areaCode: "343",
      countryCode: "CA",
      phoneNumber: "+13435550104",
    });
  });

  it("rejects expiry, tampering, and cross-workspace replay", () => {
    const signer = new NumberSelectionTokenSigner(randomBytes(32).toString("base64"));
    const token = signer.issue(
      {
        areaCode: "512",
        countryCode: "US",
        phoneNumber: "+15125550192",
        providerNumberId: "candidate-1",
        workspaceId: "workspace-1",
      },
      { now: NOW, ttlSeconds: 60 },
    );

    expect(() => signer.verify(token, "workspace-2", NOW)).toThrow("selection has expired");
    expect(() => signer.verify(`${token}x`, "workspace-1", NOW)).toThrow("selection has expired");
    expect(() => signer.verify(token, "workspace-1", new Date("2026-08-10T12:01:01.000Z"))).toThrow("selection has expired");
  });

  it("rejects non-canonical base64url encodings", () => {
    const signer = new NumberSelectionTokenSigner(randomBytes(32).toString("base64"));
    const token = signer.issue(
      {
        areaCode: "512",
        countryCode: "US",
        phoneNumber: "+15125550192",
        providerNumberId: "candidate-1",
        workspaceId: "workspace-1",
      },
      { now: NOW },
    );
    const [prefix, iv, ciphertext, tag] = token.split(".");

    expect(() => signer.verify(`${prefix}.${iv}=.${ciphertext}.${tag}`, "workspace-1", NOW)).toThrow(
      "selection has expired",
    );
    expect(() => signer.verify(`${prefix}.${iv}.${ciphertext}.${tag}=`, "workspace-1", NOW)).toThrow(
      "selection has expired",
    );
  });
});
