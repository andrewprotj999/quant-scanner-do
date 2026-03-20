/**
 * Volatility-Adjusted Position Sizing — v4
 *
 * Adjusts position sizes based on realized volatility of each token.
 * High-volatility tokens get smaller positions; low-volatility tokens get larger.
 *
 * Uses ATR-like calculation from DexScreener price change data:
 * - m5, h1, h6, h24 price changes as volatility proxies
 * - Normalized against a "baseline" volatility for memecoin market
 *
 * Key principle: Risk per trade stays constant in dollar terms,
 * but position SIZE varies inversely with volatility.
 * A 2x more volatile token gets 0.5x the position size.
 */

// ─── TYPES ──────────────────────────────────────────────────

export interface VolatilityProfile {
  /** Raw volatility score (0-100, higher = more volatile) */
  volatilityScore: number;
  /** Position size multiplier (0.3 to 1.5) */
  sizeMultiplier: number;
  /** Suggested stop-loss adjustment (wider for volatile tokens) */
  slMultiplier: number;
  /** Volatility tier for logging */
  tier: "ultra_low" | "low" | "normal" | "high" | "extreme";
  /** Individual components */
  components: {
    m5Volatility: number;
    h1Volatility: number;
    h6Volatility: number;
    h24Volatility: number;
    buyPressureRatio: number;
  };
}

// ─── CONSTANTS ──────────────────────────────────────────────

// Baseline volatility for memecoin market (typical ranges)
const BASELINE_M5_CHANGE = 2;     // ±2% in 5 min is "normal" for memecoins
const BASELINE_H1_CHANGE = 8;     // ±8% in 1 hour
const BASELINE_H6_CHANGE = 15;    // ±15% in 6 hours
const BASELINE_H24_CHANGE = 25;   // ±25% in 24 hours

// Volatility tier thresholds (score 0-100)
const TIERS = {
  ultra_low: { max: 15, sizeMultiplier: 1.5, slMultiplier: 0.7 },
  low:       { max: 30, sizeMultiplier: 1.2, slMultiplier: 0.85 },
  normal:    { max: 55, sizeMultiplier: 1.0, slMultiplier: 1.0 },
  high:      { max: 75, sizeMultiplier: 0.6, slMultiplier: 1.3 },
  extreme:   { max: 100, sizeMultiplier: 0.35, slMultiplier: 1.6 },
};

// ─── VOLATILITY CALCULATION ─────────────────────────────────

/**
 * Calculate volatility profile from DexScreener pair data.
 * Returns a multiplier to apply to position size.
 */
export function calculateVolatilityProfile(pair: {
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
  };
  volume?: { m5?: number; h1?: number; h24?: number };
}): VolatilityProfile {
  const changes = pair.priceChange ?? {};

  // Calculate normalized volatility for each timeframe
  // Use absolute values — we care about magnitude, not direction
  const m5Vol = Math.abs(changes.m5 ?? 0) / BASELINE_M5_CHANGE;
  const h1Vol = Math.abs(changes.h1 ?? 0) / BASELINE_H1_CHANGE;
  const h6Vol = Math.abs(changes.h6 ?? 0) / BASELINE_H6_CHANGE;
  const h24Vol = Math.abs(changes.h24 ?? 0) / BASELINE_H24_CHANGE;

  // Buy pressure ratio (high sell pressure = more volatile/risky)
  const m5Buys = pair.txns?.m5?.buys ?? 0;
  const m5Sells = pair.txns?.m5?.sells ?? 0;
  const totalTxns = m5Buys + m5Sells;
  const buyPressureRatio = totalTxns > 0 ? m5Buys / totalTxns : 0.5;

  // Weighted volatility score (recent timeframes weighted more)
  // m5: 35%, h1: 30%, h6: 20%, h24: 15%
  let rawScore = (m5Vol * 0.35 + h1Vol * 0.30 + h6Vol * 0.20 + h24Vol * 0.15) * 50;

  // Sell pressure penalty: if sells > 60% of transactions, add volatility
  if (buyPressureRatio < 0.4) {
    rawScore *= 1.2;
  }

  // Clamp to 0-100
  const volatilityScore = Math.max(0, Math.min(100, rawScore));

  // Determine tier
  let tier: VolatilityProfile["tier"] = "normal";
  let sizeMultiplier = 1.0;
  let slMultiplier = 1.0;

  if (volatilityScore <= TIERS.ultra_low.max) {
    tier = "ultra_low";
    sizeMultiplier = TIERS.ultra_low.sizeMultiplier;
    slMultiplier = TIERS.ultra_low.slMultiplier;
  } else if (volatilityScore <= TIERS.low.max) {
    tier = "low";
    sizeMultiplier = TIERS.low.sizeMultiplier;
    slMultiplier = TIERS.low.slMultiplier;
  } else if (volatilityScore <= TIERS.normal.max) {
    tier = "normal";
    sizeMultiplier = TIERS.normal.sizeMultiplier;
    slMultiplier = TIERS.normal.slMultiplier;
  } else if (volatilityScore <= TIERS.high.max) {
    tier = "high";
    sizeMultiplier = TIERS.high.sizeMultiplier;
    slMultiplier = TIERS.high.slMultiplier;
  } else {
    tier = "extreme";
    sizeMultiplier = TIERS.extreme.sizeMultiplier;
    slMultiplier = TIERS.extreme.slMultiplier;
  }

  return {
    volatilityScore,
    sizeMultiplier,
    slMultiplier,
    tier,
    components: {
      m5Volatility: m5Vol,
      h1Volatility: h1Vol,
      h6Volatility: h6Vol,
      h24Volatility: h24Vol,
      buyPressureRatio,
    },
  };
}

/**
 * Quick volatility multiplier for position sizing.
 * Returns a number between 0.35 and 1.5.
 */
export function getVolatilityMultiplier(pair: {
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: { m5?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number } };
}): number {
  return calculateVolatilityProfile(pair).sizeMultiplier;
}

/**
 * Get volatility-adjusted stop-loss percentage.
 * Widens SL for volatile tokens, tightens for calm ones.
 */
export function getVolatilityAdjustedSL(
  baseSLPercent: number,
  pair: {
    priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
    txns?: { m5?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number } };
  }
): number {
  const profile = calculateVolatilityProfile(pair);
  const adjustedSL = baseSLPercent * profile.slMultiplier;
  // Clamp between 3% and 25%
  return Math.max(3, Math.min(25, Math.round(adjustedSL * 2) / 2));
}
