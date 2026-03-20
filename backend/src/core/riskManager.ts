/**
 * Risk Manager — Expert-Level Risk Controls
 *
 * Layered risk management system that operates at trade, session, and portfolio levels:
 *
 * 1. EQUITY CURVE TRADING — Tiered circuit breakers that automatically reduce
 *    position sizes during drawdowns and scale up during winning streaks.
 *
 * 2. KELLY CRITERION POSITION SIZING — Mathematically optimal sizing using
 *    rolling win rate and reward/risk ratio (half-Kelly for safety).
 *
 * 3. MARKET REGIME DETECTION — BTC macro filter that adjusts aggression
 *    based on overall crypto market conditions (bull/bear/neutral).
 *
 * 4. CORRELATION / CONCENTRATION LIMITS — Max exposure per chain,
 *    portfolio heat cap, and sector diversification enforcement.
 *
 * 5. DAILY P&L RESET — Automatic daily P&L tracking with timezone-aware reset.
 *
 * All functions are pure or read-only against DB — the paperEngine calls them
 * to get sizing multipliers and go/no-go signals before entering positions.
 */

import { dexFetchCached } from "./dexRateLimiter.js";
import * as queries from "../db/queries.js";

// ─── TYPES ──────────────────────────────────────────────────

export type RiskLevel = "normal" | "reduced" | "cautious" | "halted";

export type MarketRegime = "bull" | "neutral" | "bear" | "crisis";

export interface RiskAssessment {
  riskLevel: RiskLevel;
  positionSizeMultiplier: number; // 0.0 to 1.5
  maxNewPositions: number;
  regime: MarketRegime;
  drawdownPercent: number;
  dailyPnlPercent: number;
  portfolioHeatPercent: number;
  chainExposure: Map<string, number>;
  reasons: string[];
  kellyFraction: number;
  consecutiveLosses: number;
}

export interface KellyResult {
  kellyFraction: number; // Raw Kelly %
  halfKelly: number; // Conservative half-Kelly %
  quarterKelly: number; // Ultra-conservative quarter-Kelly %
  winRate: number;
  avgWinPercent: number;
  avgLossPercent: number;
  sampleSize: number;
  confidence: "high" | "medium" | "low";
}

// ─── CONSTANTS ──────────────────────────────────────────────

const DRAWDOWN_TIERS = [
  { threshold: 5, level: "reduced" as RiskLevel, multiplier: 0.5, maxNew: 3 },
  { threshold: 10, level: "cautious" as RiskLevel, multiplier: 0.25, maxNew: 1 },
  { threshold: 15, level: "halted" as RiskLevel, multiplier: 0, maxNew: 0 },
];

const MAX_CHAIN_EXPOSURE_PCT = 40; // No more than 40% of equity on one chain
const MAX_PORTFOLIO_HEAT_PCT = 8; // Total open risk as % of equity
const MAX_DAILY_LOSS_PCT = 5; // Halt after 5% daily loss
const MAX_CONSECUTIVE_LOSSES = 5; // Reduce after 5 consecutive losses
const WINNING_STREAK_BONUS = 3; // Scale up after 3 consecutive wins (future)
const MIN_KELLY_SAMPLE = 10; // Minimum trades for Kelly calculation

// BTC regime detection thresholds
const BTC_BEAR_CHANGE_24H = -5; // BTC down >5% in 24h = bear
const BTC_CRISIS_CHANGE_24H = -10; // BTC down >10% in 24h = crisis
const BTC_BULL_CHANGE_24H = 3; // BTC up >3% in 24h = bull

// ─── STATE ──────────────────────────────────────────────────

let cachedRegime: { regime: MarketRegime; btcChange24h: number; fetchedAt: number } | null = null;
const REGIME_CACHE_MS = 5 * 60 * 1000; // Cache regime for 5 minutes

// ─── KELLY CRITERION ────────────────────────────────────────

/**
 * Calculate Kelly Criterion position sizing based on recent trade history.
 * Uses half-Kelly by default for safety in volatile crypto markets.
 *
 * Kelly% = W - [(1-W) / R]
 * Where W = win rate, R = avg win / avg loss ratio
 */
export async function calculateKelly(userId: number, lookback = 50): Promise<KellyResult> {
  const closedPositions = await queries.getClosedPositions(userId, lookback);

  if (closedPositions.length < MIN_KELLY_SAMPLE) {
    return {
      kellyFraction: 0,
      halfKelly: 0,
      quarterKelly: 0,
      winRate: 0,
      avgWinPercent: 0,
      avgLossPercent: 0,
      sampleSize: closedPositions.length,
      confidence: "low",
    };
  }

  const wins: number[] = [];
  const losses: number[] = [];

  for (const pos of closedPositions) {
    const pnl = parseFloat(pos.pnlPercent ?? "0");
    if (pnl >= 0) wins.push(pnl);
    else losses.push(Math.abs(pnl));
  }

  const winRate = wins.length / closedPositions.length;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 1;

  // Kelly formula
  const R = avgLoss > 0 ? avgWin / avgLoss : 0;
  let kellyFraction = R > 0 ? winRate - (1 - winRate) / R : 0;

  // Clamp Kelly between 0 and 25% (never risk more than 25% of equity)
  kellyFraction = Math.max(0, Math.min(0.25, kellyFraction));

  const confidence: "high" | "medium" | "low" =
    closedPositions.length >= 50 ? "high" :
    closedPositions.length >= 20 ? "medium" : "low";

  return {
    kellyFraction,
    halfKelly: kellyFraction * 0.5,
    quarterKelly: kellyFraction * 0.25,
    winRate,
    avgWinPercent: avgWin,
    avgLossPercent: avgLoss,
    sampleSize: closedPositions.length,
    confidence,
  };
}

// ─── MARKET REGIME DETECTION ────────────────────────────────

/**
 * Detect current market regime by checking BTC price action.
 * Memecoin performance correlates heavily with BTC sentiment.
 */
export async function detectMarketRegime(): Promise<{ regime: MarketRegime; btcChange24h: number }> {
  // Return cached if fresh
  if (cachedRegime && Date.now() - cachedRegime.fetchedAt < REGIME_CACHE_MS) {
    return { regime: cachedRegime.regime, btcChange24h: cachedRegime.btcChange24h };
  }

  try {
    // Use DexScreener to check BTC/USDT on major DEXes
    const data = await dexFetchCached(
      "https://api.dexscreener.com/latest/dex/search?q=BTC%20USDT",
      60_000, // 1 minute cache for BTC regime check
      "low"
    );

    const pairs = data?.pairs || [];
    // Find a high-liquidity BTC pair
    const btcPair = pairs.find((p: any) =>
      p.baseToken?.symbol === "WBTC" || p.baseToken?.symbol === "BTC"
    );

    let change24h = 0;
    if (btcPair?.priceChange?.h24 !== undefined) {
      change24h = btcPair.priceChange.h24;
    }

    let regime: MarketRegime;
    if (change24h <= BTC_CRISIS_CHANGE_24H) {
      regime = "crisis";
    } else if (change24h <= BTC_BEAR_CHANGE_24H) {
      regime = "bear";
    } else if (change24h >= BTC_BULL_CHANGE_24H) {
      regime = "bull";
    } else {
      regime = "neutral";
    }

    cachedRegime = { regime, btcChange24h: change24h, fetchedAt: Date.now() };
    return { regime, btcChange24h: change24h };
  } catch {
    // Default to neutral if we can't fetch BTC data
    return { regime: "neutral", btcChange24h: 0 };
  }
}

/**
 * Get position size multiplier based on market regime.
 */
function getRegimeMultiplier(regime: MarketRegime): number {
  switch (regime) {
    case "bull": return 1.2; // Slightly more aggressive in bull
    case "neutral": return 1.0;
    case "bear": return 0.5; // Half size in bear
    case "crisis": return 0.0; // No new positions in crisis
  }
}

// ─── EQUITY CURVE TRADING ───────────────────────────────────

/**
 * Calculate drawdown-based risk level using tiered circuit breakers.
 * Graduated response: reduce → cautious → halt.
 */
function getDrawdownRiskLevel(
  equity: number,
  peakEquity: number
): { level: RiskLevel; multiplier: number; maxNew: number; drawdownPct: number } {
  const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;

  // Check tiers from most severe to least
  for (let i = DRAWDOWN_TIERS.length - 1; i >= 0; i--) {
    if (drawdownPct >= DRAWDOWN_TIERS[i].threshold) {
      return {
        level: DRAWDOWN_TIERS[i].level,
        multiplier: DRAWDOWN_TIERS[i].multiplier,
        maxNew: DRAWDOWN_TIERS[i].maxNew,
        drawdownPct,
      };
    }
  }

  return { level: "normal", multiplier: 1.0, maxNew: 20, drawdownPct };
}

// ─── CORRELATION / CONCENTRATION LIMITS ─────────────────────

/**
 * Calculate chain exposure and portfolio heat from open positions.
 */
function calculatePortfolioMetrics(
  openPositions: any[],
  equity: number
): {
  chainExposure: Map<string, number>;
  portfolioHeatPct: number;
  chainExposurePcts: Map<string, number>;
} {
  const chainExposure = new Map<string, number>();
  let totalExposure = 0;

  for (const pos of openPositions) {
    const posSize = parseFloat(pos.positionSizeUsd ?? "0");
    const chain = pos.chain ?? "unknown";
    chainExposure.set(chain, (chainExposure.get(chain) ?? 0) + posSize);
    totalExposure += posSize;
  }

  const portfolioHeatPct = equity > 0 ? (totalExposure / equity) * 100 : 0;

  const chainExposurePcts = new Map<string, number>();
  for (const [chain, exposure] of chainExposure) {
    chainExposurePcts.set(chain, equity > 0 ? (exposure / equity) * 100 : 0);
  }

  return { chainExposure, portfolioHeatPct, chainExposurePcts };
}

/**
 * Check if a new position on a given chain would violate concentration limits.
 */
export function canEnterChain(
  chain: string,
  proposedSizeUsd: number,
  openPositions: any[],
  equity: number
): { allowed: boolean; reason?: string } {
  const { chainExposurePcts, portfolioHeatPct } = calculatePortfolioMetrics(openPositions, equity);

  // Check portfolio heat
  const newHeat = portfolioHeatPct + (equity > 0 ? (proposedSizeUsd / equity) * 100 : 0);
  if (newHeat > MAX_PORTFOLIO_HEAT_PCT) {
    return {
      allowed: false,
      reason: `Portfolio heat would be ${newHeat.toFixed(1)}% (max ${MAX_PORTFOLIO_HEAT_PCT}%)`,
    };
  }

  // Check chain concentration
  const currentChainPct = chainExposurePcts.get(chain) ?? 0;
  const newChainPct = currentChainPct + (equity > 0 ? (proposedSizeUsd / equity) * 100 : 0);
  if (newChainPct > MAX_CHAIN_EXPOSURE_PCT) {
    return {
      allowed: false,
      reason: `${chain} exposure would be ${newChainPct.toFixed(1)}% (max ${MAX_CHAIN_EXPOSURE_PCT}%)`,
    };
  }

  return { allowed: true };
}

// ─── CONSECUTIVE LOSS MANAGEMENT ────────────────────────────

/**
 * Get position size multiplier based on consecutive losses.
 * Reduces sizing after losing streaks to protect capital.
 */
function getConsecutiveLossMultiplier(consecutiveLosses: number): number {
  if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) return 0.25;
  if (consecutiveLosses >= 4) return 0.5;
  if (consecutiveLosses >= 3) return 0.75;
  return 1.0;
}

// ─── DAILY P&L MANAGEMENT ───────────────────────────────────

/**
 * Check if daily loss limit has been breached.
 */
function isDailyLossBreached(dailyPnlUsd: number, equity: number): boolean {
  if (equity <= 0) return true;
  const dailyLossPct = (Math.abs(dailyPnlUsd) / equity) * 100;
  return dailyPnlUsd < 0 && dailyLossPct >= MAX_DAILY_LOSS_PCT;
}

// ─── MASTER RISK ASSESSMENT ─────────────────────────────────

/**
 * Comprehensive risk assessment combining all layers.
 * Call this before every new position entry to get the go/no-go signal
 * and position size multiplier.
 */
export async function assessRisk(userId: number): Promise<RiskAssessment> {
  const reasons: string[] = [];

  // 1. Get engine state
  const state = await queries.getEngineState(userId);
  const equity = parseFloat(state?.equity ?? "1000");
  const peakEquity = parseFloat(state?.peakEquity ?? "1000");
  const dailyPnlUsd = parseFloat(state?.dailyPnlUsd ?? "0");
  const consecutiveLosses = state?.consecutiveLosses ?? 0;

  // 2. Get open positions
  const openPositions = await queries.getOpenPositions(userId);

  // 3. Equity curve / drawdown assessment
  const dd = getDrawdownRiskLevel(equity, peakEquity);
  let multiplier = dd.multiplier;
  let maxNew = dd.maxNew;
  if (dd.level !== "normal") {
    reasons.push(`Drawdown ${dd.drawdownPct.toFixed(1)}% → ${dd.level} mode (${(dd.multiplier * 100).toFixed(0)}% size)`);
  }

  // 4. Market regime
  const { regime, btcChange24h } = await detectMarketRegime();
  const regimeMultiplier = getRegimeMultiplier(regime);
  multiplier *= regimeMultiplier;
  if (regime !== "neutral") {
    reasons.push(`Market regime: ${regime} (BTC ${btcChange24h >= 0 ? "+" : ""}${btcChange24h.toFixed(1)}%) → ${(regimeMultiplier * 100).toFixed(0)}% size`);
  }

  // 5. Consecutive loss adjustment
  const lossMultiplier = getConsecutiveLossMultiplier(consecutiveLosses);
  multiplier *= lossMultiplier;
  if (lossMultiplier < 1) {
    reasons.push(`${consecutiveLosses} consecutive losses → ${(lossMultiplier * 100).toFixed(0)}% size`);
  }

  // 6. Daily P&L check
  const dailyPnlPct = equity > 0 ? (dailyPnlUsd / equity) * 100 : 0;
  if (isDailyLossBreached(dailyPnlUsd, equity)) {
    multiplier = 0;
    maxNew = 0;
    reasons.push(`Daily loss limit breached: ${dailyPnlPct.toFixed(1)}% (max -${MAX_DAILY_LOSS_PCT}%)`);
  }

  // 7. Portfolio metrics
  const { portfolioHeatPct, chainExposure } = calculatePortfolioMetrics(openPositions, equity);
  if (portfolioHeatPct > MAX_PORTFOLIO_HEAT_PCT * 0.8) {
    reasons.push(`Portfolio heat high: ${portfolioHeatPct.toFixed(1)}% (limit ${MAX_PORTFOLIO_HEAT_PCT}%)`);
    if (portfolioHeatPct >= MAX_PORTFOLIO_HEAT_PCT) {
      maxNew = 0;
      reasons.push(`Portfolio heat at limit — no new positions`);
    }
  }

  // 8. Kelly criterion
  const kelly = await calculateKelly(userId);
  if (kelly.confidence !== "low" && kelly.halfKelly > 0) {
    reasons.push(`Kelly: ${(kelly.halfKelly * 100).toFixed(1)}% (WR: ${(kelly.winRate * 100).toFixed(0)}%, R: ${kelly.avgWinPercent > 0 && kelly.avgLossPercent > 0 ? (kelly.avgWinPercent / kelly.avgLossPercent).toFixed(2) : "N/A"})`);
  }

  // Determine final risk level
  let riskLevel: RiskLevel;
  if (multiplier <= 0) {
    riskLevel = "halted";
  } else if (multiplier <= 0.25) {
    riskLevel = "cautious";
  } else if (multiplier < 1.0) {
    riskLevel = "reduced";
  } else {
    riskLevel = "normal";
  }

  // Cap multiplier at 1.5 (bull regime can boost slightly)
  multiplier = Math.max(0, Math.min(1.5, multiplier));

  return {
    riskLevel,
    positionSizeMultiplier: multiplier,
    maxNewPositions: maxNew,
    regime,
    drawdownPercent: dd.drawdownPct,
    dailyPnlPercent: dailyPnlPct,
    portfolioHeatPercent: portfolioHeatPct,
    chainExposure,
    reasons,
    kellyFraction: kelly.halfKelly,
    consecutiveLosses,
  };
}

// ─── KELLY-ADJUSTED POSITION SIZE ───────────────────────────

/**
 * Calculate position size using Kelly Criterion when sufficient data exists,
 * falling back to the existing conviction-based sizing otherwise.
 *
 * Returns a multiplier (0.0 to 1.0) to apply on top of the base position size.
 */
export async function getKellyMultiplier(userId: number): Promise<number> {
  const kelly = await calculateKelly(userId);

  // Not enough data — use default sizing
  if (kelly.confidence === "low") return 1.0;

  // Negative Kelly = negative edge, reduce dramatically
  if (kelly.kellyFraction <= 0) return 0.25;

  // Use half-Kelly as the multiplier, scaled relative to a "normal" 2% risk
  // If half-Kelly says 1.5%, and our normal risk is 2%, multiplier = 0.75
  const normalRisk = 0.02; // 2% base risk
  const kellyMultiplier = kelly.halfKelly / normalRisk;

  // Clamp between 0.25 and 1.5
  return Math.max(0.25, Math.min(1.5, kellyMultiplier));
}

// ─── DAILY RESET CHECK ──────────────────────────────────────

/**
 * Check if daily P&L should be reset (new UTC day).
 * Call this at the start of each engine cycle.
 */
export async function checkDailyReset(userId: number): Promise<boolean> {
  const state = await queries.getEngineState(userId);
  if (!state) return false;

  const lastReset = state.dailyPnlResetAt ? new Date(state.dailyPnlResetAt).getTime() : 0;
  const now = Date.now();
  const lastResetDay = new Date(lastReset).toISOString().slice(0, 10);
  const todayDay = new Date(now).toISOString().slice(0, 10);

  if (lastResetDay !== todayDay) {
    await queries.upsertEngineState(userId, {
      dailyPnlUsd: "0",
      dailyPnlResetAt: new Date(),
    } as any);
    console.log(`[RiskManager] Daily P&L reset for new day: ${todayDay}`);
    return true;
  }

  return false;
}

// ─── EXPORTS FOR MONITORING ─────────────────────────────────

export function getRiskConstants() {
  return {
    drawdownTiers: DRAWDOWN_TIERS,
    maxChainExposurePct: MAX_CHAIN_EXPOSURE_PCT,
    maxPortfolioHeatPct: MAX_PORTFOLIO_HEAT_PCT,
    maxDailyLossPct: MAX_DAILY_LOSS_PCT,
    maxConsecutiveLosses: MAX_CONSECUTIVE_LOSSES,
    minKellySample: MIN_KELLY_SAMPLE,
    btcBearThreshold: BTC_BEAR_CHANGE_24H,
    btcCrisisThreshold: BTC_CRISIS_CHANGE_24H,
    btcBullThreshold: BTC_BULL_CHANGE_24H,
  };
}
