import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createBlobDocumentStore } from "./blob-store";
import { commandsFromIoredis } from "./redis-tcp";
import { createRedisStore } from "./redis-store";
import { readRestRedis, selectStorage, storageBanner } from "./storage-selection";
import { VERCEL_STORES } from "./vercel-deploy";

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values;

describe("storage adapter selection", () => {
  it("uses Netlify Blobs when the Netlify runtime is present", () => {
    expect(selectStorage(env({ NETLIFY: "true" }))).toBe("netlify-blobs");
    expect(selectStorage(env({ NETLIFY: "true", REDIS_URL: "redis://localhost:6379" }))).toBe("netlify-blobs");
    expect(storageBanner("netlify-blobs")).toMatch(/Netlify Blobs/);
  });

  it("uses Upstash REST for Vercel KV names and for Upstash names", () => {
    expect(
      selectStorage(env({ VERCEL: "1", VERCEL_ENV: "production", KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "tok" })),
    ).toBe("upstash");
    expect(readRestRedis(env({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "tok" }))).toMatchObject({
      source: "kv",
      url: "https://kv.example",
    });
    expect(
      selectStorage(
        env({ UPSTASH_REDIS_REST_URL: "https://upstash.example", UPSTASH_REDIS_REST_TOKEN: "tok" }),
      ),
    ).toBe("upstash");
    expect(readRestRedis(env({
      KV_REST_API_URL: "https://kv.example",
      KV_REST_API_TOKEN: "kv-token",
      UPSTASH_REDIS_REST_URL: "https://upstash.example",
      UPSTASH_REDIS_REST_TOKEN: "up-token",
    }))?.source).toBe("kv");
    expect(storageBanner("upstash")).toMatch(/Upstash Redis/);
  });

  it("uses TCP Redis when REDIS_URL is set and REST credentials are not", () => {
    expect(selectStorage(env({ REDIS_URL: "redis://default:secret@redis.railway.internal:6379", RAILWAY_ENVIRONMENT: "production" }))).toBe(
      "redis",
    );
    expect(storageBanner("redis")).toMatch(/Railway Redis/);
  });

  it("uses the local file on a machine with no platform storage", () => {
    expect(selectStorage(env({}))).toBe("file");
    expect(selectStorage(env({ VERCEL: "1", VERCEL_ENV: "development" }))).toBe("file");
    expect(storageBanner("file")).toMatch(/\.data\/state\.json/);
  });

  it("refuses a half-set REST pair and a hosted deploy with no store", () => {
    expect(() => selectStorage(env({ KV_REST_API_URL: "https://kv.example" }))).toThrow(/KV_REST_API_TOKEN/);
    expect(() => selectStorage(env({ UPSTASH_REDIS_REST_TOKEN: "tok" }))).toThrow(/UPSTASH_REDIS_REST_URL/);
    expect(() => selectStorage(env({ VERCEL: "1", VERCEL_ENV: "production" }))).toThrow(/Deploy Button/);
    expect(() => selectStorage(env({ VERCEL: "1", VERCEL_ENV: "preview" }))).toThrow(/Deploy Button/);
    expect(() => selectStorage(env({ RAILWAY_ENVIRONMENT: "production" }))).toThrow(/REDIS_URL/);
  });
});

describe("deploy button stores parameter", () => {
  it("matches the README and the Vercel docs shape", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const netlify = readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
    const encoded = encodeURIComponent(JSON.stringify(VERCEL_STORES));
    expect(VERCEL_STORES).toEqual([
      {
        type: "integration",
        integrationSlug: "upstash",
        productSlug: "upstash-kv",
        protocol: "storage",
      },
    ]);
    expect(readme).toContain(`stores=${encoded}`);
    expect(readme).toContain("Click a button to deploy your own copy, then paste your Composio and TypeSafe keys.");
    expect(netlify).not.toMatch(/UPSTASH_/);
    expect(netlify).toMatch(/TYPESAFE_API_KEY/);
    expect(netlify).toMatch(/COMPOSIO_API_KEY/);
  });
});

describe("adapter clients", () => {
  it("round-trips a JSON document through a blob client", async () => {
    const saved = new Map<string, string>();
    const store = createBlobDocumentStore({
      async get(key) {
        return saved.get(key) ?? null;
      },
      async set(key, value) {
        saved.set(key, value);
      },
    });
    await store.saveSettings({
      batchSize: 3,
      maxEmailsPerRun: 4,
      timeBudgetMs: 10_000,
      suggestOnly: true,
      scheduleEnabled: false,
      schedule: "hourly",
      alwaysKeepSenders: [],
    });
    expect((await store.getSettings()).batchSize).toBe(3);
    expect(saved.get("state")).toMatch(/"batchSize":3/);
  });

  it("maps an NX expiry set onto ioredis and treats a lost lock as not OK", async () => {
    const calls: unknown[][] = [];
    const client = {
      get: async () => null,
      set: async (...args: unknown[]) => {
        calls.push(args);
        return args.includes("NX") ? null : "OK";
      },
      sismember: async () => 0,
      sadd: async () => 1,
      del: async () => 1,
      lrange: async () => [],
      lpush: async () => 1,
      ltrim: async () => "OK" as const,
    };
    const store = createRedisStore(commandsFromIoredis(client));
    expect(await store.tryLock("run", 15)).toBe(false);
    expect(calls[0]).toEqual(["nlc:lock", "run", "EX", 15, "NX"]);
  });
});
