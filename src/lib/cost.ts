import {
  COMPARISON_MODEL,
  JEV_INPUT_USD_PER_MILLION,
  JEV_OUTPUT_USD_PER_MILLION,
} from "./pricing";

const PER_MILLION = 1_000_000;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type CostBreakdown = TokenUsage & {
  jevUsd: number;
  comparisonUsd: number;
};

function assertTokenCount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number that is zero or greater`);
  }
}

/** Dollars for a token count at a published per-million price. No other inputs. */
export function tokensToUsd(tokens: number, usdPerMillion: number): number {
  assertTokenCount(tokens, "token count");
  if (!Number.isFinite(usdPerMillion) || usdPerMillion < 0) {
    throw new Error("price must be a finite number that is zero or greater");
  }
  return (tokens * usdPerMillion) / PER_MILLION;
}

/** Jev bills input tokens. Output tokens are free, so they do not change this. */
export function jevCostUsd(inputTokens: number): number {
  return tokensToUsd(inputTokens, JEV_INPUT_USD_PER_MILLION) + tokensToUsd(0, JEV_OUTPUT_USD_PER_MILLION);
}

/**
 * The same input count at the comparison model's input price, plus the same
 * output count at its output price.
 */
export function comparisonCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    tokensToUsd(inputTokens, COMPARISON_MODEL.inputUsdPerMillion) +
    tokensToUsd(outputTokens, COMPARISON_MODEL.outputUsdPerMillion)
  );
}

export function costFromUsage(usage: TokenUsage): CostBreakdown {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    jevUsd: jevCostUsd(usage.inputTokens),
    comparisonUsd: comparisonCostUsd(usage.inputTokens, usage.outputTokens),
  };
}

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "$0.00";
  const abs = Math.abs(amount);
  const digits = abs >= 0.01 ? 4 : 6;
  const text = amount.toFixed(digits);
  return `$${text}`;
}
