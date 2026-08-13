import { describe, expect, it, vi } from "vitest";

import {
  decideAdminAccess,
  enforceAdminRouteAccess,
  parseAdminEmails,
} from "./access";

describe("admin authorization", () => {
  it("normalizes the configured allowlist and allows only an exact email", () => {
    expect(Array.from(parseAdminEmails(" Owner@Example.com, ops@example.com "))).toEqual([
      "owner@example.com",
      "ops@example.com",
    ]);
    expect(
      decideAdminAccess(
        { email: "OWNER@example.com", id: "user-1" },
        "owner@example.com",
      ),
    ).toEqual({ email: "owner@example.com", status: "allowed", userId: "user-1" });
  });

  it("fails closed and routes a signed-in non-admin through notFound", () => {
    const decision = decideAdminAccess(
      { email: "customer@example.com", id: "user-2" },
      "owner@example.com",
    );
    const notFound = vi.fn((): never => {
      throw new Error("NOT_FOUND");
    });
    const redirect = vi.fn((): never => {
      throw new Error("REDIRECT");
    });

    expect(() =>
      enforceAdminRouteAccess(
        decision as Exclude<typeof decision, { status: "allowed" }>,
        { notFound, redirect },
      ),
    ).toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated request without revealing the admin route", () => {
    const decision = decideAdminAccess(null, "owner@example.com");
    const notFound = vi.fn((): never => {
      throw new Error("NOT_FOUND");
    });
    const redirect = vi.fn((location: string): never => {
      throw new Error(`REDIRECT:${location}`);
    });

    expect(() =>
      enforceAdminRouteAccess(
        decision as Exclude<typeof decision, { status: "allowed" }>,
        { notFound, redirect },
      ),
    ).toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(notFound).not.toHaveBeenCalled();
  });
});
