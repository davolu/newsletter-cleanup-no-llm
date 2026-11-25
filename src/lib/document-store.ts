import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "./settings";
import { freshCursor, type Store } from "./store";
import type { HistoryEntry, PendingItem, ResultItem, ScanCursor } from "./types";

type DocumentLock = { owner: string; expires: number };

type DocumentState = {
  settings: Settings | null;
  cursor: ScanCursor;
  handled: string[];
  pending: PendingItem[];
  lastResults: ResultItem[];
  history: HistoryEntry[];
  lastScheduledAt: string | null;
  lock: DocumentLock | null;
};

function emptyState(): DocumentState {
  return {
    settings: null,
    cursor: freshCursor(),
    handled: [],
    pending: [],
    lastResults: [],
    history: [],
    lastScheduledAt: null,
    lock: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function normalize(value: unknown): DocumentState {
  const record = asRecord(value);
  if (!record) return emptyState();
  const cursorRecord = asRecord(record.cursor);
  const lockRecord = asRecord(record.lock);
  const base = freshCursor();
  return {
    settings: record.settings ? sanitizeSettings(record.settings) : null,
    cursor: {
      ...base,
      ...(cursorRecord ?? {}),
      query: typeof cursorRecord?.query === "string" ? cursorRecord.query : base.query,
      pageToken: typeof cursorRecord?.pageToken === "string" ? cursorRecord.pageToken : null,
      pendingIds: Array.isArray(cursorRecord?.pendingIds)
        ? cursorRecord.pendingIds.filter((id): id is string => typeof id === "string")
        : [],
      endOfPages: cursorRecord?.endOfPages === true,
      completed: cursorRecord?.completed === true,
    },
    handled: Array.isArray(record.handled) ? record.handled.filter((id): id is string => typeof id === "string") : [],
    pending: Array.isArray(record.pending) ? (record.pending as PendingItem[]) : [],
    lastResults: Array.isArray(record.lastResults) ? (record.lastResults as ResultItem[]) : [],
    history: Array.isArray(record.history) ? (record.history as HistoryEntry[]) : [],
    lastScheduledAt: typeof record.lastScheduledAt === "string" ? record.lastScheduledAt : null,
    lock:
      lockRecord && typeof lockRecord.owner === "string" && typeof lockRecord.expires === "number"
        ? { owner: lockRecord.owner, expires: lockRecord.expires }
        : null,
  };
}

export function createDocumentStore(
  read: () => Promise<string | null>,
  write: (text: string) => Promise<void>,
  invalidJsonMessage = "The local state file is not valid JSON.",
): Store {
  let tail: Promise<unknown> = Promise.resolve();

  async function readState(): Promise<DocumentState> {
    const text = await read();
    if (!text?.trim()) return emptyState();
    try {
      return normalize(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof Error && error.message === invalidJsonMessage) throw error;
      throw new Error(invalidJsonMessage);
    }
  }

  function exclusive<T>(work: (state: DocumentState) => Promise<T> | T, persist: boolean): Promise<T> {
    const run = tail.then(async () => {
      const state = await readState();
      const result = await work(state);
      if (persist) await write(JSON.stringify(state));
      return result;
    });
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const defaults = (): Settings => ({ ...DEFAULT_SETTINGS, alwaysKeepSenders: [] });

  return {
    getSettings() {
      return exclusive((state) => (state.settings ? sanitizeSettings(state.settings) : defaults()), false);
    },
    saveSettings(settings) {
      return exclusive((state) => {
        state.settings = sanitizeSettings(settings);
      }, true);
    },
    getCursor() {
      return exclusive((state) => structuredClone(state.cursor), false);
    },
    saveCursor(cursor) {
      return exclusive((state) => {
        state.cursor = structuredClone(cursor);
      }, true);
    },
    isHandled(messageId) {
      return exclusive((state) => state.handled.includes(messageId), false);
    },
    markHandled(messageId) {
      return exclusive((state) => {
        if (!state.handled.includes(messageId)) state.handled.push(messageId);
      }, true);
    },
    clearHandled() {
      return exclusive((state) => {
        state.handled = [];
      }, true);
    },
    getPending() {
      return exclusive((state) => structuredClone(state.pending), false);
    },
    savePending(items) {
      return exclusive((state) => {
        state.pending = structuredClone(items);
      }, true);
    },
    getLastResults() {
      return exclusive((state) => structuredClone(state.lastResults), false);
    },
    saveLastResults(items) {
      return exclusive((state) => {
        state.lastResults = structuredClone(items).slice(0, 100);
      }, true);
    },
    getHistory() {
      return exclusive((state) => structuredClone(state.history), false);
    },
    appendHistory(entry) {
      return exclusive((state) => {
        state.history = [structuredClone(entry), ...state.history].slice(0, 30);
      }, true);
    },
    getLastScheduledAt() {
      return exclusive((state) => state.lastScheduledAt, false);
    },
    setLastScheduledAt(iso) {
      return exclusive((state) => {
        state.lastScheduledAt = iso;
      }, true);
    },
    tryLock(owner, ttlSeconds) {
      return exclusive((state) => {
        const now = Date.now();
        if (state.lock && state.lock.expires > now && state.lock.owner !== owner) return false;
        state.lock = { owner, expires: now + ttlSeconds * 1000 };
        return true;
      }, true);
    },
    unlock(owner) {
      return exclusive((state) => {
        if (state.lock?.owner === owner) state.lock = null;
      }, true);
    },
  };
}
