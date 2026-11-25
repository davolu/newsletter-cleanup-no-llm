import { describe, expect, it, vi } from "vitest";
import type { InspectableMessage } from "./candidates";
import type { GmailClient } from "./gmail";
import { executeCleanup, runScheduledIfEnabled } from "./pipeline";
import { DEFAULT_SETTINGS } from "./settings";
import { createMemoryStore } from "./store";

function message(id: string, extra: Partial<InspectableMessage> = {}): InspectableMessage {
  return {
    id,
    threadId: `t-${id}`,
    from: `${id}@news.example`,
    subject: `Subject ${id}`,
    snippet: "A short preview of the mailing",
    labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
    headers: [],
    ...extra,
  };
}

function jev(choice: string, inputTokens = 100, outputTokens = 5) {
  return {
    model: "jev-1.14.0",
    answers: {
      action: {
        type: "choice",
        choice,
        confidence: 0.8,
        probabilities: { keep: 0.1, archive: 0.8, unsubscribe: 0.1 },
      },
    },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function fakeGmail(pages: InspectableMessage[][]): GmailClient & {
  archived: string[];
  labeled: Array<{ id: string; labelId: string }>;
  lists: number;
} {
  let index = 0;
  const archived: string[] = [];
  const labeled: Array<{ id: string; labelId: string }> = [];
  const client: GmailClient & { archived: string[]; labeled: typeof labeled; lists: number } = {
    archived,
    labeled,
    lists: 0,
    async listMessages() {
      client.lists += 1;
      const messages = pages[index] ?? [];
      index += 1;
      return { messages, nextPageToken: index < pages.length ? `page-${index}` : null };
    },
    async getMessage(messageId) {
      return pages.flat().find((item) => item.id === messageId) ?? null;
    },
    async ensureUnsubscribeLabel() {
      return "Label_9";
    },
    async archiveMessage(messageId) {
      archived.push(messageId);
    },
    async labelMessage(messageId, labelId) {
      labeled.push({ id: messageId, labelId });
    },
  };
  return client;
}

describe("cleanup run", () => {
  it("stops at the time budget, saves the remaining ids, and does not archive them yet", async () => {
    const gmail = fakeGmail([[message("a"), message("b"), message("c")]]);
    const store = createMemoryStore();
    let clock = 1_000;
    const systemOne = vi.fn(async () => {
      clock = 18_000;
      return jev("archive", 40, 2);
    });

    const summary = await executeCleanup({
      gmail,
      store,
      classifier: { systemOne },
      trigger: "manual",
      now: () => clock,
      settings: { ...DEFAULT_SETTINGS, suggestOnly: false, timeBudgetMs: 20_000, maxEmailsPerRun: 15, batchSize: 5 },
    });

    expect(summary.stoppedEarly).toBe(true);
    expect(summary.hint).toMatch(/batch size/);
    expect(summary.hint).toMatch(/hosting plan/);
    expect(summary.inspected).toBe(1);
    expect(gmail.archived).toEqual(["a"]);
    expect(gmail.labeled).toEqual([]);
    expect(systemOne).toHaveBeenCalledTimes(1);
    const sent = systemOne.mock.calls[0][0].state;
    expect(sent).toEqual({
      sender: "a@news.example",
      subject: "Subject a",
      snippet: "A short preview of the mailing",
    });
    const cursor = await store.getCursor();
    expect(cursor.pendingIds).toEqual(["b", "c"]);
    expect(cursor.completed).toBe(false);

    clock = 20_000;
    const second = await executeCleanup({
      gmail,
      store,
      classifier: { systemOne: vi.fn(async () => jev("keep", 10, 1)) },
      trigger: "manual",
      now: () => clock,
      settings: { ...DEFAULT_SETTINGS, suggestOnly: false, timeBudgetMs: 20_000, maxEmailsPerRun: 15 },
    });
    expect(second.inspected).toBe(2);
    expect(gmail.lists).toBe(1);
    expect(gmail.archived).toEqual(["a"]);
  });

  it("suggests archive and unsubscribe without calling modify tools", async () => {
    const gmail = fakeGmail([
      [
        message("one"),
        message("two", { from: "boss@work.example", labelIds: ["INBOX"], headers: [{ name: "List-Id", value: "<team.work.example>" }] }),
      ],
    ]);
    const store = createMemoryStore();
    const choices = ["archive", "unsubscribe"];
    const summary = await executeCleanup({
      gmail,
      store,
      classifier: { systemOne: vi.fn(async () => jev(choices.shift() ?? "keep")) },
      trigger: "manual",
      now: () => 5_000,
      settings: { ...DEFAULT_SETTINGS, suggestOnly: true, timeBudgetMs: 60_000 },
    });
    expect(gmail.archived).toEqual([]);
    expect(gmail.labeled).toEqual([]);
    expect(summary.suggested).toBe(2);
    expect((await store.getPending()).map((item) => item.decision)).toEqual(["archive", "unsubscribe"]);
  });

  it("skips the classifier for always-keep senders and for mail with no newsletter signal", async () => {
    const gmail = fakeGmail([
      [
        message("keep-me", { from: "Ada <ada@example.com>", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }),
        message("person", {
          from: "Sam <sam@example.com>",
          labelIds: ["INBOX"],
          headers: [{ name: "From", value: "Sam <sam@example.com>" }],
          subject: "Lunch",
        }),
      ],
    ]);
    const systemOne = vi.fn();
    const summary = await executeCleanup({
      gmail,
      store: createMemoryStore(),
      classifier: { systemOne },
      trigger: "manual",
      now: () => 5_000,
      settings: {
        ...DEFAULT_SETTINGS,
        suggestOnly: false,
        timeBudgetMs: 60_000,
        alwaysKeepSenders: ["ada@example.com"],
      },
    });
    expect(systemOne).not.toHaveBeenCalled();
    expect(gmail.archived).toEqual([]);
    expect(summary.items.map((item) => item.note)).toEqual(["On your always-keep list."]);
    expect(summary.candidates).toBe(0);
  });

  it("does not run on a schedule until the user turns it on", async () => {
    const gmail = fakeGmail([[message("a")]]);
    const store = createMemoryStore();
    const result = await runScheduledIfEnabled({
      gmail,
      store,
      classifier: { systemOne: vi.fn() },
      now: () => 5_000,
      settings: { ...DEFAULT_SETTINGS, scheduleEnabled: false },
    });
    expect(result).toEqual({ ran: false, reason: "schedule-off" });
    expect(gmail.lists).toBe(0);
  });
});
