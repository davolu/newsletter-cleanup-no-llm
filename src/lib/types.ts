import type { CandidateReason } from "./candidates";
import type { ScheduleFrequency } from "./settings";

export type MailDecision = "keep" | "archive" | "unsubscribe";

export type ItemStatus = "kept" | "suggested" | "applied" | "failed";

export type ResultItem = {
  messageId: string;
  threadId: string | null;
  sender: string;
  subject: string;
  snippet: string;
  reasons: CandidateReason[];
  decision: MailDecision;
  confidence: number | null;
  status: ItemStatus;
  note: string | null;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  usageReported: boolean;
};

export type PendingItem = ResultItem & {
  decision: "archive" | "unsubscribe";
  status: "suggested" | "failed";
};

export type ScanCursor = {
  query: string;
  pageToken: string | null;
  pendingIds: string[];
  /** True after a list call that did not return another page. */
  endOfPages: boolean;
  completed: boolean;
};

export type HistoryEntry = {
  id: string;
  trigger: "manual" | "schedule";
  startedAt: string;
  finishedAt: string;
  inspected: number;
  candidates: number;
  kept: number;
  archived: number;
  labeled: number;
  suggested: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete: boolean;
  stoppedEarly: boolean;
  hint: string | null;
  error: string | null;
};

export type RunSummary = HistoryEntry & {
  items: ResultItem[];
};

export type ScheduleState = {
  enabled: boolean;
  frequency: ScheduleFrequency;
  lastRunAt: string | null;
};
