import { describe, expect, it, vi } from "vitest";
import { executeGmailTool } from "./gmail";
import {
  ALLOWED_GMAIL_TOOLS,
  archiveToolArgs,
  assertToolAllowed,
  labelToolArgs,
} from "./safety";

const BLOCKED = [
  "GMAIL_DELETE_MESSAGE",
  "GMAIL_DELETE_THREAD",
  "GMAIL_BATCH_DELETE_MESSAGES",
  "GMAIL_MOVE_TO_TRASH",
  "GMAIL_MOVE_THREAD_TO_TRASH",
  "GMAIL_UNTRASH_MESSAGE",
  "GMAIL_SEND_EMAIL",
];

describe("Gmail tool safety", () => {
  it("allows only read, label-list, label-create, and label-modify", () => {
    expect(ALLOWED_GMAIL_TOOLS).toEqual([
      "GMAIL_FETCH_EMAILS",
      "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      "GMAIL_LIST_LABELS",
      "GMAIL_CREATE_LABEL",
      "GMAIL_ADD_LABEL_TO_EMAIL",
    ]);
    for (const slug of ALLOWED_GMAIL_TOOLS) {
      expect(() => assertToolAllowed(slug)).not.toThrow();
    }
  });

  it("refuses delete and trash tools before any execution", async () => {
    const execute = vi.fn();
    for (const slug of BLOCKED) {
      expect(() => assertToolAllowed(slug)).toThrow(/never deletes or trashes/);
      await expect(executeGmailTool({ execute }, slug, {})).rejects.toThrow(/never deletes or trashes/);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("archives by removing INBOX only, and only adds a user label id", () => {
    expect(archiveToolArgs("abc123")).toEqual({
      user_id: "me",
      message_id: "abc123",
      remove_label_ids: ["INBOX"],
    });
    expect(labelToolArgs("abc123", "Label_42")).toEqual({
      user_id: "me",
      message_id: "abc123",
      add_label_ids: ["Label_42"],
    });
    expect(() => labelToolArgs("abc123", "TRASH")).toThrow(/user label/);
    expect(() => labelToolArgs("abc123", "INBOX")).toThrow(/user label/);
    expect(() => labelToolArgs("abc123", "Unsubscribe?")).toThrow(/user label/);
  });
});
