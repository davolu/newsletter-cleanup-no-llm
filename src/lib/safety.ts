export const UNSUBSCRIBE_LABEL = "Unsubscribe?";

/**
 * The only Gmail tools this app is allowed to execute.
 * Archive removes the INBOX label. The unsubscribe action adds one custom label.
 * Delete and trash tools are not in this list and are rejected if requested.
 */
export const ALLOWED_GMAIL_TOOLS = [
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GMAIL_LIST_LABELS",
  "GMAIL_CREATE_LABEL",
  "GMAIL_ADD_LABEL_TO_EMAIL",
] as const;

export type AllowedGmailTool = (typeof ALLOWED_GMAIL_TOOLS)[number];

const ALLOWED = new Set<string>(ALLOWED_GMAIL_TOOLS);

export function assertToolAllowed(slug: string): asserts slug is AllowedGmailTool {
  if (!ALLOWED.has(slug) || /DELETE|TRASH/i.test(slug)) {
    throw new Error(`Refusing Gmail tool ${slug}. This app never deletes or trashes mail.`);
  }
}

const CUSTOM_LABEL_ID = /^Label_[A-Za-z0-9_-]+$/;

export function assertCustomLabelId(labelId: string): void {
  if (!CUSTOM_LABEL_ID.test(labelId)) {
    throw new Error("Refusing a label id that is not a user label.");
  }
}

export function archiveToolArgs(messageId: string): Record<string, unknown> {
  if (!messageId.trim()) throw new Error("Missing message id.");
  return {
    user_id: "me",
    message_id: messageId,
    remove_label_ids: ["INBOX"],
  };
}

export function labelToolArgs(messageId: string, labelId: string): Record<string, unknown> {
  if (!messageId.trim()) throw new Error("Missing message id.");
  assertCustomLabelId(labelId);
  return {
    user_id: "me",
    message_id: messageId,
    add_label_ids: [labelId],
  };
}
