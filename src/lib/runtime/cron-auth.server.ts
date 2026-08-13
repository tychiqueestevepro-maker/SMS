import "server-only";

import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  configuredSecret = process.env.CRON_SECRET,
): boolean {
  if (!configuredSecret || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  const presented = authorizationHeader.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(configuredSecret, "utf8");
  const presentedBuffer = Buffer.from(presented, "utf8");
  return (
    expectedBuffer.length === presentedBuffer.length &&
    timingSafeEqual(expectedBuffer, presentedBuffer)
  );
}
