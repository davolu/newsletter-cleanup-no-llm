import type { InspectableMessage } from "./candidates";
import { RECENT_QUERY, type Settings } from "./settings";
import type { HistoryEntry, PendingItem, ResultItem, ScanCursor } from "./types";

export type Store = {
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  getCursor(): Promise<ScanCursor>;
  saveCursor(cursor: ScanCursor): Promise<void>;
  isHandled(messageId: string): Promise<boolean>;
  markHandled(messageId: string): Promise<void>;
  clearHandled(): Promise<void>;
  getPending(): Promise<PendingItem[]>;
  savePending(items: PendingItem[]): Promise<void>;
  getLastResults(): Promise<ResultItem[]>;
  saveLastResults(items: ResultItem[]): Promise<void>;
  getHistory(): Promise<HistoryEntry[]>;
  appendHistory(entry: HistoryEntry): Promise<void>;
  getLastScheduledAt(): Promise<string | null>;
  setLastScheduledAt(iso: string): Promise<void>;
  tryLock(owner: string, ttlSeconds: number): Promise<boolean>;
  unlock(owner: string): Promise<void>;
};

export function freshCursor(): ScanCursor {
  return {
    query: RECENT_QUERY,
    pageToken: null,
    pendingIds: [],
    endOfPages: false,
    completed: false,
  };
}

export function createMemoryStore(initial?: Partial<{ settings: Settings }>): Store & {
  handled: Set<string>;
} {
  let settings = initial?.settings;
  let cursor = freshCursor();
  const handled = new Set<string>();
  let pending: PendingItem[] = [];
  let lastResults: ResultItem[] = [];
  let history: HistoryEntry[] = [];
  let lastScheduledAt: string | null = null;
  let lock: { owner: string; expires: number } | null = null;

  return {
    handled,
    async getSettings() {
      if (!settings) {
        const { DEFAULT_SETTINGS } = await import("./settings");
        settings = { ...DEFAULT_SETTINGS, alwaysKeepSenders: [] };
      }
      return structuredClone(settings);
    },
    async saveSettings(next) {
      settings = structuredClone(next);
    },
    async getCursor() {
      return structuredClone(cursor);
    },
    async saveCursor(next) {
      cursor = structuredClone(next);
    },
    async isHandled(messageId) {
      return handled.has(messageId);
    },
    async markHandled(messageId) {
      handled.add(messageId);
    },
    async clearHandled() {
      handled.clear();
    },
    async getPending() {
      return structuredClone(pending);
    },
    async savePending(items) {
      pending = structuredClone(items);
    },
    async getLastResults() {
      return structuredClone(lastResults);
    },
    async saveLastResults(items) {
      lastResults = structuredClone(items).slice(0, 100);
    },
    async getHistory() {
      return structuredClone(history);
    },
    async appendHistory(entry) {
      history = [structuredClone(entry), ...history].slice(0, 30);
    },
    async getLastScheduledAt() {
      return lastScheduledAt;
    },
    async setLastScheduledAt(iso) {
      lastScheduledAt = iso;
    },
    async tryLock(owner, ttlSeconds) {
      const now = Date.now();
      if (lock && lock.expires > now && lock.owner !== owner) return false;
      lock = { owner, expires: now + ttlSeconds * 1000 };
      return true;
    },
    async unlock(owner) {
      if (lock?.owner === owner) lock = null;
    },
  };
}

export type ListedPage = {
  messages: InspectableMessage[];
  nextPageToken: string | null;
};
