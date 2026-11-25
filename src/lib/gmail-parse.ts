import type { InspectableMessage, MailHeader } from "./candidates";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function unwrapJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nestedRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  const out = [record];
  for (const key of ["data", "response_data", "responseData", "message"]) {
    const nested = asRecord(unwrapJson(record[key]));
    if (nested) out.push(nested);
  }
  return out;
}

function findArray(root: unknown, key: string): unknown[] | null {
  const record = asRecord(unwrapJson(root));
  if (!record) return null;
  for (const candidate of nestedRecords(record)) {
    const value = unwrapJson(candidate[key]);
    if (Array.isArray(value)) return value;
  }
  return null;
}

function parseHeaders(source: Record<string, unknown>): MailHeader[] {
  const raw = findArray(source, "headers") ?? findArray(asRecord(source.payload), "headers") ?? [];
  const headers: MailHeader[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const name = pickString(record, ["name", "key"]);
    const value = typeof record.value === "string" ? record.value : pickString(record, ["value"]);
    if (name) headers.push({ name, value });
  }
  return headers;
}

function parseLabelIds(source: Record<string, unknown>): string[] {
  const raw = findArray(source, "labelIds") ?? findArray(source, "label_ids") ?? findArray(source, "labels");
  if (!raw) return [];
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) ids.push(entry.trim());
    const record = asRecord(entry);
    if (record) {
      const id = pickString(record, ["id", "labelId", "label_id"]);
      if (id) ids.push(id);
    }
  }
  return ids;
}

export function parseMessage(root: unknown): InspectableMessage | null {
  const record = asRecord(unwrapJson(root));
  if (!record) return null;
  const sources = nestedRecords(record);
  for (const source of sources) {
    const id = pickString(source, ["messageId", "message_id", "id"]);
    if (!id) continue;
    const threadId = pickString(source, ["threadId", "thread_id"]) || null;
    const payload = asRecord(unwrapJson(source.payload));
    const headers = [
      ...parseHeaders(source),
      ...(payload ? parseHeaders(payload) : []),
    ];
    const fromHeader = headers.find((header) => header.name.toLowerCase() === "from")?.value ?? "";
    const subjectHeader = headers.find((header) => header.name.toLowerCase() === "subject")?.value ?? "";
    return {
      id,
      threadId,
      from: pickString(source, ["sender", "from", "fromEmail"]) || fromHeader,
      subject: pickString(source, ["subject", "subjectLine"]) || subjectHeader,
      snippet: pickString(source, ["snippet", "preview", "messageText"]),
      labelIds: parseLabelIds(source),
      headers,
    };
  }
  return null;
}

export function parseFetchPage(root: unknown): {
  messages: InspectableMessage[];
  nextPageToken: string | null;
} {
  const record = asRecord(unwrapJson(root)) ?? {};
  const sources = nestedRecords(record);
  const rawMessages = findArray(record, "messages") ?? findArray(record, "emails") ?? [];
  const messages = rawMessages
    .map((entry) => parseMessage(entry))
    .filter((message): message is InspectableMessage => message !== null);

  let nextPageToken: string | null = null;
  for (const source of sources) {
    const token = pickString(source, ["nextPageToken", "next_page_token", "pageToken"]);
    if (token) {
      nextPageToken = token;
      break;
    }
  }
  return { messages, nextPageToken };
}

export type GmailLabel = { id: string; name: string };

export function parseLabels(root: unknown): GmailLabel[] {
  const raw = findArray(unwrapJson(root), "labels") ?? [];
  const labels: GmailLabel[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = pickString(record, ["id", "labelId", "label_id"]);
    const name = pickString(record, ["name", "labelName", "label_name"]);
    if (id && name) labels.push({ id, name });
  }
  return labels;
}

export function parseCreatedLabelId(root: unknown): string | null {
  const record = asRecord(unwrapJson(root));
  if (!record) return null;
  for (const source of nestedRecords(record)) {
    const id = pickString(source, ["id", "labelId", "label_id"]);
    if (id) return id;
  }
  return null;
}
