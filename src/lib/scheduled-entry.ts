import { createJevCaller } from "./classify";
import { createGmailClient, createGmailSession } from "./gmail";
import { runScheduledIfEnabled } from "./pipeline";
import { logError } from "./redact";
import { scheduleDue } from "./schedule";
import { getStore } from "./redis-store";

export async function runIfScheduled(): Promise<{ ran: boolean; reason: string }> {
  const store = getStore();
  const settings = await store.getSettings();
  const gate = scheduleDue(settings, await store.getLastScheduledAt(), Date.now());
  if (!gate.due) return { ran: false, reason: gate.reason };

  try {
    const session = await createGmailSession();
    const result = await runScheduledIfEnabled({
      store,
      settings,
      gmail: createGmailClient(session),
      classifier: createJevCaller(),
    });
    return { ran: result.ran, reason: result.reason };
  } catch (error) {
    logError("scheduled-run", error);
    throw error;
  }
}
