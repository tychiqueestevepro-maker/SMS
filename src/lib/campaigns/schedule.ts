import type { CampaignRecipientSchedule, SendWindow } from "./types";

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function zonedParts(date: Date, timeZone: string): LocalDateTime {
  const values: Record<string, string> = {};
  for (const part of getFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: date.getUTCMilliseconds(),
  };
}

function localEpoch(parts: LocalDateTime): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function offsetAt(date: Date, timeZone: string): number {
  const withoutMilliseconds = Math.trunc(date.getTime() / 1_000) * 1_000;
  const parts = zonedParts(new Date(withoutMilliseconds), timeZone);
  return localEpoch({ ...parts, millisecond: 0 }) - withoutMilliseconds;
}

function sameLocalDateTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

/**
 * Converts a wall-clock time into an instant. Ambiguous fall-back times choose
 * the earlier instant; nonexistent spring-forward times move to the first
 * equivalent wall time after the gap.
 */
function localDateTimeToDate(
  target: LocalDateTime,
  timeZone: string,
): Date {
  const targetEpoch = localEpoch(target);
  const sampleHours = [-36, -12, 0, 12, 36];
  const offsets = new Set(
    sampleHours.map((hours) =>
      offsetAt(new Date(targetEpoch + hours * 60 * 60 * 1_000), timeZone),
    ),
  );
  const candidates = Array.from(offsets, (offset) =>
    new Date(targetEpoch - offset),
  );
  const exact = candidates
    .filter((candidate) =>
      sameLocalDateTime(zonedParts(candidate, timeZone), target),
    )
    .sort((left, right) => left.getTime() - right.getTime());

  if (exact[0]) return exact[0];

  const afterGap = candidates
    .map((candidate) => ({
      candidate,
      localDifference: localEpoch(zonedParts(candidate, timeZone)) - targetEpoch,
    }))
    .filter(({ localDifference }) => localDifference >= 0)
    .sort(
      (left, right) =>
        left.localDifference - right.localDifference ||
        left.candidate.getTime() - right.candidate.getTime(),
    );

  if (afterGap[0]) return afterGap[0].candidate;
  throw new RangeError("The local date could not be resolved in this time zone.");
}

function parseInstant(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Invalid date.");
  }
  return date;
}

function parseWindowTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid send-window time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new RangeError(`Invalid send-window time: ${value}`);
  }
  return hour * 60 + minute;
}

function moveLocalCalendarDays(
  parts: LocalDateTime,
  dayCount: number,
): LocalDateTime {
  const shifted = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day + dayCount,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  };
}

function localWindowStart(
  local: LocalDateTime,
  startMinutes: number,
  dayOffset: number,
  timeZone: string,
): Date {
  const localDate = moveLocalCalendarDays(local, dayOffset);
  return localDateTimeToDate(
    {
      ...localDate,
      hour: Math.floor(startMinutes / 60),
      minute: startMinutes % 60,
      second: 0,
      millisecond: 0,
    },
    timeZone,
  );
}

export function nextAllowedSendAt(
  candidateValue: Date | string,
  window: SendWindow,
): Date {
  const candidate = parseInstant(candidateValue);
  const startMinutes = parseWindowTime(window.start);
  const endMinutes = parseWindowTime(window.end);
  if (startMinutes === endMinutes) {
    throw new RangeError("Send-window start and end must differ.");
  }

  const local = zonedParts(candidate, window.timeZone);
  const currentMinutes = local.hour * 60 + local.minute;

  if (startMinutes < endMinutes) {
    if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
      return candidate;
    }
    return localWindowStart(
      local,
      startMinutes,
      currentMinutes < startMinutes ? 0 : 1,
      window.timeZone,
    );
  }

  // Overnight window, for example 20:00–09:00.
  if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
    return candidate;
  }
  return localWindowStart(local, startMinutes, 0, window.timeZone);
}

export function addCalendarDaysInTimeZone(
  value: Date | string,
  days: number,
  timeZone: string,
): Date {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError("Calendar days must be a non-negative integer.");
  }
  const date = parseInstant(value);
  return localDateTimeToDate(
    moveLocalCalendarDays(zonedParts(date, timeZone), days),
    timeZone,
  );
}

export function calculateNextStepSendAt(
  previousSentAt: Date | string,
  waitDays: number,
  window: SendWindow,
): Date {
  if (!Number.isInteger(waitDays) || waitDays < 1 || waitDays > 365) {
    throw new RangeError("Wait days must be an integer from 1 through 365.");
  }
  const afterWait = addCalendarDaysInTimeZone(
    previousSentAt,
    waitDays,
    window.timeZone,
  );
  return nextAllowedSendAt(afterWait, window);
}

export function shiftDeadlinesForPause(
  schedules: readonly CampaignRecipientSchedule[],
  pausedAtValue: Date | string,
  resumedAtValue: Date | string,
): CampaignRecipientSchedule[] {
  const pausedAt = parseInstant(pausedAtValue);
  const resumedAt = parseInstant(resumedAtValue);
  const pauseDurationMs = resumedAt.getTime() - pausedAt.getTime();
  if (pauseDurationMs < 0) {
    throw new RangeError("Resume time cannot be before pause time.");
  }

  return schedules.map((schedule) => {
    if (schedule.state !== "active" || schedule.nextSendAt === null) {
      return { ...schedule };
    }
    const deadline = parseInstant(schedule.nextSendAt);
    return {
      ...schedule,
      nextSendAt: new Date(deadline.getTime() + pauseDurationMs).toISOString(),
    };
  });
}
