import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  canConnectConfiguredExistingNumber,
  CONFIGURED_EXISTING_NUMBER,
} from "./configured-existing-number.server";

describe("configured existing number access", () => {
  it("allows only the configured user and email together", () => {
    expect(
      canConnectConfiguredExistingNumber({
        email: "TYCHIQUEESTEVE2005@GMAIL.COM",
        userId: "813e98ef-74da-4752-a228-3a018e56d777",
      }),
    ).toBe(true);
    expect(
      canConnectConfiguredExistingNumber({
        email: CONFIGURED_EXISTING_NUMBER.ownerEmail,
        userId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBe(false);
    expect(
      canConnectConfiguredExistingNumber({
        email: "other@example.com",
        userId: CONFIGURED_EXISTING_NUMBER.ownerUserId,
      }),
    ).toBe(false);
  });
});
