import { createJevCaller } from "@/lib/classify";
import { createGmailClient, createGmailSession } from "@/lib/gmail";
import { fail, json, readBody } from "@/lib/http";
import { executeCleanup } from "@/lib/pipeline";
import { getStore } from "@/lib/redis-store";
import { sanitizeSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Host ceiling for this route so a raised time budget is not cut off at a
// short platform default. The run itself stops at the time budget in settings.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const settings = sanitizeSettings(await readBody(request));
    const store = getStore();
    await store.saveSettings(settings);
    const session = await createGmailSession();
    const summary = await executeCleanup({
      store,
      settings,
      trigger: "manual",
      gmail: createGmailClient(session),
      classifier: createJevCaller(),
    });
    return json(summary);
  } catch (error) {
    return fail(error);
  }
}
