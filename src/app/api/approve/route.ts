import { createGmailClient, createGmailSession } from "@/lib/gmail";
import { fail, json, readBody } from "@/lib/http";
import { applyPending } from "@/lib/pipeline";
import { getStore } from "@/lib/redis-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const ids = Array.isArray(record.ids) ? record.ids.filter((id): id is string => typeof id === "string") : null;
    const store = getStore();
    const session = await createGmailSession();
    const pending = await applyPending(store, createGmailClient(session), ids);
    const lastResults = await store.getLastResults();
    return json({ pending, lastResults });
  } catch (error) {
    return fail(error);
  }
}
