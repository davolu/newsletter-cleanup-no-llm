import { logError } from "../../src/lib/redact";
import { runIfScheduled } from "../../src/lib/scheduled-entry";

export default async function scheduledCleanup() {
  try {
    const result = await runIfScheduled();
    console.log(JSON.stringify({ event: "scheduled", ran: result.ran, reason: result.reason }));
  } catch (error) {
    logError("scheduled-netlify", error);
  }
  return new Response(null, { status: 204 });
}
