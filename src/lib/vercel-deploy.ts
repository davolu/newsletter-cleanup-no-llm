/**
 * Deploy Button `stores` query parameter.
 *
 * https://vercel.com/docs/deploy-button/source
 * (`stores` is a JSON-encoded array. An integration store sets `type` to
 * `integration` plus `integrationSlug` and `productSlug`. `protocol` is
 * optional; the storage example on that page sets it to `storage`.)
 *
 * https://vercel.com/marketplace/upstash/upstash-kv
 * (integration slug `upstash`, product slug `upstash-kv`).
 *
 * The integration writes KV_REST_API_URL and KV_REST_API_TOKEN. This app
 * also accepts UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
 */
export const VERCEL_UPSTASH_STORE = {
  type: "integration",
  integrationSlug: "upstash",
  productSlug: "upstash-kv",
  protocol: "storage",
} as const;

export const VERCEL_STORES = [VERCEL_UPSTASH_STORE] as const;
