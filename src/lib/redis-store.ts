import { Redis } from "@upstash/redis";
import { createFileStore } from "./file-store";
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "./settings";
import { freshCursor, type Store } from "./store";
import type { HistoryEntry, PendingItem, ResultItem, ScanCursor } from "./types";

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

export function createRedisStore(redis: Redis): Store {
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

export type StorageKind = "upstash" | "file";

/** Both Upstash variables select Redis. Neither selects the local file. One of the two is a broken config. */
export function storageKind(env: NodeJS.ProcessEnv = process.env): StorageKind {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
  if (url && token) return "upstash";
  if (url || token) {
    throw new Error(
      "Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or leave both unset to use the local file store.",
    );
  }
  return "file";
}

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;
  const kind = storageKind();
  if (kind === "upstash") {
    cached = createRedisStore(
      new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!.trim(),
        token: process.env.UPSTASH_REDIS_REST_TOKEN!.trim(),
      }),
    );
  } else {
    cached = createFileStore();
  }
  return cached;
}

export function missingEnv(): string[] {
  return ["TYPESAFE_API_KEY", "COMPOSIO_API_KEY"].filter((name) => !process.env[name]?.trim());
}
