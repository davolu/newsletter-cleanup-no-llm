import { Redis } from "@upstash/redis";
import { createNetlifyBlobStore } from "./blob-store";
import { createFileStore } from "./file-store";
import { connectTcpRedis } from "./redis-tcp";
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "./settings";
import { readRestRedis, selectStorage, type StorageKind } from "./storage-selection";
import { freshCursor, type Store } from "./store";
import type { HistoryEntry, PendingItem, ResultItem, ScanCursor } from "./types";

export type { StorageKind };

export type RedisCommands = {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options?: { nx?: boolean; ex?: number }): Promise<string | null>;
  sismember(key: string, member: string): Promise<number>;
  sadd(key: string, member: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
};

export function commandsFromUpstash(redis: Redis): RedisCommands {
  return {
    get: (key) => redis.get(key),
    async set(key, value, options) {
      if (options?.nx && options.ex) {
        const result = await redis.set(key, value, { nx: true, ex: options.ex });
        return result === "OK" ? "OK" : null;
      }
      await redis.set(key, value);
      return "OK";
    },
    async sismember(key, member) {
      return Number(await redis.sismember(key, member));
    },
    sadd: (key, member) => redis.sadd(key, member),
    del: (key) => redis.del(key),
    async lrange(key, start, stop) {
      const rows = await redis.lrange(key, start, stop);
      return Array.isArray(rows) ? rows : [];
    },
    lpush: (key, value) => redis.lpush(key, value),
    ltrim: (key, start, stop) => redis.ltrim(key, start, stop),
  };
}

const KEYS = {
  settings: "nlc:settings",
  cursor: "nlc:cursor",
  pending: "nlc:pending",
  results: "nlc:last-results",
  history: "nlc:history",
  handled: "nlc:handled",
  scheduledAt: "nlc:last-scheduled-at",
  lock: "nlc:lock",
} as const;

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as T;
  return null;
}

export function createRedisStore(redis: RedisCommands): Store {
  return {
    async getSettings() {
      const parsed = parseJson<unknown>(await redis.get(KEYS.settings));
      return parsed ? sanitizeSettings(parsed) : { ...DEFAULT_SETTINGS, alwaysKeepSenders: [] };
    },
    async saveSettings(settings) {
      await redis.set(KEYS.settings, JSON.stringify(sanitizeSettings(settings)));
    },
    async getCursor() {
      return parseJson<ScanCursor>(await redis.get(KEYS.cursor)) ?? freshCursor();
    },
    async saveCursor(cursor) {
      await redis.set(KEYS.cursor, JSON.stringify(cursor));
    },
    async isHandled(messageId) {
      const found = await redis.sismember(KEYS.handled, messageId);
      return Number(found) === 1;
    },
    async markHandled(messageId) {
      await redis.sadd(KEYS.handled, messageId);
    },
    async clearHandled() {
      await redis.del(KEYS.handled);
    },
    async getPending() {
      return parseJson<PendingItem[]>(await redis.get(KEYS.pending)) ?? [];
    },
    async savePending(items) {
      await redis.set(KEYS.pending, JSON.stringify(items));
    },
    async getLastResults() {
      return parseJson<ResultItem[]>(await redis.get(KEYS.results)) ?? [];
    },
    async saveLastResults(items) {
      await redis.set(KEYS.results, JSON.stringify(items.slice(0, 100)));
    },
    async getHistory() {
      const rows = await redis.lrange(KEYS.history, 0, 29);
      return rows
        .map((row) => parseJson<HistoryEntry>(row))
        .filter((row): row is HistoryEntry => row !== null);
    },
    async appendHistory(entry) {
      await redis.lpush(KEYS.history, JSON.stringify(entry));
      await redis.ltrim(KEYS.history, 0, 29);
    },
    async getLastScheduledAt() {
      const value = await redis.get(KEYS.scheduledAt);
      return typeof value === "string" && value ? value : null;
    },
    async setLastScheduledAt(iso) {
      await redis.set(KEYS.scheduledAt, iso);
    },
    async tryLock(owner, ttlSeconds) {
      const result = await redis.set(KEYS.lock, owner, { nx: true, ex: ttlSeconds });
      return result === "OK";
    },
    async unlock(owner) {
      const current = await redis.get(KEYS.lock);
      if (current === owner) await redis.del(KEYS.lock);
    },
  };
}

let cached: Store | null = null;

export function openStore(kind: StorageKind, env: NodeJS.ProcessEnv = process.env): Store {
  if (kind === "netlify-blobs") return createNetlifyBlobStore();
  if (kind === "upstash") {
    const credentials = readRestRedis(env);
    if (!credentials) throw new Error("Upstash REST credentials are missing.");
    return createRedisStore(commandsFromUpstash(new Redis({ url: credentials.url, token: credentials.token })));
  }
  if (kind === "redis") {
    const url = env.REDIS_URL?.trim();
    if (!url) throw new Error("REDIS_URL is missing.");
    return createRedisStore(connectTcpRedis(url));
  }
  return createFileStore();
}

export function getStore(): Store {
  if (cached) return cached;
  cached = openStore(selectStorage());
  return cached;
}

export function missingEnv(): string[] {
  return ["TYPESAFE_API_KEY", "COMPOSIO_API_KEY"].filter((name) => !process.env[name]?.trim());
}
