import { describe, expect, it } from "vitest";

import { toDeliveryState } from "./status";

describe("SMS status mapping", () => {
  it.each([
    ["queued", null],
    ["accepted", null],
    ["unknown", null],
    ["sent", "sent"],
    ["delivered", "delivered"],
    ["failed", "failed"],
  ] as const)("maps %s to %s", (providerStatus, deliveryState) => {
    expect(toDeliveryState(providerStatus)).toBe(deliveryState);
  });
});

