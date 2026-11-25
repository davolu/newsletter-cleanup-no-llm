import { logError } from "./lib/redact";
import { runIfScheduled } from "./lib/scheduled-entry";

runIfScheduled()
  .then((result) => {
    console.log(JSON.stringify({ event: "scheduled", ran: result.ran, reason: result.reason }));
    process.exit(0);
  })
  .catch((error: unknown) => {
    logError("scheduled-process", error);
    process.exit(1);
  });
