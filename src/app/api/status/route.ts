import { gmailConnectionStatus, createGmailSession } from "@/lib/gmail";
import { fail, json } from "@/lib/http";
import { logError } from "@/lib/redact";
import { missingEnv, getStore } from "@/lib/redis-store";
import { DEFAULT_SETTINGS } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const missing = missingEnv();
  if (missing.includes("UPSTASH_REDIS_REST_URL") || missing.includes("UPSTASH_REDIS_REST_TOKEN")) {
    return json({
      ready: false,
      missingEnv: missing,
      settings: DEFAULT_SETTINGS,
      gmail: { connected: false, accountId: null },
      pending: [],
      lastResults: [],
      history: [],
      cursor: { completed: false, pendingCount: 0 },
    });
  }

  try {
    const store = getStore();
    const [settings, pending, lastResults, history, cursor, lastScheduledAt] = await Promise.all([
      store.getSettings(),
      store.getPending(),
      store.getLastResults(),
      store.getHistory(),
      store.getCursor(),
      store.getLastScheduledAt(),
    ]);

    let gmail = { connected: false, accountId: null as string | null, error: null as string | null };
    if (!missing.includes("COMPOSIO_API_KEY")) {
      try {
        const session = await createGmailSession();
        const status = await gmailConnectionStatus(session);
        gmail = { ...status, error: null };
      } catch (error) {
        logError("gmail-status", error);
        gmail = { connected: false, accountId: null, error: "Gmail status could not be checked." };
      }
    }

    return json({
      ready: missing.length === 0,
      missingEnv: missing,
      settings,
      gmail,
      pending,
      lastResults,
      history,
      cursor: { completed: cursor.completed, pendingCount: cursor.pendingIds.length },
      schedule: {
        enabled: settings.scheduleEnabled,
        frequency: settings.schedule,
        lastRunAt: lastScheduledAt,
      },
    });
  } catch (error) {
    logError("status", error);
    return fail(error);
  }
}
