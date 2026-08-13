import { describe, expect, it } from "vitest";

import {
  actualizeOutboundReservation,
  cancelOutboundReservation,
  reserveOutboundUsage,
} from "./reservations";

describe("outbound usage reservations", () => {
  it("allows exactly 10,000 credits and rejects anything above the cap", () => {
    const atCap = reserveOutboundUsage(
      {
        actualOutboundSegments: 9_998,
        reservedOutboundSegments: 0,
        safetyCapSegments: 10_000,
      },
      "reservation-1",
      2,
    );
    expect(atCap).toMatchObject({
      accepted: true,
      effectiveUsage: 10_000,
      safetyCapReached: true,
    });

    const rejected = reserveOutboundUsage(
      atCap.usage,
      "reservation-2",
      1,
    );
    expect(rejected).toMatchObject({
      accepted: false,
      effectiveUsage: 10_000,
      error: "SAFETY_CAP_REACHED",
    });
  });

  it("atomically replaces an estimate with actual usage without double counting", () => {
    const reserved = reserveOutboundUsage(
      {
        actualOutboundSegments: 1_999,
        reservedOutboundSegments: 0,
        safetyCapSegments: 10_000,
      },
      "reservation-1",
      2,
    );
    const actualized = actualizeOutboundReservation(
      reserved.usage,
      reserved.reservation!,
      3,
    );
    expect(actualized.usage).toEqual({
      actualOutboundSegments: 2_002,
      reservedOutboundSegments: 0,
      safetyCapSegments: 10_000,
    });
    expect(actualized.effectiveUsage).toBe(2_002);

    const replay = actualizeOutboundReservation(
      actualized.usage,
      actualized.reservation,
      3,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.usage).toEqual(actualized.usage);
  });

  it("halts new usage if real usage was underestimated past the safety cap", () => {
    const reserved = reserveOutboundUsage(
      {
        actualOutboundSegments: 9_998,
        reservedOutboundSegments: 0,
        safetyCapSegments: 10_000,
      },
      "reservation-1",
      1,
    );
    const actualized = actualizeOutboundReservation(
      reserved.usage,
      reserved.reservation!,
      3,
    );
    expect(actualized).toMatchObject({
      effectiveUsage: 10_001,
      safetyCapReached: true,
      replayed: false,
    });
    expect(
      reserveOutboundUsage(actualized.usage, "reservation-2", 1).accepted,
    ).toBe(false);
  });

  it("releases a canceled estimate once and cannot cancel actual usage", () => {
    const reserved = reserveOutboundUsage(
      {
        actualOutboundSegments: 10,
        reservedOutboundSegments: 2,
        safetyCapSegments: 10_000,
      },
      "reservation-1",
      3,
    );
    const canceled = cancelOutboundReservation(
      reserved.usage,
      reserved.reservation!,
    );
    expect(canceled.usage.reservedOutboundSegments).toBe(2);
    expect(cancelOutboundReservation(canceled.usage, canceled.reservation).replayed).toBe(
      true,
    );

    const another = reserveOutboundUsage(canceled.usage, "reservation-2", 1);
    const actualized = actualizeOutboundReservation(
      another.usage,
      another.reservation!,
      1,
    );
    expect(() =>
      cancelOutboundReservation(actualized.usage, actualized.reservation),
    ).toThrow(/cannot be canceled/i);
  });
});

