/**
 * Published token prices used by the cost meter.
 *
 * Jev charges input tokens only. Output tokens are free.
 * Source: https://docs.typesafe.ai/models
 * (Jev 1.14 / Jev 1.13: $0.042 per million input tokens, output tokens free.)
 *
 * The comparison row prices the same input-token count and the same
 * output-token count at one mainstream model's published standard rates.
 * It is not a forecast of how that model would have classified the mail.
 *
 * Comparison model: gpt-4o-mini
 * Standard text tokens: input $0.15 per 1M, output $0.60 per 1M.
 * Source: https://developers.openai.com/api/docs/pricing
 * (Standard pricing table, columns Input and Output, row gpt-4o-mini.)
 */

export const JEV_MODEL_ID = "jev-latest";

/** US dollars per million input tokens. */
export const JEV_INPUT_USD_PER_MILLION = 0.042;

/** US dollars per million output tokens. Jev does not charge these. */
export const JEV_OUTPUT_USD_PER_MILLION = 0;

export const COMPARISON_MODEL = {
  id: "gpt-4o-mini",
  provider: "OpenAI",
  /** US dollars per million input tokens. */
  inputUsdPerMillion: 0.15,
  /** US dollars per million output tokens. */
  outputUsdPerMillion: 0.6,
} as const;
