export type ScheduleFrequency = "hourly" | "daily";

export type Settings = {
  batchSize: number;
  maxEmailsPerRun: number;
  timeBudgetMs: number;
  suggestOnly: boolean;
  scheduleEnabled: boolean;
  schedule: ScheduleFrequency;
  alwaysKeepSenders: string[];
};

/**
 * Defaults stay inside a short serverless run: a 20 second budget is under
 * Netlify's 30 second scheduled-function cap, and the batch is small.
 * These are starting values, not a plan lock. Raise them in the form.
 */
export const DEFAULT_SETTINGS: Settings = {
  batchSize: 5,
  maxEmailsPerRun: 15,
  timeBudgetMs: 20_000,
  suggestOnly: true,
  scheduleEnabled: false,
  schedule: "hourly",
  alwaysKeepSenders: [],
};

export const LIMITS = {
  batchSize: { min: 1, max: 50 },
  maxEmailsPerRun: { min: 1, max: 500 },
  timeBudgetMs: { min: 5_000, max: 900_000 },
  keepSenders: 200,
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function keepList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > 200) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= LIMITS.keepSenders) break;
  }
  return out;
}

export function sanitizeSettings(input: unknown): Settings {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const schedule = record.schedule === "daily" ? "daily" : record.schedule === "hourly" ? "hourly" : DEFAULT_SETTINGS.schedule;
  return {
    batchSize: clampInt(record.batchSize, LIMITS.batchSize.min, LIMITS.batchSize.max, DEFAULT_SETTINGS.batchSize),
    maxEmailsPerRun: clampInt(
      record.maxEmailsPerRun,
      LIMITS.maxEmailsPerRun.min,
      LIMITS.maxEmailsPerRun.max,
      DEFAULT_SETTINGS.maxEmailsPerRun,
    ),
    timeBudgetMs: clampInt(
      record.timeBudgetMs,
      LIMITS.timeBudgetMs.min,
      LIMITS.timeBudgetMs.max,
      DEFAULT_SETTINGS.timeBudgetMs,
    ),
    suggestOnly: typeof record.suggestOnly === "boolean" ? record.suggestOnly : DEFAULT_SETTINGS.suggestOnly,
    scheduleEnabled: typeof record.scheduleEnabled === "boolean" ? record.scheduleEnabled : DEFAULT_SETTINGS.scheduleEnabled,
    schedule,
    alwaysKeepSenders: keepList(record.alwaysKeepSenders),
  };
}

export const RECENT_QUERY = "newer_than:90d -in:spam -in:trash -in:drafts";

export const STOP_RESERVE_MS = 3_000;

export const BUDGET_HINT =
  "This run stopped to stay inside the time budget and saved a cursor. The next run continues from there. Raise the batch size so each fetch covers more mail, or upgrade the hosting plan if the platform is cutting the run short.";

export function budgetExhausted(now: number, deadline: number, reserveMs = STOP_RESERVE_MS): boolean {
  return now >= deadline - reserveMs;
}
