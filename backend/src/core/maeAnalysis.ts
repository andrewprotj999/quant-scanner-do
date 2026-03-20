/**
 * Maximum Adverse Excursion (MAE) Analysis — v4
 *
 * Tracks how far each trade moves against the entry before recovering (or not).
 * Uses historical MAE data to:
 * 1. Optimize stop-loss placement (data-driven instead of fixed %)
 * 2. Identify optimal SL that captures 95% of winners while cutting losers early
 * 3. Detect if current SL is too tight (cutting winners) or too loose (holding losers)
 *
 * MAE = (lowestPrice - entryPrice) / entryPrice * 100  (always negative for longs)
 *
 * The key insight: if 95% of winning trades never dip below -7%,
 * then setting SL at -7% captures nearly all winners while cutting losers faster.
 */

import * as queries from "../db/queries.js";

// ─── TYPES ──────────────────────────────────────────────────

export interface MAEStats {
  /** Total closed positions analyzed */
  sampleSize: number;
  /** Winners only: MAE stats */
  winners: {
    count: number;
    avgMAE: number;       // Average max adverse excursion for winners (negative %)
    medianMAE: number;    // Median MAE for winners
    p75MAE: number;       // 75th percentile MAE (75% of winners never dipped below this)
    p90MAE: number;       // 90th percentile MAE
    p95MAE: number;       // 95th percentile — recommended SL threshold
    worstMAE: number;     // Worst MAE among winners
  };
  /** Losers only: MAE stats */
  losers: {
    count: number;
    avgMAE: number;
    medianMAE: number;
  };
  /** Recommended stop-loss based on MAE data */
  recommendedSL: number;  // Positive % (e.g., 8 means -8% SL)
  /** Current SL vs recommended */
  currentSL: number;
  /** Whether current SL is optimal */
  slAssessment: "optimal" | "too_tight" | "too_loose" | "insufficient_data";
  /** Confidence in the recommendation */
  confidence: "high" | "medium" | "low";
}

export interface MFEStats {
  /** Maximum Favorable Excursion — how far winners go before reversing */
  avgMFE: number;        // Average peak gain for winners
  medianMFE: number;
  p75MFE: number;        // 75% of winners reach at least this gain
  p90MFE: number;
  /** Recommended TP levels based on MFE data */
  recommendedTP1: number;
  recommendedTP2: number;
}

// ─── HELPERS ────────────────────────────────────────────────

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

function median(sortedArr: number[]): number {
  if (sortedArr.length === 0) return 0;
  const mid = Math.floor(sortedArr.length / 2);
  return sortedArr.length % 2 === 0
    ? (sortedArr[mid - 1] + sortedArr[mid]) / 2
    : sortedArr[mid];
}

// ─── MAE CALCULATION ────────────────────────────────────────

/**
 * Analyze MAE across closed positions to determine optimal stop-loss.
 * Requires at least 15 closed trades for meaningful analysis.
 */
export async function analyzeMAE(userId: number, currentSLPercent: number = 10): Promise<MAEStats> {
  const positions = await queries.getClosedPositions(userId, 200);

  if (positions.length < 15) {
    return {
      sampleSize: positions.length,
      winners: { count: 0, avgMAE: 0, medianMAE: 0, p75MAE: 0, p90MAE: 0, p95MAE: 0, worstMAE: 0 },
      losers: { count: 0, avgMAE: 0, medianMAE: 0 },
      recommendedSL: currentSLPercent,
      currentSL: currentSLPercent,
      slAssessment: "insufficient_data",
      confidence: "low",
    };
  }

  const winnerMAEs: number[] = [];
  const loserMAEs: number[] = [];

  for (const pos of positions) {
    const entryPrice = parseFloat(pos.entryPrice ?? "0");
    const lowestPrice = parseFloat(pos.lowestPrice ?? pos.entryPrice ?? "0");
    const pnl = parseFloat(pos.pnlPercent ?? "0");

    if (entryPrice <= 0) continue;

    // MAE = how far price dipped below entry (as positive %)
    const mae = Math.abs(((lowestPrice - entryPrice) / entryPrice) * 100);

    if (pnl >= 0) {
      winnerMAEs.push(mae);
    } else {
      loserMAEs.push(mae);
    }
  }

  // Sort for percentile calculations
  winnerMAEs.sort((a, b) => a - b);
  loserMAEs.sort((a, b) => a - b);

  const winnerStats = {
    count: winnerMAEs.length,
    avgMAE: winnerMAEs.length > 0 ? winnerMAEs.reduce((a, b) => a + b, 0) / winnerMAEs.length : 0,
    medianMAE: median(winnerMAEs),
    p75MAE: percentile(winnerMAEs, 75),
    p90MAE: percentile(winnerMAEs, 90),
    p95MAE: percentile(winnerMAEs, 95),
    worstMAE: winnerMAEs.length > 0 ? winnerMAEs[winnerMAEs.length - 1] : 0,
  };

  const loserStats = {
    count: loserMAEs.length,
    avgMAE: loserMAEs.length > 0 ? loserMAEs.reduce((a, b) => a + b, 0) / loserMAEs.length : 0,
    medianMAE: median(loserMAEs),
  };

  // Recommended SL: 95th percentile of winner MAE + small buffer (1%)
  // This captures 95% of winners while cutting losers faster
  let recommendedSL = winnerStats.p95MAE + 1;

  // Clamp between reasonable bounds (3% to 20%)
  recommendedSL = Math.max(3, Math.min(20, recommendedSL));

  // Round to 0.5% increments for clean values
  recommendedSL = Math.round(recommendedSL * 2) / 2;

  // Assess current SL
  let slAssessment: MAEStats["slAssessment"];
  const confidence: MAEStats["confidence"] =
    positions.length >= 100 ? "high" :
    positions.length >= 30 ? "medium" : "low";

  if (winnerMAEs.length < 10) {
    slAssessment = "insufficient_data";
  } else if (Math.abs(currentSLPercent - recommendedSL) <= 1.5) {
    slAssessment = "optimal";
  } else if (currentSLPercent < recommendedSL - 1.5) {
    slAssessment = "too_tight"; // Cutting winners prematurely
  } else {
    slAssessment = "too_loose"; // Holding losers too long
  }

  return {
    sampleSize: positions.length,
    winners: winnerStats,
    losers: loserStats,
    recommendedSL,
    currentSL: currentSLPercent,
    slAssessment,
    confidence,
  };
}

// ─── MFE CALCULATION ────────────────────────────────────────

/**
 * Analyze Maximum Favorable Excursion to optimize take-profit levels.
 * MFE = how far price went in our favor before the trade closed.
 */
export async function analyzeMFE(userId: number): Promise<MFEStats> {
  const positions = await queries.getClosedPositions(userId, 200);

  const winnerMFEs: number[] = [];

  for (const pos of positions) {
    const entryPrice = parseFloat(pos.entryPrice ?? "0");
    const highestPrice = parseFloat(pos.highestPrice ?? pos.entryPrice ?? "0");
    const pnl = parseFloat(pos.pnlPercent ?? "0");

    if (entryPrice <= 0 || pnl < 0) continue;

    // MFE = how far price went above entry (as positive %)
    const mfe = ((highestPrice - entryPrice) / entryPrice) * 100;
    winnerMFEs.push(mfe);
  }

  winnerMFEs.sort((a, b) => a - b);

  const avgMFE = winnerMFEs.length > 0 ? winnerMFEs.reduce((a, b) => a + b, 0) / winnerMFEs.length : 0;

  return {
    avgMFE,
    medianMFE: median(winnerMFEs),
    p75MFE: percentile(winnerMFEs, 75),
    p90MFE: percentile(winnerMFEs, 90),
    // TP1 at 50th percentile of MFE (half of winners reach this)
    recommendedTP1: Math.max(10, Math.round(percentile(winnerMFEs, 50) * 2) / 2),
    // TP2 at 75th percentile of MFE (25% of winners reach this)
    recommendedTP2: Math.max(25, Math.round(percentile(winnerMFEs, 75) * 2) / 2),
  };
}

// ─── MAE RECORDING (per-position tracking) ──────────────

// In-memory MAE tracking per position (cleared on close)
const positionMAE = new Map<number, number>();

/**
 * Record the current adverse excursion for a position.
 * Keeps track of the worst drawdown from entry.
 */
export async function recordMAE(positionId: number, drawdownPercent: number, _chain?: string): Promise<void> {
  const current = positionMAE.get(positionId) ?? 0;
  if (drawdownPercent > current) {
    positionMAE.set(positionId, drawdownPercent);
  }
}

/**
 * Get MAE stats — alias for analyzeMAE for API convenience.
 */
export async function getMAEStats(userId: number): Promise<MAEStats> {
  return analyzeMAE(userId);
}

// ─── OPTIMAL SL FOR CURRENT CYCLE ───────────────────────────

/**
 * Get the data-driven optimal stop-loss percentage.
 * Falls back to the provided default if insufficient data.
 */
export async function getOptimalStopLoss(userId: number, defaultSL: number): Promise<number> {
  const mae = await analyzeMAE(userId, defaultSL);

  if (mae.slAssessment === "insufficient_data") {
    return defaultSL;
  }

  // Only override if confidence is medium+ and the difference is meaningful
  if (mae.confidence === "low") return defaultSL;

  // Blend: 70% recommended + 30% current (gradual adaptation)
  const blendedSL = mae.recommendedSL * 0.7 + defaultSL * 0.3;
  return Math.round(blendedSL * 2) / 2; // Round to 0.5%
}
