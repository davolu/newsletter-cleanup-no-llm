import { describe, expect, it } from "vitest";
import { comparisonCostUsd, costFromUsage, formatUsd, jevCostUsd, tokensToUsd } from "./cost";
import {
  COMPARISON_MODEL,
  JEV_INPUT_USD_PER_MILLION,
  JEV_OUTPUT_USD_PER_MILLION,
} from "./pricing";

describe("cost math", () => {
  it("uses the published Jev and comparison prices", () => {
    expect(JEV_INPUT_USD_PER_MILLION).toBe(0.042);
    expect(JEV_OUTPUT_USD_PER_MILLION).toBe(0);
    expect(COMPARISON_MODEL.id).toBe("gpt-4o-mini");
    expect(COMPARISON_MODEL.inputUsdPerMillion).toBe(0.15);
    expect(COMPARISON_MODEL.outputUsdPerMillion).toBe(0.6);
  });

  it("prices one million Jev input tokens at $0.042 and ignores output tokens", () => {
    expect(jevCostUsd(1_000_000)).toBeCloseTo(0.042, 10);
    expect(jevCostUsd(2_000_000)).toBeCloseTo(0.084, 10);
    expect(jevCostUsd(0)).toBe(0);
    expect(tokensToUsd(1_000_000, JEV_OUTPUT_USD_PER_MILLION)).toBe(0);
  });

  it("prices the same token counts at the comparison model's published rates", () => {
    expect(comparisonCostUsd(1_000_000, 0)).toBeCloseTo(0.15, 10);
    expect(comparisonCostUsd(0, 1_000_000)).toBeCloseTo(0.6, 10);
    expect(comparisonCostUsd(1_000_000, 1_000_000)).toBeCloseTo(0.75, 10);
    expect(comparisonCostUsd(100_000, 5_000)).toBeCloseTo(0.015 + 0.003, 10);
  });

  it("does not add Jev output tokens into the Jev total", () => {
    const usage = costFromUsage({ inputTokens: 250_000, outputTokens: 80_000 });
    expect(usage.jevUsd).toBeCloseTo(jevCostUsd(250_000), 12);
    expect(usage.comparisonUsd).toBeCloseTo(comparisonCostUsd(250_000, 80_000), 12);
    expect(usage.jevUsd).toBeLessThan(usage.comparisonUsd);
  });

  it("rejects counts that are not real token totals", () => {
    expect(() => jevCostUsd(-1)).toThrow(/zero or greater/);
    expect(() => comparisonCostUsd(Number.NaN, 1)).toThrow(/finite/);
    expect(() => comparisonCostUsd(1, Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });

  it("formats tiny totals without rounding them away to zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(jevCostUsd(1_000_000))).toBe("$0.0420");
    expect(formatUsd(jevCostUsd(1_000))).toBe("$0.000042");
  });
});
