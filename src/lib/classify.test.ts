import { describe, expect, it, vi } from "vitest";
import { classifyMessage, parseClassification, readUsage } from "./classify";

function jevResponse(choice: string, inputTokens: number, outputTokens: number, confidence = 0.91) {
  return {
    model: "jev-1.14.0",
    answers: {
      action: {
        type: "choice",
        choice,
        confidence,
        probabilities: { keep: 0.05, archive: 0.04, unsubscribe: 0.91 },
      },
    },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe("classification parsing", () => {
  it("accepts exactly the three actions", () => {
    expect(parseClassification(jevResponse("keep", 10, 2)).decision).toBe("keep");
    expect(parseClassification(jevResponse("archive", 10, 2)).decision).toBe("archive");
    expect(parseClassification(jevResponse("unsubscribe", 11, 3)).decision).toBe("unsubscribe");
    expect(parseClassification(jevResponse(" Archive ", 4, 1)).decision).toBe("archive");
  });

  it("keeps the message when the answer is missing or not one of the three", () => {
    expect(parseClassification(jevResponse("delete", 8, 1))).toMatchObject({
      decision: "keep",
      recognized: false,
      confidence: null,
    });
    expect(parseClassification({ answers: {}, usage: { input_tokens: 3, output_tokens: 1 } })).toMatchObject({
      decision: "keep",
      recognized: false,
    });
    expect(parseClassification(null)).toMatchObject({ decision: "keep", recognized: false, usageReported: false });
  });

  it("reads real token counts and does not invent them when they are absent", () => {
    expect(readUsage(jevResponse("keep", 428, 73))).toEqual({
      inputTokens: 428,
      outputTokens: 73,
      usageReported: true,
    });
    expect(readUsage({ usage: { input_tokens: null, output_tokens: null } })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      usageReported: false,
    });
    expect(parseClassification(jevResponse("archive", 15, 0))).toMatchObject({
      inputTokens: 15,
      outputTokens: 0,
      usageReported: true,
    });
  });
});

describe("classifyMessage", () => {
  it("sends only sender, subject, and a short snippet to the mocked classifier", async () => {
    const systemOne = vi.fn(async () => jevResponse("archive", 20, 4));
    const result = await classifyMessage(
      { systemOne },
      {
        sender: "Deals <deals@news.example>",
        subject: "  40% off  ",
        snippet: `<p>${"word ".repeat(200)}</p>`,
      },
    );

    expect(systemOne).toHaveBeenCalledTimes(1);
    const request = systemOne.mock.calls[0][0];
    expect(Object.keys(request.state).sort()).toEqual(["sender", "snippet", "subject"]);
    expect(request.state.sender).toBe("Deals <deals@news.example>");
    expect(request.state.subject).toBe("40% off");
    expect(request.state.snippet.length).toBeLessThanOrEqual(280);
    expect(request.state.snippet).not.toContain("<p>");
    expect(JSON.stringify(request.state)).not.toMatch(/body|html/i);
    expect(request.questions.action).toMatchObject({ type: "choice" });
    expect(Object.keys(request.questions.action.criteria).sort()).toEqual([
      "archive",
      "keep",
      "unsubscribe",
    ]);
    expect(request.model).toBe("jev-latest");
    expect(result).toMatchObject({
      decision: "archive",
      inputTokens: 20,
      outputTokens: 4,
      usageReported: true,
      model: "jev-1.14.0",
    });
  });
});
