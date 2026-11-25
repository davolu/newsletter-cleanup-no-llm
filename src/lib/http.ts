import { publicError } from "./redact";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function requestOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function fail(error: unknown, status = 500): Response {
  const message = publicError(error);
  const code = message.includes("already in progress") ? 409 : status;
  return json({ error: message }, code);
}
