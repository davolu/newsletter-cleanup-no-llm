import { Composio, SessionPreset } from "@composio/core";
import type { InspectableMessage } from "./candidates";
import { parseCreatedLabelId, parseFetchPage, parseLabels, parseMessage } from "./gmail-parse";
import { publicError } from "./redact";
import {
  ALLOWED_GMAIL_TOOLS,
  UNSUBSCRIBE_LABEL,
  archiveToolArgs,
  assertToolAllowed,
  labelToolArgs,
} from "./safety";

export const COMPOSIO_USER_ID = "newsletter-cleanup";

export type ToolSession = {
  execute(slug: string, args?: Record<string, unknown>): Promise<{
    data: Record<string, unknown>;
    error: string | null;
    resultType: "completed" | "failed" | "blocked";
  }>;
};

export type GmailClient = {
  listMessages(input: {
    query: string;
    pageToken: string | null;
    maxResults: number;
  }): Promise<{ messages: InspectableMessage[]; nextPageToken: string | null }>;
  getMessage(messageId: string): Promise<InspectableMessage | null>;
  ensureUnsubscribeLabel(): Promise<string>;
  archiveMessage(messageId: string): Promise<void>;
  labelMessage(messageId: string, labelId: string): Promise<void>;
};

export async function executeGmailTool(
  session: ToolSession,
  slug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertToolAllowed(slug);
  const result = await session.execute(slug, args);
  if (result.resultType !== "completed") {
    const reason = result.error?.trim() || `Gmail tool ${slug} did not complete`;
    throw new Error(publicError(new Error(reason)));
  }
  return result.data ?? {};
}

export function createGmailClient(session: ToolSession): GmailClient {
  return {
    async listMessages({ query, pageToken, maxResults }) {
      const args: Record<string, unknown> = {
        user_id: "me",
        query,
        max_results: maxResults,
        verbose: false,
        include_payload: true,
        include_spam_trash: false,
        ids_only: false,
      };
      if (pageToken) args.page_token = pageToken;
      const data = await executeGmailTool(session, "GMAIL_FETCH_EMAILS", args);
      return parseFetchPage(data);
    },
    async getMessage(messageId) {
      const data = await executeGmailTool(session, "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
        user_id: "me",
        message_id: messageId,
        format: "metadata",
      });
      return parseMessage(data);
    },
    async ensureUnsubscribeLabel() {
      const listed = await executeGmailTool(session, "GMAIL_LIST_LABELS", {
        user_id: "me",
        include_details: false,
      });
      const existing = parseLabels(listed).find((label) => label.name === UNSUBSCRIBE_LABEL);
      if (existing) return existing.id;
      const created = await executeGmailTool(session, "GMAIL_CREATE_LABEL", {
        user_id: "me",
        label_name: UNSUBSCRIBE_LABEL,
      });
      const id = parseCreatedLabelId(created);
      if (!id) throw new Error(`Could not create the ${UNSUBSCRIBE_LABEL} label.`);
      return id;
    },
    async archiveMessage(messageId) {
      await executeGmailTool(session, "GMAIL_ADD_LABEL_TO_EMAIL", archiveToolArgs(messageId));
    },
    async labelMessage(messageId, labelId) {
      await executeGmailTool(session, "GMAIL_ADD_LABEL_TO_EMAIL", labelToolArgs(messageId, labelId));
    },
  };
}

export async function createGmailSession() {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) throw new Error("COMPOSIO_API_KEY is not set");
  const composio = new Composio({
    apiKey,
    allowTracking: false,
    toolkitVersions: { gmail: "latest" },
  });
  return composio.create(COMPOSIO_USER_ID, {
    sessionPreset: SessionPreset.DIRECT_TOOLS,
    toolkits: ["gmail"],
    manageConnections: { enable: true },
    tools: {
      gmail: { enable: [...ALLOWED_GMAIL_TOOLS] },
    },
  });
}

export async function gmailConnectionStatus(session: {
  toolkits(options?: { toolkits?: string[] }): Promise<{
    items: Array<{
      slug: string;
      connection?: {
        isActive?: boolean;
        connectedAccount?: { id?: string; status?: string };
      };
    }>;
  }>;
}): Promise<{ connected: boolean; accountId: string | null }> {
  const listed = await session.toolkits({ toolkits: ["gmail"] });
  const gmail = listed.items.find((item) => item.slug.toLowerCase() === "gmail") ?? listed.items[0];
  const account = gmail?.connection?.connectedAccount;
  const connected = Boolean(gmail?.connection?.isActive) && account?.status !== "FAILED" && account?.status !== "EXPIRED";
  return {
    connected,
    accountId: connected ? account?.id ?? null : null,
  };
}
