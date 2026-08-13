// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isAuthorizedCronRequest } from "./cron-auth.server";

describe("cron authorization", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCronRequest("Bearer expected", "expected")).toBe(true);
    expect(isAuthorizedCronRequest("Bearer wrong", "expected")).toBe(false);
    expect(isAuthorizedCronRequest("expected", "expected")).toBe(false);
    expect(isAuthorizedCronRequest(null, "expected")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer expected", "")).toBe(false);
  });
});
