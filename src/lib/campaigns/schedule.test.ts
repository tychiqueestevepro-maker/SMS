import { describe, expect, it } from "vitest";

import {
  addCalendarDaysInTimeZone,
  calculateNextStepSendAt,
  nextAllowedSendAt,
  shiftDeadlinesForPause,
} from "./schedule";

const NEW_YORK_WINDOW = {
  timeZone: "America/New_York",
  start: "09:00",
  end: "20:00",
};

describe("send-window scheduling", () => {
  it("keeps an instant inside the window and moves early/late instants", () => {
    expect(
      nextAllowedSendAt("2026-08-10T15:00:00.000Z", NEW_YORK_WINDOW).toISOString(),
    ).toBe("2026-08-10T15:00:00.000Z");
    expect(
      nextAllowedSendAt("2026-08-10T11:00:00.000Z", NEW_YORK_WINDOW).toISOString(),
    ).toBe("2026-08-10T13:00:00.000Z");
    expect(
      nextAllowedSendAt("2026-08-11T00:00:00.000Z", NEW_YORK_WINDOW).toISOString(),
    ).toBe("2026-08-11T13:00:00.000Z");
  });

  it("uses calendar days and preserves local time across spring DST", () => {
    const beforeSpringChange = "2026-03-07T15:00:00.000Z"; // 10:00 EST
    expect(
      addCalendarDaysInTimeZone(
        beforeSpringChange,
        1,
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-03-08T14:00:00.000Z"); // 10:00 EDT
    expect(
      calculateNextStepSendAt(
        beforeSpringChange,
        1,
        NEW_YORK_WINDOW,
      ).toISOString(),
    ).toBe("2026-03-08T14:00:00.000Z");
  });

  it("preserves local time across fall DST", () => {
    const beforeFallChange = "2026-10-31T14:00:00.000Z"; // 10:00 EDT
    expect(
      addCalendarDaysInTimeZone(
        beforeFallChange,
        1,
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-11-01T15:00:00.000Z"); // 10:00 EST
  });

  it("moves a post-window deadline to 09:00 after a DST boundary", () => {
    expect(
      nextAllowedSendAt("2026-03-08T01:30:00.000Z", NEW_YORK_WINDOW).toISOString(),
    ).toBe("2026-03-08T13:00:00.000Z");
  });

  it("supports overnight windows without changing an allowed instant", () => {
    const overnight = {
      timeZone: "America/New_York",
      start: "20:00",
      end: "09:00",
    };
    expect(
      nextAllowedSendAt("2026-08-10T06:00:00.000Z", overnight).toISOString(),
    ).toBe("2026-08-10T06:00:00.000Z");
    expect(
      nextAllowedSendAt("2026-08-10T16:00:00.000Z", overnight).toISOString(),
    ).toBe("2026-08-11T00:00:00.000Z");
  });
});

describe("pause/resume scheduling", () => {
  it("shifts only active non-null deadlines by the exact pause duration", () => {
    expect(
      shiftDeadlinesForPause(
        [
          {
            id: "active",
            state: "active",
            nextSendAt: "2026-08-10T16:00:00.000Z",
          },
          {
            id: "replied",
            state: "stopped",
            nextSendAt: null,
          },
          {
            id: "failed",
            state: "stopped",
            nextSendAt: "2026-08-10T17:00:00.000Z",
          },
        ],
        "2026-08-10T10:00:00.000Z",
        "2026-08-10T11:30:00.000Z",
      ),
    ).toEqual([
      {
        id: "active",
        state: "active",
        nextSendAt: "2026-08-10T17:30:00.000Z",
      },
      { id: "replied", state: "stopped", nextSendAt: null },
      {
        id: "failed",
        state: "stopped",
        nextSendAt: "2026-08-10T17:00:00.000Z",
      },
    ]);
  });
});
