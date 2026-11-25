import { describe, expect, it } from "vitest";
import { parseCreatedLabelId, parseFetchPage, parseLabels, parseMessage } from "./gmail-parse";

describe("Gmail payload parsing", () => {
  it("reads a fetch-emails page with camelCase fields", () => {
    const page = parseFetchPage({
      messages: [
        {
          messageId: "18c5",
          threadId: "18c5",
          sender: "Deals <deals@news.example>",
          subject: "Weekly picks",
          snippet: "A short preview",
          labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
        },
      ],
      nextPageToken: "tok-2",
    });
    expect(page.nextPageToken).toBe("tok-2");
    expect(page.messages[0]).toMatchObject({
      id: "18c5",
      from: "Deals <deals@news.example>",
      subject: "Weekly picks",
      snippet: "A short preview",
      labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
    });
  });

  it("unwraps a nested data object and metadata headers", () => {
    const message = parseMessage({
      data: {
        id: "ab12",
        thread_id: "th9",
        payload: {
          headers: [
            { name: "From", value: "Ada <ada@example.com>" },
            { name: "Subject", value: "Hello" },
            { name: "List-Unsubscribe", value: "<mailto:bye@lists.example>" },
          ],
        },
        label_ids: ["INBOX"],
        snippet: "Hi",
      },
    });
    expect(message).toMatchObject({
      id: "ab12",
      threadId: "th9",
      from: "Ada <ada@example.com>",
      subject: "Hello",
      snippet: "Hi",
    });
    expect(message?.headers.map((header) => header.name)).toContain("List-Unsubscribe");
  });

  it("parses labels and a created label id", () => {
    expect(parseLabels({ labels: [{ id: "Label_7", name: "Unsubscribe?" }] })).toEqual([
      { id: "Label_7", name: "Unsubscribe?" },
    ]);
    expect(parseCreatedLabelId({ data: { label_id: "Label_8", name: "Unsubscribe?" } })).toBe("Label_8");
  });
});
