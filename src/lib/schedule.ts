import type { Settings } from "./settings";

const HOUR_MS = 60 * 60 * 1000;

export function scheduleDue(
  settings: Pick<Settings, "scheduleEnabled" | "schedule">,
  lastRunAt: string | null,
  now: number,
): { due: boolean; reason: string } {
  if (!settings.scheduleEnabled) {
    return { due: false, reason: "schedule-off" };
  }
  if (!lastRunAt) return { due: true, reason: "first-run" };
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) return { due: true, reason: "first-run" };
  const elapsed = now - last;
  if (settings.schedule === "daily") {
    return elapsed >= 20 * HOUR_MS
      ? { due: true, reason: "daily-due" }
      : { due: false, reason: "daily-waiting" };
  }
  return elapsed >= 50 * 60 * 1000
    ? { due: true, reason: "hourly-due" }
    : { due: false, reason: "hourly-waiting" };
}
