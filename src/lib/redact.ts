const SECRET_ENV = [
  "TYPESAFE_API_KEY",
  "COMPOSIO_API_KEY",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "CRON_SECRET",
  "SCHEDULE_SECRET",
] as const;

export function publicError(error: unknown): string {
  let message = error instanceof Error ? error.message : "Something went wrong";
  for (const name of SECRET_ENV) {
    const secret = process.env[name];
    if (secret && secret.length >= 4) message = message.split(secret).join("[redacted]");
  }
  message = message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  message = message.replace(/\b(sk-[A-Za-z0-9_-]+)\b/g, "[redacted]");
  message = message.replace(/\b(api[_-]?key|token|secret)[=: ]+\S+/gi, "$1=[redacted]");
  return message.replace(/\s+/g, " ").trim().slice(0, 400) || "Something went wrong";
}

export function logError(event: string, error: unknown): void {
  const message = publicError(error).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  console.error(JSON.stringify({ event, message }));
}
