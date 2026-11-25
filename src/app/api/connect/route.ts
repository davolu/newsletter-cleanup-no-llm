import { createGmailSession } from "@/lib/gmail";
import { fail, json, requestOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await createGmailSession();
    const connection = await session.authorize("gmail", {
      callbackUrl: `${requestOrigin(request)}/?connected=1`,
    });
    if (!connection.redirectUrl) {
      return json({ error: "Composio did not return a Gmail connect link." }, 502);
    }
    return json({ redirectUrl: connection.redirectUrl });
  } catch (error) {
    return fail(error);
  }
}
