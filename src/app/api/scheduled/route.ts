import { scheduledRequestAuthorized } from "@/lib/cron-auth";
import { fail, json } from "@/lib/http";
import { logError } from "@/lib/redact";
import { runIfScheduled } from "@/lib/scheduled-entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!scheduledRequestAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const result = await runIfScheduled();
    console.log(JSON.stringify({ event: "scheduled", ran: result.ran, reason: result.reason }));
    return json(result);
  } catch (error) {
    logError("scheduled-http", error);
    return fail(error);
  }
}
