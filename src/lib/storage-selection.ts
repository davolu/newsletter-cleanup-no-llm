export type StorageKind = "netlify-blobs" | "upstash" | "redis" | "file";

export type RestRedisCredentials = { url: string; token: string; source: "kv" | "upstash" };

function pair(url: string | undefined, token: string | undefined): { url: string; token: string; partial: boolean } {
  const cleanUrl = url?.trim() ?? "";
  const cleanToken = token?.trim() ?? "";
  return { url: cleanUrl, token: cleanToken, partial: Boolean(cleanUrl) !== Boolean(cleanToken) };
}

/**
 * Vercel Marketplace Upstash writes KV_REST_API_URL and KV_REST_API_TOKEN.
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are the same REST API
 * under the names Upstash shows in its own console.
 */
export function readRestRedis(env: NodeJS.ProcessEnv): RestRedisCredentials | null {
  const kv = pair(env.KV_REST_API_URL, env.KV_REST_API_TOKEN);
  const upstash = pair(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  if (kv.partial || upstash.partial) {
    throw new Error(
      "Set both KV_REST_API_URL and KV_REST_API_TOKEN, or both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }
  if (kv.url && kv.token) return { url: kv.url, token: kv.token, source: "kv" };
  if (upstash.url && upstash.token) return { url: upstash.url, token: upstash.token, source: "upstash" };
  return null;
}

export function isNetlifyRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NETLIFY === "true" || env.NETLIFY === "1";
}

function isVercelDeploy(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === "1" && (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview");
}

function isRailwayDeploy(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.RAILWAY_ENVIRONMENT?.trim() || env.RAILWAY_PROJECT_ID?.trim() || env.RAILWAY_SERVICE_ID?.trim());
}

/**
 * Pick the persistent store for this process.
 * Netlify uses Blobs. REST credentials (Vercel Marketplace or a pasted Upstash pair)
 * use the Upstash HTTP client. REDIS_URL uses TCP Redis for the Railway template.
 * A laptop with none of those uses the local JSON file.
 */
export function selectStorage(env: NodeJS.ProcessEnv = process.env): StorageKind {
  if (isNetlifyRuntime(env)) return "netlify-blobs";
  if (readRestRedis(env)) return "upstash";
  if (env.REDIS_URL?.trim()) return "redis";
  if (isVercelDeploy(env)) {
    throw new Error(
      "This Vercel deploy has no Upstash REST credentials. The Deploy Button provisions them (KV_REST_API_URL and KV_REST_API_TOKEN).",
    );
  }
  if (isRailwayDeploy(env)) {
    throw new Error(
      "This Railway deploy has no REDIS_URL. The template Redis service is named Redis and is referenced as ${{Redis.REDIS_URL}}.",
    );
  }
  return "file";
}

export function storageBanner(kind: StorageKind): string {
  switch (kind) {
    case "file":
      return "This computer is saving state in .data/state.json.";
    case "netlify-blobs":
      return "State is in Netlify Blobs. No storage key to paste.";
    case "upstash":
      return "State is in Upstash Redis. No storage key to paste.";
    case "redis":
      return "State is in Railway Redis, shared by the site and the schedule.";
  }
}
