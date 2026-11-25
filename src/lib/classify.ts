import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { clipText, shortSnippet } from "./candidates";
import { JEV_MODEL_ID } from "./pricing";
import type { MailDecision } from "./types";

export type { MailDecision };

export type Classification = {
  decision: MailDecision;
  confidence: number | null;
  recognized: boolean;
  inputTokens: number;
  outputTokens: number;
  usageReported: boolean;
  model: string | null;
};

export type ClassifyInput = {
  sender: string;
  subject: string;
  snippet: string;
};

export type SystemOneCaller = {
  systemOne(request: {
    model?: string;
    state: ClassifyInput;
    questions: Record<string, unknown>;
  }): Promise<unknown>;
};

const DECISIONS = new Set<MailDecision>(["keep", "archive", "unsubscribe"]);

export const CLASSIFY_INSTRUCTIONS =
  "Choose exactly one action for this email. Do not invent another action.";

export function classificationQuestion() {
  return choice(CLASSIFY_INSTRUCTIONS, {
    keep: "Personal mail, a receipt, a security alert, a bill, or anything the person should still see in the inbox.",
    archive: "A newsletter, promotion, or other bulk message that can leave the inbox and stay searchable. Archiving is not deletion.",
    unsubscribe: "Bulk mail the person likely wants to stop. Flag it for a manual unsubscribe decision.",
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readToken(value: unknown): { tokens: number; reported: boolean } {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { tokens: value, reported: true };
  }
  return { tokens: 0, reported: false };
}

export function readUsage(payload: unknown): {
  inputTokens: number;
  outputTokens: number;
  usageReported: boolean;
} {
  const root = asRecord(payload);
  const usage = asRecord(root?.usage);
  const input = readToken(usage?.input_tokens ?? usage?.inputTokens);
  const output = readToken(usage?.output_tokens ?? usage?.outputTokens);
  return {
    inputTokens: input.tokens,
    outputTokens: output.tokens,
    usageReported: input.reported && output.reported,
  };
}

/**
 * Map a Jev response onto keep / archive / unsubscribe.
 * Anything else, including a missing answer, becomes keep and is marked unrecognized.
 * That keeps mail in the inbox when the answer is not one of the three actions.
 */
export function parseClassification(payload: unknown): Classification {
  const root = asRecord(payload);
  const answers = asRecord(root?.answers);
  const action = asRecord(answers?.action);
  const rawChoice = typeof action?.choice === "string" ? action.choice.trim().toLowerCase() : "";
  const recognized = DECISIONS.has(rawChoice as MailDecision);
  const confidence = typeof action?.confidence === "number" && Number.isFinite(action.confidence)
    ? action.confidence
    : null;
  const usage = readUsage(payload);
  const model = typeof root?.model === "string" ? root.model : null;
  return {
    decision: recognized ? (rawChoice as MailDecision) : "keep",
    confidence: recognized ? confidence : null,
    recognized,
    model,
    ...usage,
  };
}

export function classificationState(input: ClassifyInput): ClassifyInput {
  return {
    sender: clipText(input.sender, 200),
    subject: clipText(input.subject, 300),
    snippet: shortSnippet(input.snippet),
  };
}

export async function classifyMessage(
  caller: SystemOneCaller,
  input: ClassifyInput,
  model = JEV_MODEL_ID,
): Promise<Classification> {
  const state = classificationState(input);
  const response = await caller.systemOne({
    model,
    state,
    questions: { action: classificationQuestion() },
  });
  return parseClassification(response);
}

export function createJevCaller(): SystemOneCaller {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }
  const model = process.env.TYPESAFE_MODEL?.trim() || JEV_MODEL_ID;
  const client = new TypeSafeClient({
    apiKey,
    defaultModel: model,
    logLevel: "off",
  });
  return {
    systemOne(request) {
      return client.systemOne({
        model: request.model,
        state: request.state,
        questions: {
          action: classificationQuestion(),
        },
      });
    },
  };
}
