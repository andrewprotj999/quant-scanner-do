/**
 * Equity Curve Moving Average — v4
 *
 * Applies trend-following logic to the equity curve itself:
 * - When equity is ABOVE its moving average → full aggression
 * - When equity is BELOW its moving average → reduce sizing
 * - When equity crosses below → trigger defensive mode
 *
 * This is a meta-strategy used by professional CTAs and prop firms.
 * The idea: if your system is in a drawdown, it's likely in an
 * unfavorable market regime. Reducing size during drawdowns and
 * increasing during winning streaks compounds returns.
 *
 * Uses exponential moving average (EMA) for faster response.
 */

import * as queries from "../db/queries.js";

// ─── TYPES ──────────────────────────────────────────────────

export interface EquityCurveState {
  /** Current equity */
  currentEquity: number;
  /** EMA of equity curve */
  equityEMA: number;
  /** Whether equity is above EMA */
  aboveEMA: boolean;
  /** Distance from EMA as percentage */
  distanceFromEMA: number;
  /** Position size multiplier based on equity curve position */
  sizeMultiplier: number;
  /** Trading mode */
  mode: "aggressive" | "normal" | "defensive" | "recovery";
  /** Number of equity snapshots used */
  sampleSize: number;
  /** Trend direction of equity curve */
  trend: "up" | "flat" | "down";
}

// ─── CONSTANTS ──────────────────────────────────────────────

const EMA_PERIOD = 20;           // 20-trade EMA
const AGGRESSIVE_THRESHOLD = 3;  // 3% above EMA → aggressive
const DEFENSIVE_THRESHOLD = -3;  // 3% below EMA → defensive
const RECOVERY_THRESHOLD = -7;   // 7% below EMA → recovery mode
const MIN_SNAPSHOTS = 10;        // Minimum snapshots for meaningful EMA

// ─── EMA CALCULATION ────────────────────────────────────────

function calculateEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const k = 2 / (period + 1);
  let ema = values[0]; // Start with first value as seed

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return ema;
}

/**
 * Calculate trend direction from recent equity values.
 * Uses simple linear regression slope.
 */
function calculateTrend(values: number[]): "up" | "flat" | "down" {
  if (values.length < 5) return "flat";

  // Use last 10 values
  const recent = values.slice(-10);
  const n = recent.length;

  // Simple slope calculation
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += recent[i];
    sumXY += i * recent[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgEquity = sumY / n;
  const normalizedSlope = avgEquity > 0 ? (slope / avgEquity) * 100 : 0;

  if (normalizedSlope > 0.5) return "up";
  if (normalizedSlope < -0.5) return "down";
  return "flat";
}

// ─── EQUITY CURVE ANALYSIS ──────────────────────────────────

/**
 * Analyze the equity curve and return trading mode + size multiplier.
 * Call at the start of each engine cycle.
 */
export async function analyzeEquityCurve(userId: number): Promise<EquityCurveState> {
  const snapshots = await queries.getEquitySnapshots(userId, 100);

  if (snapshots.length < MIN_SNAPSHOTS) {
    // Not enough data — use neutral settings
    const state = await queries.getEngineState(userId);
    const currentEquity = parseFloat(state?.equity ?? "1000");
    return {
      currentEquity,
      equityEMA: currentEquity,
      aboveEMA: true,
      distanceFromEMA: 0,
      sizeMultiplier: 1.0,
      mode: "normal",
      sampleSize: snapshots.length,
      trend: "flat",
    };
  }

  // Extract equity values (oldest first)
  const equityValues = snapshots
    .reverse()
    .map(s => parseFloat(s.equity ?? "1000"));

  const currentEquity = equityValues[equityValues.length - 1];
  const equityEMA = calculateEMA(equityValues, EMA_PERIOD);
  const distanceFromEMA = equityEMA > 0
    ? ((currentEquity - equityEMA) / equityEMA) * 100
    : 0;
  const aboveEMA = currentEquity >= equityEMA;
  const trend = calculateTrend(equityValues);

  // Determine mode and multiplier
  let mode: EquityCurveState["mode"];
  let sizeMultiplier: number;

  if (distanceFromEMA <= RECOVERY_THRESHOLD) {
    mode = "recovery";
    sizeMultiplier = 0.3; // Minimal sizing during deep drawdown
  } else if (distanceFromEMA <= DEFENSIVE_THRESHOLD) {
    mode = "defensive";
    sizeMultiplier = 0.6; // Reduced sizing
  } else if (distanceFromEMA >= AGGRESSIVE_THRESHOLD && trend === "up") {
    mode = "aggressive";
    sizeMultiplier = 1.3; // Increased sizing during winning streak
  } else {
    mode = "normal";
    sizeMultiplier = 1.0;
  }

  // Additional trend adjustment
  if (trend === "down" && mode === "normal") {
    sizeMultiplier *= 0.85; // Slight reduction in downtrend
  }

  return {
    currentEquity,
    equityEMA,
    aboveEMA,
    distanceFromEMA,
    sizeMultiplier,
    mode,
    sampleSize: snapshots.length,
    trend,
  };
}

/**
 * Quick equity curve multiplier.
 */
export async function getEquityCurveMultiplier(userId: number): Promise<number> {
  const state = await analyzeEquityCurve(userId);
  return state.sizeMultiplier;
}
