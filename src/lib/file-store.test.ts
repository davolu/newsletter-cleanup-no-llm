import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileStore } from "./file-store";
import { storageKind } from "./redis-store";
import { freshCursor } from "./store";
import type { HistoryEntry } from "./types";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nlc-store-"));
  directories.push(directory);
  return path.join(directory, "state.json");
}

function history(id: string): HistoryEntry {
  return {
    id,
    trigger: "manual",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    inspected: 1,
    candidates: 1,
    kept: 0,
    archived: 1,
    labeled: 0,
    suggested: 0,
    failed: 0,
    inputTokens: 10,
    outputTokens: 1,
    usageComplete: true,
    stoppedEarly: false,
    hint: null,
    error: null,
  };
}

describe("local file store", () => {
  it("reloads the cursor and pending suggestions from the same file", async () => {
    const filePath = await tempFile();
    const store = createFileStore(filePath);
    const cursor = freshCursor();
    cursor.pendingIds = ["m1", "m2"];
    cursor.endOfPages = true;
    await store.saveCursor(cursor);
    await store.savePending([
      {
        messageId: "m2",
        threadId: null,
        sender: "news@example.com",
        subject: "Weekly",
        snippet: "short",
        reasons: ["promotions"],
        decision: "archive",
        confidence: 0.8,
        status: "suggested",
        note: null,
        error: null,
        inputTokens: 12,
        outputTokens: 2,
        usageReported: true,
      },
    ]);

    const reloaded = createFileStore(filePath);
    expect((await reloaded.getCursor()).pendingIds).toEqual(["m1", "m2"]);
    expect((await reloaded.getCursor()).endOfPages).toBe(true);
    expect((await reloaded.getPending())[0]?.decision).toBe("archive");
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toMatch(/body|html/i);
  });

  it("reloads from the same file and caps history", async () => {
    const filePath = await tempFile();
    const store = createFileStore(filePath);
    await store.saveSettings({
      batchSize: 4,
      maxEmailsPerRun: 9,
      timeBudgetMs: 12_000,
      suggestOnly: true,
      scheduleEnabled: false,
      schedule: "hourly",
      alwaysKeepSenders: ["@bank.example"],
    });
    await store.markHandled("kept");
    await store.setLastScheduledAt("2026-02-01T00:00:00.000Z");
    for (let index = 0; index < 31; index += 1) {
      await store.appendHistory(history(String(index)));
    }

    const reloaded = createFileStore(filePath);
    expect((await reloaded.getSettings()).batchSize).toBe(4);
    expect((await reloaded.getSettings()).alwaysKeepSenders).toEqual(["@bank.example"]);
    expect(await reloaded.isHandled("kept")).toBe(true);
    expect(await reloaded.isHandled("other")).toBe(false);
    expect(await reloaded.getLastScheduledAt()).toBe("2026-02-01T00:00:00.000Z");
    const rows = await reloaded.getHistory();
    expect(rows).toHaveLength(30);
    expect(rows[0]?.id).toBe("30");
    await reloaded.clearHandled();
    expect(await createFileStore(filePath).isHandled("kept")).toBe(false);
  });

  it("holds a lock until it expires or the owner releases it", async () => {
    const store = createFileStore(await tempFile());
    expect(await store.tryLock("run-a", 30)).toBe(true);
    expect(await store.tryLock("run-b", 30)).toBe(false);
    await store.unlock("run-b");
    expect(await store.tryLock("run-b", 30)).toBe(false);
    await store.unlock("run-a");
    expect(await store.tryLock("run-b", 0)).toBe(true);
    expect(await store.tryLock("run-c", 30)).toBe(true);
  });

  it("refuses to replace a file that is not JSON", async () => {
    const filePath = await tempFile();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{", "utf8");
    const store = createFileStore(filePath);
    await expect(store.getSettings()).rejects.toThrow(/not valid JSON/);
    expect(await readFile(filePath, "utf8")).toBe("{");
  });
});

describe("storage selection", () => {
  it("uses the file store only when both Upstash variables are unset", () => {
    expect(storageKind({} as NodeJS.ProcessEnv)).toBe("file");
    expect(storageKind({ UPSTASH_REDIS_REST_URL: "  ", UPSTASH_REDIS_REST_TOKEN: "" } as NodeJS.ProcessEnv)).toBe(
      "file",
    );
    expect(
      storageKind({
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token",
      } as NodeJS.ProcessEnv),
    ).toBe("upstash");
    expect(() => storageKind({ UPSTASH_REDIS_REST_URL: "https://example.upstash.io" } as NodeJS.ProcessEnv)).toThrow(
      /both/i,
    );
  });
});
