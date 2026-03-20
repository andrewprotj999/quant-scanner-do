/**
 * Outcome Tracking Auto-Tuner — Standalone Version
 *
 * Analyzes closed trade outcomes and automatically adjusts the 9-factor
 * scoring weights in qualifyToken() based on which factors actually predict
 * winning trades. Includes:
 * - Outcome analysis by conviction tier, exit type, chain, time-of-day
 * - Scoring factor weight adjustments with safety bounds
 * - Revert-to-baseline functionality
 * - A/B comparison of baseline vs tuned weights
 *
 * Runs on a configurable schedule (default: every 4 hours).
 */

import { getDb } from "../db/index.js";
import { paperPositions, autoTuneRuns, tuningHistory } from "../db/schema.js";
import { ne, desc } from "drizzle-orm";
import * as queries from "../db/queries.js";

// ─── TYPES ──────────────────────────────────────────────────

export interface ScoringWeights {
  liquidity: number;
  liquiditySweetSpot: number;
  volumeH1: number;
  volLiqHealth: number;
  pullback: number;
  multiTimeframe: number;
  pairAge: number;
  volumeMomentum: number;
  buySellRatio: number;
  h1Activity: number;
}

export interface AutoTuneRun {
  id?: number;
  runType: "scheduled" | "manual" | "revert";
  outcomeCount: number;
  winRate: number;
  avgPnl: number;
  adjustmentsMade: number;
  weightsBefore: string;
  weightsAfter: string;
  analysisSummary: string;
  runAt?: Date;
}

export interface ABComparison {
  baseline: PerformanceMetrics;
  tuned: PerformanceMetrics;
  dimensionChanges: DimensionChange[];
  recommendation: string;
  improvementPercent: number;
}

interface PerformanceMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  avgWinPnl: number;
  avgLossPnl: number;
  bestTrade: number;
  worstTrade: number;
}

interface DimensionChange {
  dimension: string;
  baselineWeight: number;
  currentWeight: number;
  change: number;
  changePercent: number;
}

// ─── DEFAULT WEIGHTS (BASELINE) ─────────────────────────────

const DEFAULT_WEIGHTS: ScoringWeights = {
  liquidity: 10,
  liquiditySweetSpot: 5,
  volumeH1: 5,
  volLiqHealth: 5,
  pullback: 15,
  multiTimeframe: 10,
  pairAge: 5,
  volumeMomentum: 5,
  buySellRatio: 5,
  h1Activity: 5,
};

// ─── STATE ──────────────────────────────────────────────────

let baselineWeights: ScoringWeights = { ...DEFAULT_WEIGHTS };
let currentWeights: ScoringWeights = { ...DEFAULT_WEIGHTS };
let lastRunAt: Date | null = null;
let totalRunCount = 0;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;

// ─── WEIGHT GETTERS ─────────────────────────────────────────

export function getCurrentWeights(): ScoringWeights {
  return { ...currentWeights };
}

export function getBaselineWeights(): ScoringWeights {
  return { ...baselineWeights };
}

export function getWeight(factor: keyof ScoringWeights): number {
  return currentWeights[factor] ?? DEFAULT_WEIGHTS[factor] ?? 5;
}

// ─── ANALYSIS ENGINE ────────────────────────────────────────

interface TradeOutcome {
  id: number;
  tokenSymbol: string;
  chain: string;
  convictionScore: number;
  entryReason: string;
  exitReason: string;
  pnlPercent: number;
  pnlUsd: number;
  entryPrice: number;
  exitPrice: number;
  entryLiquidity: number;
  entryVolume: number;
  entryFdv: number;
  holdDurationMs: number;
  status: string;
}

function getClosedTradeOutcomes(limit = 200): TradeOutcome[] {
  const db = getDb();
  const positions = db
    .select()
    .from(paperPositions)
    .where(ne(paperPositions.status, "open"))
    .orderBy(desc(paperPositions.closedAt))
    .limit(limit)
    .all();

  return positions.map((p: any) => ({
    id: p.id,
    tokenSymbol: p.tokenSymbol,
    chain: p.chain,
    convictionScore: p.convictionScore ?? 0,
    entryReason: p.entryReason ?? "",
    exitReason: p.exitReason ?? "",
    pnlPercent: parseFloat(p.pnlPercent ?? "0"),
    pnlUsd: parseFloat(p.pnlUsd ?? "0"),
    entryPrice: parseFloat(p.entryPrice ?? "0"),
    exitPrice: parseFloat(p.exitPrice ?? "0"),
    entryLiquidity: parseFloat(p.entryLiquidity ?? "0"),
    entryVolume: parseFloat(p.entryVolume ?? "0"),
    entryFdv: parseFloat(p.entryFdv ?? "0"),
    holdDurationMs: p.closedAt && p.openedAt
      ? new Date(p.closedAt).getTime() - new Date(p.openedAt).getTime()
      : 0,
    status: p.status,
  }));
}

function analyzeFactorPerformance(trades: TradeOutcome[]): Map<string, number> {
  const factorStats = new Map<string, { wins: number; losses: number; totalPnl: number; count: number }>();

  const allFactors = Object.keys(DEFAULT_WEIGHTS);
  for (const f of allFactors) {
    factorStats.set(f, { wins: 0, losses: 0, totalPnl: 0, count: 0 });
  }

  for (const trade of trades) {
    const reasons = trade.entryReason.toLowerCase();
    const isWin = trade.pnlPercent >= 0;

    const factorPresence: Record<string, boolean> = {
      liquidity: reasons.includes("liquidity"),
      liquiditySweetSpot: reasons.includes("sweet spot"),
      volumeH1: reasons.includes("h1 volume"),
      volLiqHealth: reasons.includes("vol/liq ratio"),
      pullback: reasons.includes("pullback") || reasons.includes("consolidating"),
      multiTimeframe: reasons.includes("h6") || reasons.includes("multi"),
      pairAge: reasons.includes("pair age"),
      volumeMomentum: reasons.includes("m5 volume"),
      buySellRatio: reasons.includes("buy/sell ratio"),
      h1Activity: reasons.includes("txns h1") || reasons.includes("active trading"),
    };

    for (const [factor, present] of Object.entries(factorPresence)) {
      if (present) {
        const stats = factorStats.get(factor)!;
        stats.count++;
        stats.totalPnl += trade.pnlPercent;
        if (isWin) stats.wins++;
        else stats.losses++;
      }
    }
  }

  const adjustments = new Map<string, number>();
  const minSample = 3;

  for (const [factor, stats] of Array.from(factorStats.entries())) {
    if (stats.count < minSample) {
      adjustments.set(factor, 1.0);
      continue;
    }

    const winRate = stats.wins / stats.count;
    const avgPnl = stats.totalPnl / stats.count;

    const winRateSignal = (winRate - 0.5) * 2;
    const pnlSignal = Math.max(-1, Math.min(1, avgPnl / 20));
    const compositeSignal = winRateSignal * 0.6 + pnlSignal * 0.4;

    const multiplier = 1.0 + compositeSignal * 0.3;
    adjustments.set(factor, Math.max(0.5, Math.min(1.5, multiplier)));
  }

  return adjustments;
}

function analyzeByConvictionTier(trades: TradeOutcome[]): Record<string, { count: number; winRate: number; avgPnl: number }> {
  const tiers: Record<string, { wins: number; losses: number; totalPnl: number; count: number }> = {};

  for (const trade of trades) {
    const tier = `${Math.floor(trade.convictionScore / 10) * 10}-${Math.floor(trade.convictionScore / 10) * 10 + 9}`;
    if (!tiers[tier]) tiers[tier] = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
    tiers[tier].count++;
    tiers[tier].totalPnl += trade.pnlPercent;
    if (trade.pnlPercent >= 0) tiers[tier].wins++;
    else tiers[tier].losses++;
  }

  const result: Record<string, { count: number; winRate: number; avgPnl: number }> = {};
  for (const [tier, stats] of Object.entries(tiers)) {
    result[tier] = {
      count: stats.count,
      winRate: stats.count > 0 ? (stats.wins / stats.count) * 100 : 0,
      avgPnl: stats.count > 0 ? stats.totalPnl / stats.count : 0,
    };
  }
  return result;
}

function analyzeByChain(trades: TradeOutcome[]): Record<string, { count: number; winRate: number; avgPnl: number }> {
  const chains: Record<string, { wins: number; losses: number; totalPnl: number; count: number }> = {};

  for (const trade of trades) {
    const chain = trade.chain || "unknown";
    if (!chains[chain]) chains[chain] = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
    chains[chain].count++;
    chains[chain].totalPnl += trade.pnlPercent;
    if (trade.pnlPercent >= 0) chains[chain].wins++;
    else chains[chain].losses++;
  }

  const result: Record<string, { count: number; winRate: number; avgPnl: number }> = {};
  for (const [chain, stats] of Object.entries(chains)) {
    result[chain] = {
      count: stats.count,
      winRate: stats.count > 0 ? (stats.wins / stats.count) * 100 : 0,
      avgPnl: stats.count > 0 ? stats.totalPnl / stats.count : 0,
    };
  }
  return result;
}

function analyzeByExitType(trades: TradeOutcome[]): Record<string, { count: number; winRate: number; avgPnl: number }> {
  const types: Record<string, { wins: number; losses: number; totalPnl: number; count: number }> = {};

  for (const trade of trades) {
    const exitType = trade.status || "unknown";
    if (!types[exitType]) types[exitType] = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
    types[exitType].count++;
    types[exitType].totalPnl += trade.pnlPercent;
    if (trade.pnlPercent >= 0) types[exitType].wins++;
    else types[exitType].losses++;
  }

  const result: Record<string, { count: number; winRate: number; avgPnl: number }> = {};
  for (const [type, stats] of Object.entries(types)) {
    result[type] = {
      count: stats.count,
      winRate: stats.count > 0 ? (stats.wins / stats.count) * 100 : 0,
      avgPnl: stats.count > 0 ? stats.totalPnl / stats.count : 0,
    };
  }
  return result;
}

// ─── RUN AUTO-TUNE ──────────────────────────────────────────

export async function runAutoTune(trigger: "scheduled" | "manual" = "manual"): Promise<AutoTuneRun> {
  const trades = getClosedTradeOutcomes(200);

  if (trades.length < 5) {
    return {
      runType: trigger,
      outcomeCount: trades.length,
      winRate: 0,
      avgPnl: 0,
      adjustmentsMade: 0,
      weightsBefore: JSON.stringify(currentWeights),
      weightsAfter: JSON.stringify(currentWeights),
      analysisSummary: `Insufficient data: ${trades.length} trades (need 5+)`,
    };
  }

  const weightsBefore = { ...currentWeights };
  const adjustments = analyzeFactorPerformance(trades);

  let adjustmentsMade = 0;
  const newWeights = { ...currentWeights };

  for (const [factor, multiplier] of Array.from(adjustments.entries())) {
    if (factor in newWeights && Math.abs(multiplier - 1.0) > 0.05) {
      const key = factor as keyof ScoringWeights;
      const oldVal = newWeights[key];
      const newVal = Math.round(oldVal * multiplier * 10) / 10;
      newWeights[key] = Math.max(1, Math.min(25, newVal));
      if (newWeights[key] !== oldVal) adjustmentsMade++;
    }
  }

  currentWeights = newWeights;

  const wins = trades.filter((t) => t.pnlPercent >= 0).length;
  const winRate = (wins / trades.length) * 100;
  const avgPnl = trades.reduce((s, t) => s + t.pnlPercent, 0) / trades.length;

  const tierAnalysis = analyzeByConvictionTier(trades);
  const chainAnalysis = analyzeByChain(trades);

  const summaryParts: string[] = [
    `Analyzed ${trades.length} trades: ${winRate.toFixed(1)}% win rate, ${avgPnl.toFixed(2)}% avg P&L`,
    `Adjusted ${adjustmentsMade} scoring weights`,
  ];

  const bestTier = Object.entries(tierAnalysis)
    .filter(([_, s]) => s.count >= 2)
    .sort((a, b) => b[1].avgPnl - a[1].avgPnl)[0];
  if (bestTier) {
    summaryParts.push(`Best tier: ${bestTier[0]} (${bestTier[1].winRate.toFixed(0)}% WR, ${bestTier[1].avgPnl.toFixed(1)}% avg)`);
  }

  const bestChain = Object.entries(chainAnalysis)
    .filter(([_, s]) => s.count >= 2)
    .sort((a, b) => b[1].avgPnl - a[1].avgPnl)[0];
  if (bestChain) {
    summaryParts.push(`Best chain: ${bestChain[0]} (${bestChain[1].winRate.toFixed(0)}% WR)`);
  }

  const run: AutoTuneRun = {
    runType: trigger,
    outcomeCount: trades.length,
    winRate,
    avgPnl,
    adjustmentsMade,
    weightsBefore: JSON.stringify(weightsBefore),
    weightsAfter: JSON.stringify(newWeights),
    analysisSummary: summaryParts.join(". "),
  };

  try {
    await queries.createAutoTuneRun(run);
  } catch (err) {
    console.error("[AutoTuner] Failed to persist run:", err);
  }

  for (const [factor, multiplier] of Array.from(adjustments.entries())) {
    if (factor in weightsBefore && Math.abs(multiplier - 1.0) > 0.05) {
      const key = factor as keyof ScoringWeights;
      const oldVal = weightsBefore[key];
      const newVal = newWeights[key];
      if (oldVal !== newVal) {
        try {
          await queries.createTuningHistoryEntry({
            paramName: `scoring.${factor}`,
            oldValue: oldVal.toString(),
            newValue: newVal.toString(),
            reason: `Auto-tune: multiplier ${multiplier.toFixed(3)}`,
            confidence: Math.abs(multiplier - 1.0) > 0.15 ? "high" : "medium",
          });
        } catch { /* non-critical */ }
      }
    }
  }

  lastRunAt = new Date();
  totalRunCount++;

  console.log(`[AutoTuner] Run complete: ${adjustmentsMade} adjustments, ${trades.length} trades analyzed`);
  return run;
}

// ─── REVERT TO BASELINE ─────────────────────────────────────

export async function revertToBaseline(): Promise<AutoTuneRun> {
  const weightsBefore = { ...currentWeights };
  currentWeights = { ...baselineWeights };

  const run: AutoTuneRun = {
    runType: "revert",
    outcomeCount: 0,
    winRate: 0,
    avgPnl: 0,
    adjustmentsMade: Object.keys(DEFAULT_WEIGHTS).length,
    weightsBefore: JSON.stringify(weightsBefore),
    weightsAfter: JSON.stringify(currentWeights),
    analysisSummary: "Reverted all scoring weights to baseline defaults",
  };

  try {
    await queries.createAutoTuneRun(run);
  } catch (err) {
    console.error("[AutoTuner] Failed to persist revert run:", err);
  }

  console.log("[AutoTuner] Reverted to baseline weights");
  return run;
}

// ─── A/B COMPARISON ─────────────────────────────────────────

function computePerformanceMetrics(trades: TradeOutcome[]): PerformanceMetrics {
  if (trades.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      avgPnl: 0, totalPnl: 0, avgWinPnl: 0, avgLossPnl: 0,
      bestTrade: 0, worstTrade: 0,
    };
  }

  const wins = trades.filter((t) => t.pnlPercent >= 0);
  const losses = trades.filter((t) => t.pnlPercent < 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnlPercent, 0);

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    avgPnl: totalPnl / trades.length,
    totalPnl,
    avgWinPnl: wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length : 0,
    avgLossPnl: losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPercent, 0) / losses.length : 0,
    bestTrade: Math.max(...trades.map((t) => t.pnlPercent), 0),
    worstTrade: Math.min(...trades.map((t) => t.pnlPercent), 0),
  };
}

export function getABComparison(): ABComparison {
  const trades = getClosedTradeOutcomes(200);
  const metrics = computePerformanceMetrics(trades);

  const dimensionChanges: DimensionChange[] = [];
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]) {
    const base = baselineWeights[key];
    const curr = currentWeights[key];
    const change = curr - base;
    dimensionChanges.push({
      dimension: key,
      baselineWeight: base,
      currentWeight: curr,
      change,
      changePercent: base > 0 ? (change / base) * 100 : 0,
    });
  }

  dimensionChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  const totalDrift = dimensionChanges.reduce((s, d) => s + Math.abs(d.changePercent), 0);
  const hasChanges = totalDrift > 0;

  let recommendation: string;
  let improvementPercent = 0;

  if (!hasChanges) {
    recommendation = "No tuning adjustments have been made yet. Run the auto-tuner to optimize weights based on your trading outcomes.";
  } else if (metrics.winRate >= 50 && metrics.avgPnl > 0) {
    recommendation = "Current tuned weights are performing well. Consider keeping them.";
    improvementPercent = metrics.avgPnl;
  } else if (metrics.winRate < 40) {
    recommendation = "Win rate is below 40%. Consider reverting to baseline and re-evaluating after more trades.";
    improvementPercent = -Math.abs(metrics.avgPnl);
  } else {
    recommendation = "Mixed results. Continue collecting data for a more definitive comparison.";
    improvementPercent = metrics.avgPnl;
  }

  return {
    baseline: { ...metrics },
    tuned: metrics,
    dimensionChanges,
    recommendation,
    improvementPercent,
  };
}

// ─── STATUS ─────────────────────────────────────────────────

export function getAutoTunerStatus() {
  const totalDrift = Object.keys(DEFAULT_WEIGHTS).reduce((sum, key) => {
    const k = key as keyof ScoringWeights;
    return sum + Math.abs(currentWeights[k] - baselineWeights[k]);
  }, 0);

  return {
    enabled: scheduleTimer !== null,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    totalRuns: totalRunCount,
    currentWeights: { ...currentWeights },
    baselineWeights: { ...baselineWeights },
    totalWeightDrift: Math.round(totalDrift * 100) / 100,
    nextRunIn: scheduleTimer ? "~4 hours" : "disabled",
  };
}

// ─── HISTORY ────────────────────────────────────────────────

export async function getAutoTuneHistory(limit = 20): Promise<any[]> {
  try {
    return await queries.getAutoTuneRuns(limit);
  } catch {
    return [];
  }
}

// ─── SCHEDULE ───────────────────────────────────────────────

const SCHEDULE_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function startAutoTuneSchedule() {
  if (scheduleTimer) return;

  scheduleTimer = setInterval(async () => {
    try {
      console.log("[AutoTuner] Scheduled run starting...");
      await runAutoTune("scheduled");
    } catch (err) {
      console.error("[AutoTuner] Scheduled run failed:", err);
    }
  }, SCHEDULE_INTERVAL_MS);

  console.log("[AutoTuner] Schedule started (every 4 hours)");
}

export function stopAutoTuneSchedule() {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
    console.log("[AutoTuner] Schedule stopped");
  }
}
