export const SNIPPET_MAX = 280;

export type CandidateReason = "promotions" | "list-unsubscribe" | "bulk-sender";

export type MailHeader = {
  name: string;
  value: string;
};

export type InspectableMessage = {
  id: string;
  threadId: string | null;
  from: string;
  subject: string;
  snippet: string;
  labelIds: string[];
  headers: MailHeader[];
};

export type Detection = {
  isCandidate: boolean;
  reasons: CandidateReason[];
};

const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

export function headerMap(headers: MailHeader[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const header of headers) {
    const name = header.name.trim().toLowerCase();
    if (!name) continue;
    const value = header.value ?? "";
    const list = map.get(name);
    if (list) list.push(value);
    else map.set(name, [value]);
  }
  return map;
}

function hasNonEmpty(headers: Map<string, string[]>, name: string): boolean {
  const values = headers.get(name) ?? [];
  return values.some((value) => value.trim().length > 0);
}

function precedenceIsBulk(headers: Map<string, string[]>): boolean {
  const values = headers.get("precedence") ?? [];
  for (const value of values) {
    const parts = value.split(/[,;]/).map((part) => part.trim().toLowerCase());
    if (parts.some((part) => BULK_PRECEDENCE.has(part))) return true;
  }
  return false;
}

/**
 * A message is a candidate when any deterministic Gmail signal matches:
 * the Promotions category, a List-Unsubscribe header, or a bulk-sender header.
 * Personal mail with none of those signals is not a candidate.
 */
export function detectCandidate(message: Pick<InspectableMessage, "labelIds" | "headers">): Detection {
  const reasons: CandidateReason[] = [];
  if (message.labelIds.some((label) => label.trim().toUpperCase() === "CATEGORY_PROMOTIONS")) {
    reasons.push("promotions");
  }

  const headers = headerMap(message.headers);
  if (hasNonEmpty(headers, "list-unsubscribe") || hasNonEmpty(headers, "list-unsubscribe-post")) {
    reasons.push("list-unsubscribe");
  }
  if (precedenceIsBulk(headers) || hasNonEmpty(headers, "list-id") || hasNonEmpty(headers, "feedback-id")) {
    reasons.push("bulk-sender");
  }

  return { isCandidate: reasons.length > 0, reasons };
}

export function extractEmail(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  const raw = (angled?.[1] ?? from).trim().toLowerCase();
  return raw.replace(/^mailto:/, "");
}

export function senderOnKeepList(from: string, keepList: string[]): boolean {
  const email = extractEmail(from);
  const domain = email.includes("@") ? email.slice(email.indexOf("@") + 1) : "";
  for (const entry of keepList) {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === email) return true;
    const domainEntry = normalized.startsWith("@") ? normalized.slice(1) : normalized;
    if (domain && domainEntry === domain && !domainEntry.includes("@")) return true;
  }
  return false;
}

export function shortSnippet(value: string, max = SNIPPET_MAX): string {
  const collapsed = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max).trim();
}

export function clipText(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : collapsed.slice(0, max).trim();
}
