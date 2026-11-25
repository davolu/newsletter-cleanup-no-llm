import { randomUUID } from "node:crypto";
import { detectCandidate, senderOnKeepList, shortSnippet, type InspectableMessage } from "./candidates";
import { classifyMessage, type MailDecision, type SystemOneCaller } from "./classify";
import type { GmailClient } from "./gmail";
import { addUsage, type TokenUsage } from "./cost";
import { logError, publicError } from "./redact";
import { scheduleDue } from "./schedule";
import { BUDGET_HINT, RECENT_QUERY, budgetExhausted, type Settings } from "./settings";
import { freshCursor, type Store } from "./store";
import type { HistoryEntry, ItemStatus, PendingItem, ResultItem, RunSummary } from "./types";

const EMPTY_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

export type CleanupDeps = {
  gmail: GmailClient;
  classifier: SystemOneCaller;
  store: Store;
  settings: Settings;
  trigger: "manual" | "schedule";
  now?: () => number;
  model?: string;
};

function needsHeaders(message: InspectableMessage): boolean {
  const labeled = message.labelIds.some((label) => label.toUpperCase() === "CATEGORY_PROMOTIONS");
  return !labeled && message.headers.length === 0;
}

function blankItem(
  message: InspectableMessage,
  decision: MailDecision,
  status: ItemStatus,
  extra: Partial<ResultItem> = {},
): ResultItem {
  return {
    messageId: message.id,
    threadId: message.threadId,
    sender: message.from,
    subject: message.subject,
    snippet: shortSnippet(message.snippet),
    reasons: [],
    decision,
    confidence: null,
    status,
    note: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    usageReported: true,
    ...extra,
  };
}

export async function executeCleanup(deps: CleanupDeps): Promise<RunSummary> {
  const now = deps.now ?? Date.now;
  const started = new Date(now()).toISOString();
  const owner = randomUUID();
  const ttl = Math.ceil(deps.settings.timeBudgetMs / 1000) + 30;
  const locked = await deps.store.tryLock(owner, ttl);
  if (!locked) {
    throw new Error("A run is already in progress.");
  }

  const items: ResultItem[] = [];
  let inspected = 0;
  let stoppedEarly = false;
  let runError: string | null = null;
  let usage = { ...EMPTY_USAGE };
  let labelId: string | null = null;
  let cursor = freshCursor();
  let cursorLoaded = false;

  try {
    const loaded = await deps.store.getCursor();
    cursorLoaded = true;
    cursor = {
      ...freshCursor(),
      ...loaded,
      pendingIds: Array.isArray(loaded.pendingIds) ? loaded.pendingIds : [],
    };
    if (cursor.completed || cursor.query !== RECENT_QUERY) cursor = freshCursor();
    const deadline = now() + deps.settings.timeBudgetMs;
    const listed = new Map<string, InspectableMessage>();

    while (inspected < deps.settings.maxEmailsPerRun && !stoppedEarly) {
      if (budgetExhausted(now(), deadline)) {
        stoppedEarly = true;
        break;
      }

      if (cursor.pendingIds.length === 0) {
        if (cursor.endOfPages) {
          cursor.completed = true;
          break;
        }
        const page = await deps.gmail.listMessages({
          query: cursor.query,
          pageToken: cursor.pageToken,
          maxResults: deps.settings.batchSize,
        });
        if (page.nextPageToken && page.nextPageToken === cursor.pageToken) {
          throw new Error("Gmail returned the same page token twice.");
        }
        cursor.pageToken = page.nextPageToken;
        cursor.endOfPages = !page.nextPageToken;
        cursor.pendingIds = page.messages.map((message) => message.id);
        for (const message of page.messages) listed.set(message.id, message);
        if (cursor.pendingIds.length === 0 && !cursor.pageToken) {
          cursor.completed = true;
          break;
        }
        continue;
      }

      const messageId = cursor.pendingIds[0];
      if (await deps.store.isHandled(messageId)) {
        cursor.pendingIds.shift();
        continue;
      }

      let message = listed.get(messageId) ?? null;
      if (!message) {
        if (budgetExhausted(now(), deadline)) {
          stoppedEarly = true;
          break;
        }
        message = await deps.gmail.getMessage(messageId);
      }
      if (!message) {
        cursor.pendingIds.shift();
        await deps.store.markHandled(messageId);
        continue;
      }

      if (needsHeaders(message)) {
        if (budgetExhausted(now(), deadline)) {
          stoppedEarly = true;
          break;
        }
        const detailed = await deps.gmail.getMessage(message.id);
        if (detailed) message = { ...message, ...detailed, snippet: detailed.snippet || message.snippet };
      }

      if (budgetExhausted(now(), deadline)) {
        stoppedEarly = true;
        break;
      }

      cursor.pendingIds.shift();
      inspected += 1;
      await deps.store.markHandled(message.id);

      if (senderOnKeepList(message.from, deps.settings.alwaysKeepSenders)) {
        items.push(blankItem(message, "keep", "kept", { note: "On your always-keep list." }));
        continue;
      }

      const detection = detectCandidate(message);
      if (!detection.isCandidate) continue;

      let classification;
      try {
        classification = await classifyMessage(
          deps.classifier,
          {
            sender: message.from,
            subject: message.subject,
            snippet: message.snippet,
          },
          deps.model,
        );
      } catch (error) {
        items.push(
          blankItem(message, "keep", "failed", {
            reasons: detection.reasons,
            error: publicError(error),
            usageReported: false,
          }),
        );
        continue;
      }
      usage = addUsage(usage, classification);
      const base = blankItem(message, classification.decision, "kept", {
        reasons: detection.reasons,
        confidence: classification.confidence,
        inputTokens: classification.inputTokens,
        outputTokens: classification.outputTokens,
        usageReported: classification.usageReported,
        error: classification.recognized ? null : "Jev did not return one of the three actions, so the message stayed in the inbox.",
      });

      if (classification.decision === "keep" || !classification.recognized) {
        items.push(base);
        continue;
      }

      if (deps.settings.suggestOnly) {
        const suggested: PendingItem = { ...base, decision: classification.decision, status: "suggested" };
        items.push(suggested);
        continue;
      }

      try {
        if (classification.decision === "unsubscribe") {
          labelId = labelId ?? (await deps.gmail.ensureUnsubscribeLabel());
          await deps.gmail.labelMessage(message.id, labelId);
        } else {
          await deps.gmail.archiveMessage(message.id);
        }
        items.push({ ...base, status: "applied" });
      } catch (error) {
        items.push({ ...base, status: "failed", error: publicError(error) });
      }
    }

    if (cursor.pendingIds.length === 0 && cursor.endOfPages) cursor.completed = true;

    const pending = await deps.store.getPending();
    const suggested = items.filter((item): item is PendingItem => item.status === "suggested");
    const merged = new Map<string, PendingItem>();
    for (const item of [...suggested, ...pending]) {
      if (!merged.has(item.messageId)) merged.set(item.messageId, item);
    }
    await deps.store.savePending([...merged.values()].slice(0, 200));
    await deps.store.saveLastResults(items);
  } catch (error) {
    runError = publicError(error);
    logError("cleanup-run", error);
  } finally {
    if (cursorLoaded) {
      try {
        await deps.store.saveCursor(cursor);
      } catch (error) {
        logError("cleanup-cursor", error);
      }
    }
    await deps.store.unlock(owner);
  }

  const summary = summarize({
    trigger: deps.trigger,
    startedAt: started,
    finishedAt: new Date(now()).toISOString(),
    inspected,
    items,
    usage,
    stoppedEarly,
    error: runError,
  });
  await deps.store.appendHistory(summary);
  console.log(
    JSON.stringify({
      event: "cleanup-run",
      trigger: deps.trigger,
      inspected: summary.inspected,
      candidates: summary.candidates,
      stoppedEarly: summary.stoppedEarly,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
    }),
  );
  return { ...summary, items };
}

function summarize(input: {
  trigger: "manual" | "schedule";
  startedAt: string;
  finishedAt: string;
  inspected: number;
  items: ResultItem[];
  usage: TokenUsage;
  stoppedEarly: boolean;
  error: string | null;
}): HistoryEntry {
  const count = (status: ItemStatus, decision?: MailDecision) =>
    input.items.filter((item) => item.status === status && (decision ? item.decision === decision : true)).length;
  return {
    id: randomUUID(),
    trigger: input.trigger,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    inspected: input.inspected,
    candidates: input.items.filter((item) => item.reasons.length > 0).length,
    kept: count("kept"),
    archived: count("applied", "archive"),
    labeled: count("applied", "unsubscribe"),
    suggested: count("suggested"),
    failed: count("failed"),
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    usageComplete: input.items.every((item) => item.usageReported),
    stoppedEarly: input.stoppedEarly,
    hint: input.stoppedEarly ? BUDGET_HINT : null,
    error: input.error,
  };
}

export async function applyPending(
  store: Store,
  gmail: GmailClient,
  ids: string[] | null,
): Promise<ResultItem[]> {
  const pending = await store.getPending();
  const chosen = ids ? pending.filter((item) => ids.includes(item.messageId)) : pending;
  if (chosen.length === 0) return pending;
  let labelId: string | null = null;
  const done = new Set<string>();
  const failures = new Map<string, string>();
  const next: PendingItem[] = [];

  for (const item of pending) {
    if (!chosen.some((candidate) => candidate.messageId === item.messageId)) {
      next.push(item);
      continue;
    }
    try {
      if (item.decision === "unsubscribe") {
        labelId = labelId ?? (await gmail.ensureUnsubscribeLabel());
        await gmail.labelMessage(item.messageId, labelId);
      } else if (item.decision === "archive") {
        await gmail.archiveMessage(item.messageId);
      }
      done.add(item.messageId);
    } catch (error) {
      const message = publicError(error);
      failures.set(item.messageId, message);
      next.push({ ...item, status: "failed", error: message });
    }
  }

  await store.savePending(next);
  const results = await store.getLastResults();
  await store.saveLastResults(
    results.map((item) => {
      if (done.has(item.messageId)) return { ...item, status: "applied" as const, error: null };
      const message = failures.get(item.messageId);
      if (message) return { ...item, status: "failed" as const, error: message };
      return item;
    }),
  );
  return next;
}

export async function runScheduledIfEnabled(deps: Omit<CleanupDeps, "trigger" | "settings"> & {
  settings?: Settings;
}): Promise<{ ran: boolean; reason: string; summary?: RunSummary }> {
  const settings = deps.settings ?? (await deps.store.getSettings());
  const last = await deps.store.getLastScheduledAt();
  const gate = scheduleDue(settings, last, (deps.now ?? Date.now)());
  if (!gate.due) return { ran: false, reason: gate.reason };
  const summary = await executeCleanup({ ...deps, settings, trigger: "schedule" });
  if (!summary.error) await deps.store.setLastScheduledAt(summary.finishedAt);
  return { ran: true, reason: gate.reason, summary };
}
