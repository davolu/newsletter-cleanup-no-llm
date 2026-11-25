"use client";

import { useEffect, useMemo, useState } from "react";
import { addUsage, costFromUsage, formatUsd } from "@/lib/cost";
import { COMPARISON_MODEL, JEV_INPUT_USD_PER_MILLION } from "@/lib/pricing";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { UNSUBSCRIBE_LABEL } from "@/lib/safety";
import type { HistoryEntry, PendingItem, ResultItem } from "@/lib/types";

type StatusPayload = {
  ready: boolean;
  missingEnv: string[];
  storage?: "file" | "upstash";
  settings: Settings;
  gmail: { connected: boolean; accountId: string | null; error?: string | null };
  pending: PendingItem[];
  lastResults: ResultItem[];
  history: HistoryEntry[];
  cursor: { completed: boolean; pendingCount: number };
  schedule?: { lastRunAt: string | null };
};

const EMPTY_STATUS: StatusPayload = {
  ready: false,
  missingEnv: [],
  settings: DEFAULT_SETTINGS,
  gmail: { connected: false, accountId: null },
  pending: [],
  lastResults: [],
  history: [],
  cursor: { completed: false, pendingCount: 0 },
};

function decisionLabel(decision: ResultItem["decision"]): string {
  if (decision === "archive") return "Archive";
  if (decision === "unsubscribe") return `Label “${UNSUBSCRIBE_LABEL}”`;
  return "Keep";
}

function statusLabel(status: ResultItem["status"]): string {
  if (status === "suggested") return "Waiting for approval";
  if (status === "applied") return "Applied";
  if (status === "failed") return "Failed";
  return "Left in inbox";
}

async function postJson(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: body === undefined ? "POST" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export function CleanupApp() {
  const [status, setStatus] = useState<StatusPayload>(EMPTY_STATUS);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [keepText, setKeepText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const response = await fetch("/api/status");
    const payload = (await response.json()) as StatusPayload;
    setStatus(payload);
    setSettings(payload.settings ?? DEFAULT_SETTINGS);
    setKeepText((payload.settings?.alwaysKeepSenders ?? []).join("\n"));
    setLoaded(true);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setNotice("If you just finished the Gmail screen, the connection can take a few seconds to show up.");
    }
    refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load status"));
  }, []);

  const formSettings = useMemo<Settings>(
    () => ({
      ...settings,
      alwaysKeepSenders: keepText.split(/\n+/).map((line) => line.trim()).filter(Boolean),
    }),
    [settings, keepText],
  );

  const totals = useMemo(
    () => costFromUsage(status.history.reduce((sum, entry) => addUsage(sum, entry), { inputTokens: 0, outputTokens: 0 })),
    [status.history],
  );
  const latest = status.history[0];
  const latestCost = latest ? costFromUsage(latest) : null;
  const rows = status.lastResults;

  async function run(task: string, action: () => Promise<void>) {
    setBusy(task);
    setError("");
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="wrap">
      <header>
        <p className="kicker">No LLM agent</p>
        <h1>Newsletter cleanup</h1>
        <p className="lede">
          Connect Gmail, then run a pass over recent mail. Promotions, unsubscribe headers, and bulk-sender
          headers pick the candidates. Jev chooses keep, archive, or a label. Mail is never deleted or trashed.
        </p>
      </header>

      <div className="grid">
        {status.missingEnv.length > 0 && (
          <p className="error">
            Missing environment values: {status.missingEnv.join(", ")}. Add them, then reload.
          </p>
        )}
        {status.storage === "file" && (
          <p className="banner">
            State on this machine is in <code>.data/state.json</code>. A hosted deploy still needs Upstash. Netlify,
            Vercel, and Railway do not keep that file.
          </p>
        )}
        {notice && <p className="banner">{notice}</p>}
        {error && <p className="error">{error}</p>}

        <section className="card">
          <h2>Gmail</h2>
          <p>
            {status.gmail.connected
              ? "Gmail is connected through Composio. Tokens stay with Composio."
              : "Gmail is not connected yet."}
            {status.gmail.error ? ` ${status.gmail.error}` : ""}
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                run("connect", async () => {
                  const payload = (await postJson("/api/connect", {})) as { redirectUrl: string };
                  window.location.assign(payload.redirectUrl);
                })
              }
            >
              {status.gmail.connected ? "Reconnect Gmail" : "Connect Gmail"}
            </button>
            <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => refresh()}>
              Check connection
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Run</h2>
          <p>
            Manual runs are the default. Suggest-only shows the decision and waits for approval. The schedule
            stays off until you turn it on. A scheduled wake-up does nothing while that toggle is off.
          </p>
          <div className="fields">
            <label>
              <span>Batch size</span>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.batchSize}
                onChange={(event) => setSettings({ ...settings, batchSize: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Max emails per run</span>
              <input
                type="number"
                min={1}
                max={500}
                value={settings.maxEmailsPerRun}
                onChange={(event) => setSettings({ ...settings, maxEmailsPerRun: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Time budget (seconds)</span>
              <input
                type="number"
                min={5}
                max={900}
                value={Math.round(settings.timeBudgetMs / 1000)}
                onChange={(event) =>
                  setSettings({ ...settings, timeBudgetMs: Number(event.target.value) * 1000 })
                }
              />
            </label>
          </div>
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={settings.suggestOnly}
                onChange={(event) => setSettings({ ...settings, suggestOnly: event.target.checked })}
              />
              Suggest only
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.scheduleEnabled}
                onChange={(event) => setSettings({ ...settings, scheduleEnabled: event.target.checked })}
              />
              Schedule
            </label>
            <label>
              <span className="visually-hidden">How often</span>
              <select
                aria-label="Schedule frequency"
                value={settings.schedule}
                onChange={(event) =>
                  setSettings({ ...settings, schedule: event.target.value === "daily" ? "daily" : "hourly" })
                }
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
              </select>
            </label>
          </div>
          <label style={{ marginTop: "0.8rem" }}>
            <span>Always keep these senders, one address or domain per line</span>
            <textarea value={keepText} onChange={(event) => setKeepText(event.target.value)} placeholder={"boss@work.example\n@bank.example"} />
          </label>
          <div className="actions" style={{ marginTop: "0.8rem" }}>
            <button
              type="button"
              disabled={Boolean(busy) || !loaded}
              onClick={() =>
                run("run", async () => {
                  await postJson("/api/run", formSettings);
                })
              }
            >
              {busy === "run" ? "Running…" : "Run now"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={Boolean(busy)}
              onClick={() =>
                run("save", async () => {
                  const response = await fetch("/api/settings", {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(formSettings),
                  });
                  const payload = (await response.json().catch(() => ({}))) as { error?: string };
                  if (!response.ok) throw new Error(payload.error || "Could not save settings");
                })
              }
            >
              Save settings
            </button>
            <button
              type="button"
              className="secondary"
              disabled={Boolean(busy)}
              onClick={() => run("reset", async () => { await postJson("/api/settings"); })}
            >
              Reset scan
            </button>
          </div>
          <p>
            {status.cursor.completed
              ? "The current pass has reached the end of the recent-mail window."
              : `Saved cursor: ${status.cursor.pendingCount} message${status.cursor.pendingCount === 1 ? "" : "s"} waiting from the last page.`}
          </p>
        </section>

        <section className="card">
          <h2>Cost</h2>
          <div className="meter">
            <div>
              <span>Jev, this recorded history</span>
              <strong>{formatUsd(totals.jevUsd)}</strong>
              <span>{totals.inputTokens.toLocaleString()} input tokens · output free</span>
            </div>
            <div>
              <span>{COMPARISON_MODEL.id} at published rates</span>
              <strong>{formatUsd(totals.comparisonUsd)}</strong>
              <span>
                ${COMPARISON_MODEL.inputUsdPerMillion} / 1M input · ${COMPARISON_MODEL.outputUsdPerMillion} / 1M output
              </span>
            </div>
            <div>
              <span>Latest run</span>
              <strong>{latestCost ? formatUsd(latestCost.jevUsd) : "$0.00"}</strong>
              <span>
                {latest
                  ? `${latest.inputTokens.toLocaleString()} in · ${latest.outputTokens.toLocaleString()} out`
                  : "No runs yet"}
              </span>
            </div>
          </div>
          <p>
            Jev is ${JEV_INPUT_USD_PER_MILLION} per million input tokens. The comparison uses the same token counts
            Jev returned. Nothing here is estimated.
            {latest && !latest.usageComplete ? " A recent run did not include token counts for every call, so those calls are shown as zero." : ""}
          </p>
        </section>

        {latest?.hint && <p className="hint">{latest.hint}</p>}

        <section className="card">
          <h2>Results</h2>
          {rows.length === 0 ? (
            <p>No messages from the latest run yet.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Sender</th>
                    <th>Subject</th>
                    <th>Why it was a candidate</th>
                    <th>Decision</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.messageId}>
                      <td>
                        {item.status === "suggested" || item.status === "failed" ? (
                          <input
                            type="checkbox"
                            aria-label={`Approve ${item.subject}`}
                            checked={selected.includes(item.messageId)}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, item.messageId]
                                  : current.filter((id) => id !== item.messageId),
                              )
                            }
                          />
                        ) : null}
                      </td>
                      <td>{item.sender || "Unknown sender"}</td>
                      <td>
                        {item.subject || "(no subject)"}
                        {item.note ? <div>{item.note}</div> : null}
                        {item.error ? <div>{item.error}</div> : null}
                      </td>
                      <td>
                        {item.reasons.length === 0
                          ? "—"
                          : item.reasons.map((reason) => (
                              <span className="tag" key={reason}>
                                {reason}
                              </span>
                            ))}
                      </td>
                      <td>
                        {decisionLabel(item.decision)}
                        {item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : ""}
                      </td>
                      <td>{statusLabel(item.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {status.pending.length > 0 && (
            <div className="actions" style={{ marginTop: "0.8rem" }}>
              <button
                type="button"
                disabled={Boolean(busy) || selected.length === 0}
                onClick={() =>
                  run("approve", async () => {
                    await postJson("/api/approve", { ids: selected });
                    setSelected([]);
                  })
                }
              >
                Apply selected
              </button>
              <button
                type="button"
                className="secondary"
                disabled={Boolean(busy)}
                onClick={() => run("approve", async () => { await postJson("/api/approve", {}); setSelected([]); })}
              >
                Apply all suggestions
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Run history</h2>
          {status.history.length === 0 ? (
            <p>History appears here after the first run.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Trigger</th>
                    <th>Inspected</th>
                    <th>Candidates</th>
                    <th>Jev</th>
                  </tr>
                </thead>
                <tbody>
                  {status.history.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.finishedAt).toLocaleString()}</td>
                      <td>{entry.trigger}</td>
                      <td>{entry.inspected}</td>
                      <td>{entry.candidates}</td>
                      <td>{formatUsd(costFromUsage(entry).jevUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <footer>
        David Oluyale, Agentic AI Hub ·{" "}
        <a href="https://www.youtube.com/@AgenticAIHub1">youtube.com/@AgenticAIHub1</a>
      </footer>
    </main>
  );
}
