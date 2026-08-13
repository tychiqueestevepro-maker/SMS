import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/runtime/cron-auth.server";
import { runMessagingMaintenance } from "@/lib/runtime/messaging-maintenance.server";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runMessagingMaintenance());
  } catch {
    return NextResponse.json(
      { error: "Messaging maintenance couldn't be completed." },
      { status: 503 },
    );
  }
}
