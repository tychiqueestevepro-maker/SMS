"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const fallbackTimezone = "America/New_York";

export function TimezoneValue() {
  const timezone = useSyncExternalStore(
    subscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimezone,
    () => fallbackTimezone,
  );

  return <span>{timezone}</span>;
}
