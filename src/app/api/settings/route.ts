import { fail, json, readBody } from "@/lib/http";
import { getStore } from "@/lib/redis-store";
import { freshCursor } from "@/lib/store";
import { sanitizeSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const settings = sanitizeSettings(await readBody(request));
    const store = getStore();
    await store.saveSettings(settings);
    return json({ settings });
  } catch (error) {
    return fail(error);
  }
}

export async function POST() {
  try {
    const store = getStore();
    await store.saveCursor(freshCursor());
    await store.savePending([]);
    await store.clearHandled();
    return json({ reset: true });
  } catch (error) {
    return fail(error);
  }
}
