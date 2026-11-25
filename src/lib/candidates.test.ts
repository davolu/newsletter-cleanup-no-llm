import { describe, expect, it } from "vitest";
import {
  detectCandidate,
  extractEmail,
  senderOnKeepList,
  shortSnippet,
  type MailHeader,
} from "./candidates";

function headers(pairs: Array<[string, string]>): MailHeader[] {
  return pairs.map(([name, value]) => ({ name, value }));
}

describe("candidate detection", () => {
  it("matches the Promotions category", () => {
    const result = detectCandidate({
      labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
      headers: [],
    });
    expect(result).toEqual({ isCandidate: true, reasons: ["promotions"] });
  });

  it("matches a List-Unsubscribe header and ignores a blank one", () => {
    expect(
      detectCandidate({
        labelIds: ["INBOX"],
        headers: headers([["List-Unsubscribe", "<mailto:bye@news.example>"]]),
      }).reasons,
    ).toEqual(["list-unsubscribe"]);

    expect(
      detectCandidate({
        labelIds: ["INBOX"],
        headers: headers([
          ["List-Unsubscribe", "   "],
          ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
        ]),
      }).reasons,
    ).toContain("list-unsubscribe");

    expect(
      detectCandidate({
        labelIds: ["INBOX"],
        headers: headers([["List-Unsubscribe", ""]]),
      }).isCandidate,
    ).toBe(false);
  });

  it("matches bulk-sender headers", () => {
    expect(
      detectCandidate({
        labelIds: [],
        headers: headers([["Precedence", "Bulk"]]),
      }).reasons,
    ).toEqual(["bulk-sender"]);

    expect(
      detectCandidate({
        labelIds: [],
        headers: headers([["Precedence", "normal, list"]]),
      }).reasons,
    ).toEqual(["bulk-sender"]);

    expect(
      detectCandidate({
        labelIds: [],
        headers: headers([["List-Id", "<weekly.news.example>"]]),
      }).reasons,
    ).toEqual(["bulk-sender"]);

    expect(
      detectCandidate({
        labelIds: [],
        headers: headers([["Feedback-ID", "campaign:mailgun"]]),
      }).reasons,
    ).toEqual(["bulk-sender"]);
  });

  it("records every signal that matched", () => {
    const result = detectCandidate({
      labelIds: ["CATEGORY_PROMOTIONS"],
      headers: headers([
        ["List-Unsubscribe", "<https://news.example/unsub>"],
        ["List-Id", "<deals.example>"],
      ]),
    });
    expect(result.isCandidate).toBe(true);
    expect(result.reasons).toEqual(["promotions", "list-unsubscribe", "bulk-sender"]);
  });

  it("leaves ordinary mail alone", () => {
    const result = detectCandidate({
      labelIds: ["INBOX", "CATEGORY_PERSONAL", "UNREAD"],
      headers: headers([
        ["From", "Ada <ada@example.com>"],
        ["Subject", "Lunch Thursday"],
        ["Precedence", "normal"],
        ["X-Mailer", "Example Mail 1.0"],
      ]),
    });
    expect(result).toEqual({ isCandidate: false, reasons: [] });
  });
});

describe("always-keep senders", () => {
  it("matches an address or a domain and ignores everyone else", () => {
    expect(extractEmail("Ada Lovelace <Ada@Example.com>")).toBe("ada@example.com");
    expect(senderOnKeepList("News <news@shop.example>", ["shop.example"])).toBe(true);
    expect(senderOnKeepList("News <news@shop.example>", ["@shop.example"])).toBe(true);
    expect(senderOnKeepList("News <news@shop.example>", ["news@shop.example"])).toBe(true);
    expect(senderOnKeepList("Ada <ada@example.com>", ["shop.example"])).toBe(false);
  });
});

describe("short snippet", () => {
  it("collapses whitespace and caps the length", () => {
    expect(shortSnippet("  hello\n\n  there  ")).toBe("hello there");
    expect(shortSnippet(`<b>${"a".repeat(400)}</b>`).length).toBeLessThanOrEqual(280);
    expect(shortSnippet(`<b>${"a".repeat(400)}</b>`)).not.toContain("<");
  });
});
