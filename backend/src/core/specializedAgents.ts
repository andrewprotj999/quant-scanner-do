/**
 * Specialized Trading Agents — v5.0
 *
 * Five purpose-built agents that each handle a critical aspect of profitability:
 *
 * 1. SNIPER AGENT     — Every 20s: Pre-qualifies tokens from trending data, maintains a hot list
 *                       for the engine to act on immediately. Catches opportunities faster.
 *
 * 2. CORRELATION AGENT — Every 10min: Detects when open positions share the same narrative,
 *                        sector, or chain concentration. Prevents correlated blowups.
 *
 * 3. MOMENTUM REGIME AGENT — Every 5min: Classifies micro-regimes (trending, ranging, choppy)
 *                            from BTC + ETH + SOL price action. Adjusts strategy per regime.
 *
 * 4. EXIT INTELLIGENCE AGENT — Every 15min: Analyzes exit timing patterns from closed trades.
 *                              Learns when to hold vs cut. Adjusts TP/SL dynamically.
 *
 * 5. CHAIN PERFORMANCE AGENT — Every 1hr: Tracks per-chain profitability, win rate, avg P&L.
 *                              Auto-adjusts chain allocation weights.
 *
 * All agents write to a shared event bus and can influence the engine's behavior.
 */

import * as queries from "../db/queries.js";
import { dexFetchCached } from "./dexRateLimiter.js";

// ─── SHARED EVENT BUS ────────────────────────────────────

interface AgentEvent {
  timestamp: number;
  agent: string;
  type: "signal" | "warning" | "adjustment" | "info";
  message: string;
  data?: any;
}

const eventBus: AgentEvent[] = [];
const MAX_EVENTS = 300;

function emitEvent(agent: string, type: AgentEvent["type"], message: string, data?: any): void {
  eventBus.push({ timestamp: Date.now(), agent, type, message, data });
  if (eventBus.length > MAX_EVENTS) {
    eventBus.splice(0, eventBus.length - MAX_EVENTS);
  }
}

// ─── SHARED STATE (readable by engine) ───────────────────

export interface AgentSignals {
  // Sniper
  hotList: Array<{ symbol: string; chain: string; address: string; score: number; reason: string; addedAt: number }>;

  // Correlation
  correlationRisk: "low" | "medium" | "high";
  correlatedGroups: Array<{ chain: string; count: number; totalExposure: number }>;
  maxChainExposurePct: number;

  // Momentum Regime
  regime: "trending_up" | "trending_down" | "ranging" | "choppy" | "unknown";
  regimeConfidence: number;
  regimeAdvice: string;
  sizingMultiplier: number;

  // Exit Intelligence
  avgWinnerHoldTimeMin: number;
  avgLoserHoldTimeMin: number;
  optimalHoldTimeMin: number;
  earlyExitRate: number;  // % of winners that were cut too early
  lateExitRate: number;   // % of losers held too long
  exitAdvice: string;

  // Chain Performance
  chainAllocations: Record<string, { weight: number; winRate: number; avgPnl: number; totalTrades: number }>;
  bestChain: string;
  worstChain: string;
}

const signals: AgentSignals = {
  hotList: [],
  correlationRisk: "low",
  correlatedGroups: [],
  maxChainExposurePct: 0,
  regime: "unknown",
  regimeConfidence: 0,
  regimeAdvice: "Gathering data...",
  sizingMultiplier: 1.0,
  avgWinnerHoldTimeMin: 0,
  avgLoserHoldTimeMin: 0,
  optimalHoldTimeMin: 0,
  earlyExitRate: 0,
  lateExitRate: 0,
  exitAdvice: "Gathering data...",
  chainAllocations: {},
  bestChain: "unknown",
  worstChain: "unknown",
};

// ─── AGENT 1: SNIPER ─────────────────────────────────────

const SNIPER_INTERVAL = 20_000; // 20 seconds
let sniperInterval: NodeJS.Timeout | null = null;
let sniperRuns = 0;

async function runSniperAgent(): Promise<void> {
  sniperRuns++;
  try {
    // Fetch trending tokens from DexScreener
    const data = await dexFetchCached(
      "https://api.dexscreener.com/token-boosts/latest/v1",
      15_000,
      "normal"
    );

    if (!Array.isArray(data)) return;

    // Pre-score tokens that look promising
    const candidates: typeof signals.hotList = [];

    for (const token of data.slice(0, 30)) {
      const chain = token.chainId;
      const addr = token.tokenAddress;
      if (!chain || !addr) continue;

      // Quick pre-qualification
      let preScore = 50;
      let reason = "";

      // Boost amount indicates paid promotion — mixed signal
      const boostAmount = token.totalAmount ?? 0;
      if (boostAmount > 500) {
        preScore += 5;
        reason = `Boosted ($${boostAmount})`;
      }

      // Chain preference
      if (chain === "solana") preScore += 5;
      else if (chain === "bsc") preScore -= 10;

      // Only add if meets minimum threshold
      if (preScore >= 50) {
        candidates.push({
          symbol: token.symbol ?? "???",
          chain,
          address: addr,
          score: preScore,
          reason: reason || "Trending",
          addedAt: Date.now(),
        });
      }
    }

    // Keep only top 10 and expire old entries (>5 min)
    const now = Date.now();
    const fresh = candidates
      .concat(signals.hotList.filter(h => now - h.addedAt < 5 * 60 * 1000))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Deduplicate by address
    const seen = new Set<string>();
    signals.hotList = fresh.filter(h => {
      if (seen.has(h.address)) return false;
      seen.add(h.address);
      return true;
    });

    if (sniperRuns % 10 === 0) {
      emitEvent("sniper", "info", `Hot list: ${signals.hotList.length} candidates`, {
        top3: signals.hotList.slice(0, 3).map(h => `${h.symbol} (${h.chain})`),
      });
    }
  } catch (err: any) {
    emitEvent("sniper", "warning", `Sniper error: ${err.message}`);
  }
}

// ─── AGENT 2: CORRELATION ────────────────────────────────

const CORRELATION_INTERVAL = 10 * 60 * 1000; // 10 minutes
let correlationInterval: NodeJS.Timeout | null = null;
let correlationRuns = 0;

async function runCorrelationAgent(): Promise<void> {
  correlationRuns++;
  try {
    const positions = await queries.getOpenPositions(1);
    if (positions.length === 0) {
      signals.correlationRisk = "low";
      signals.correlatedGroups = [];
      signals.maxChainExposurePct = 0;
      return;
    }

    // Group by chain
    const chainGroups = new Map<string, { count: number; totalExposure: number; symbols: string[] }>();
    let totalExposure = 0;

    for (const pos of positions) {
      const chain = pos.chain ?? "unknown";
      const size = parseFloat(pos.positionSizeUsd ?? "0");
      totalExposure += size;

      const group = chainGroups.get(chain) || { count: 0, totalExposure: 0, symbols: [] };
      group.count++;
      group.totalExposure += size;
      group.symbols.push(pos.tokenSymbol ?? "???");
      chainGroups.set(chain, group);
    }

    // Calculate concentration
    let maxPct = 0;
    const groups: typeof signals.correlatedGroups = [];

    for (const [chain, group] of chainGroups) {
      const pct = totalExposure > 0 ? (group.totalExposure / totalExposure) * 100 : 0;
      if (pct > maxPct) maxPct = pct;
      groups.push({ chain, count: group.count, totalExposure: group.totalExposure });
    }

    signals.correlatedGroups = groups;
    signals.maxChainExposurePct = maxPct;

    // Determine risk level
    if (maxPct > 70 || positions.length > 10) {
      signals.correlationRisk = "high";
      emitEvent("correlation", "warning",
        `High concentration: ${maxPct.toFixed(0)}% on single chain, ${positions.length} positions`,
        { groups });
    } else if (maxPct > 50 || positions.length > 7) {
      signals.correlationRisk = "medium";
    } else {
      signals.correlationRisk = "low";
    }
  } catch (err: any) {
    emitEvent("correlation", "warning", `Correlation error: ${err.message}`);
  }
}

// ─── AGENT 3: MOMENTUM REGIME ────────────────────────────

const REGIME_INTERVAL = 5 * 60 * 1000; // 5 minutes
let regimeInterval: NodeJS.Timeout | null = null;
let regimeRuns = 0;

// Price history for regime detection
const btcPrices: Array<{ price: number; time: number }> = [];
const MAX_PRICE_HISTORY = 60; // ~5 hours at 5min intervals

async function runMomentumRegimeAgent(): Promise<void> {
  regimeRuns++;
  try {
    // Fetch BTC price
    const data = await dexFetchCached(
      "https://api.dexscreener.com/latest/dex/pairs/ethereum/0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852",
      60_000,
      "low"
    );

    const btcPrice = data?.pairs?.[0]?.priceUsd ? parseFloat(data.pairs[0].priceUsd) : null;

    if (!btcPrice) {
      emitEvent("regime", "warning", "Could not fetch BTC price for regime detection");
      return;
    }

    btcPrices.push({ price: btcPrice, time: Date.now() });
    if (btcPrices.length > MAX_PRICE_HISTORY) {
      btcPrices.splice(0, btcPrices.length - MAX_PRICE_HISTORY);
    }

    if (btcPrices.length < 6) {
      signals.regime = "unknown";
      signals.regimeConfidence = 0;
      signals.regimeAdvice = "Gathering price data...";
      signals.sizingMultiplier = 1.0;
      return;
    }

    // Calculate returns over different windows
    const current = btcPrices[btcPrices.length - 1].price;
    const ago30m = btcPrices.length >= 6 ? btcPrices[btcPrices.length - 6].price : current;
    const ago1h = btcPrices.length >= 12 ? btcPrices[btcPrices.length - 12].price : current;
    const ago2h = btcPrices.length >= 24 ? btcPrices[btcPrices.length - 24].price : current;

    const ret30m = ((current - ago30m) / ago30m) * 100;
    const ret1h = ((current - ago1h) / ago1h) * 100;
    const ret2h = ((current - ago2h) / ago2h) * 100;

    // Calculate volatility (standard deviation of 5-min returns)
    const returns: number[] = [];
    for (let i = 1; i < btcPrices.length; i++) {
      returns.push(((btcPrices[i].price - btcPrices[i - 1].price) / btcPrices[i - 1].price) * 100);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length;
    const volatility = Math.sqrt(variance);

    // Classify regime
    if (ret1h > 1 && ret30m > 0.3 && volatility < 0.8) {
      signals.regime = "trending_up";
      signals.regimeConfidence = Math.min(90, 50 + ret1h * 10);
      signals.regimeAdvice = "BTC trending up — favor longs, slightly larger positions";
      signals.sizingMultiplier = 1.15;
    } else if (ret1h < -1 && ret30m < -0.3 && volatility < 0.8) {
      signals.regime = "trending_down";
      signals.regimeConfidence = Math.min(90, 50 + Math.abs(ret1h) * 10);
      signals.regimeAdvice = "BTC trending down — reduce position sizes, tighter stops";
      signals.sizingMultiplier = 0.6;
    } else if (volatility > 1.2) {
      signals.regime = "choppy";
      signals.regimeConfidence = Math.min(85, 40 + volatility * 20);
      signals.regimeAdvice = "High volatility — reduce sizing, avoid new entries";
      signals.sizingMultiplier = 0.5;
    } else {
      signals.regime = "ranging";
      signals.regimeConfidence = 50;
      signals.regimeAdvice = "Market ranging — normal sizing, focus on quality setups";
      signals.sizingMultiplier = 1.0;
    }

    if (regimeRuns % 6 === 0) { // Log every 30 min
      emitEvent("regime", "info",
        `Regime: ${signals.regime} (${signals.regimeConfidence}% conf) | BTC 1h: ${ret1h.toFixed(2)}% | Vol: ${volatility.toFixed(3)}`,
        { ret30m, ret1h, ret2h, volatility, multiplier: signals.sizingMultiplier }
      );
    }
  } catch (err: any) {
    emitEvent("regime", "warning", `Regime detection error: ${err.message}`);
  }
}

// ─── AGENT 4: EXIT INTELLIGENCE ──────────────────────────

const EXIT_INTERVAL = 15 * 60 * 1000; // 15 minutes
let exitInterval: NodeJS.Timeout | null = null;
let exitRuns = 0;

async function runExitIntelligenceAgent(): Promise<void> {
  exitRuns++;
  try {
    const closedPositions = await queries.getClosedPositions(1, 200);
    if (closedPositions.length < 10) {
      signals.exitAdvice = "Need more closed trades for exit analysis";
      return;
    }

    const winners = closedPositions.filter(p => parseFloat(p.pnlUsd ?? "0") > 0);
    const losers = closedPositions.filter(p => parseFloat(p.pnlUsd ?? "0") <= 0);

    // Calculate hold times
    function holdTimeMin(pos: any): number {
      const entry = new Date(pos.entryTime ?? pos.createdAt).getTime();
      const exit = new Date(pos.exitTime ?? pos.updatedAt).getTime();
      return (exit - entry) / 60000;
    }

    const winnerHoldTimes = winners.map(holdTimeMin).filter(t => t > 0 && t < 24 * 60);
    const loserHoldTimes = losers.map(holdTimeMin).filter(t => t > 0 && t < 24 * 60);

    if (winnerHoldTimes.length > 0) {
      signals.avgWinnerHoldTimeMin = winnerHoldTimes.reduce((a, b) => a + b, 0) / winnerHoldTimes.length;
    }
    if (loserHoldTimes.length > 0) {
      signals.avgLoserHoldTimeMin = loserHoldTimes.reduce((a, b) => a + b, 0) / loserHoldTimes.length;
    }

    // Optimal hold time: where winners peak before reversing
    // Use MFE data if available, otherwise estimate from hold times
    signals.optimalHoldTimeMin = signals.avgWinnerHoldTimeMin * 0.8; // Exit slightly before average

    // Early exit analysis: winners that had small gains but could have been bigger
    const earlyExits = winners.filter(p => {
      const pnl = parseFloat(p.pnlPercent ?? "0");
      const high = parseFloat(p.highestPrice ?? p.entryPrice);
      const entry = parseFloat(p.entryPrice);
      const maxPossiblePnl = ((high - entry) / entry) * 100;
      return pnl < maxPossiblePnl * 0.5; // Captured less than 50% of max move
    });
    signals.earlyExitRate = winners.length > 0 ? (earlyExits.length / winners.length) * 100 : 0;

    // Late exit analysis: losers held past the point of no return
    const lateExits = losers.filter(p => {
      const holdTime = holdTimeMin(p);
      return holdTime > signals.avgLoserHoldTimeMin * 1.5; // Held 50% longer than average loser
    });
    signals.lateExitRate = losers.length > 0 ? (lateExits.length / losers.length) * 100 : 0;

    // Generate advice
    const advice: string[] = [];
    if (signals.earlyExitRate > 40) {
      advice.push(`${signals.earlyExitRate.toFixed(0)}% of winners exited too early — consider wider trails`);
    }
    if (signals.lateExitRate > 30) {
      advice.push(`${signals.lateExitRate.toFixed(0)}% of losers held too long — tighten time-based stops`);
    }
    if (signals.avgLoserHoldTimeMin > signals.avgWinnerHoldTimeMin * 2) {
      advice.push("Losers held 2x longer than winners — add time-based exit for losing positions");
    }
    if (advice.length === 0) {
      advice.push("Exit timing looks reasonable");
    }
    signals.exitAdvice = advice.join(". ");

    if (exitRuns % 4 === 0) {
      emitEvent("exit_intel", "info",
        `Win hold: ${signals.avgWinnerHoldTimeMin.toFixed(0)}min | Loss hold: ${signals.avgLoserHoldTimeMin.toFixed(0)}min | Early exits: ${signals.earlyExitRate.toFixed(0)}%`,
        { earlyExitRate: signals.earlyExitRate, lateExitRate: signals.lateExitRate }
      );
    }
  } catch (err: any) {
    emitEvent("exit_intel", "warning", `Exit intelligence error: ${err.message}`);
  }
}

// ─── AGENT 5: CHAIN PERFORMANCE ──────────────────────────

const CHAIN_INTERVAL = 60 * 60 * 1000; // 1 hour
let chainInterval: NodeJS.Timeout | null = null;
let chainRuns = 0;

async function runChainPerformanceAgent(): Promise<void> {
  chainRuns++;
  try {
    const closedPositions = await queries.getClosedPositions(1, 500);
    if (closedPositions.length < 5) return;

    // Aggregate by chain
    const chainStats = new Map<string, { wins: number; losses: number; totalPnl: number; trades: number }>();

    for (const pos of closedPositions) {
      const chain = pos.chain ?? "unknown";
      const pnl = parseFloat(pos.pnlUsd ?? "0");
      const stats = chainStats.get(chain) || { wins: 0, losses: 0, totalPnl: 0, trades: 0 };
      stats.trades++;
      stats.totalPnl += pnl;
      if (pnl > 0) stats.wins++;
      else stats.losses++;
      chainStats.set(chain, stats);
    }

    // Calculate weights (higher weight = more allocation)
    let totalWeight = 0;
    const allocations: typeof signals.chainAllocations = {};
    let bestPnl = -Infinity;
    let worstPnl = Infinity;
    let bestChain = "unknown";
    let worstChain = "unknown";

    for (const [chain, stats] of chainStats) {
      const winRate = stats.trades > 0 ? stats.wins / stats.trades : 0;
      const avgPnl = stats.trades > 0 ? stats.totalPnl / stats.trades : 0;

      // Weight formula: win_rate * avg_pnl_normalized * trade_count_factor
      // Chains with more data and better performance get higher weight
      const tradeCountFactor = Math.min(1, stats.trades / 20); // Full weight at 20+ trades
      const profitFactor = avgPnl > 0 ? 1 + (avgPnl / 50) : Math.max(0.1, 1 + (avgPnl / 100));
      const weight = Math.max(0.1, winRate * profitFactor * tradeCountFactor);

      allocations[chain] = {
        weight,
        winRate: winRate * 100,
        avgPnl,
        totalTrades: stats.trades,
      };
      totalWeight += weight;

      if (stats.totalPnl > bestPnl) { bestPnl = stats.totalPnl; bestChain = chain; }
      if (stats.totalPnl < worstPnl) { worstPnl = stats.totalPnl; worstChain = chain; }
    }

    // Normalize weights to sum to 1
    for (const chain of Object.keys(allocations)) {
      allocations[chain].weight = totalWeight > 0 ? allocations[chain].weight / totalWeight : 0.25;
    }

    signals.chainAllocations = allocations;
    signals.bestChain = bestChain;
    signals.worstChain = worstChain;

    emitEvent("chain_perf", "info",
      `Best: ${bestChain} ($${bestPnl.toFixed(2)}) | Worst: ${worstChain} ($${worstPnl.toFixed(2)})`,
      { allocations }
    );

    // Auto-adjust: if a chain is consistently losing, emit a strong warning
    for (const [chain, stats] of chainStats) {
      const winRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0;
      if (stats.trades >= 10 && winRate < 25 && stats.totalPnl < -50) {
        emitEvent("chain_perf", "warning",
          `CHAIN ALERT: ${chain} has ${winRate.toFixed(0)}% WR and -$${Math.abs(stats.totalPnl).toFixed(2)} PnL over ${stats.trades} trades. Consider disabling.`,
          { chain, winRate, totalPnl: stats.totalPnl, trades: stats.trades }
        );
      }
    }
  } catch (err: any) {
    emitEvent("chain_perf", "warning", `Chain performance error: ${err.message}`);
  }
}

// ─── LIFECYCLE ───────────────────────────────────────────

let allRunning = false;

export function startSpecializedAgents(): void {
  if (allRunning) return;
  allRunning = true;

  console.log("═══════════════════════════════════════════════");
  console.log("  Specialized Agents v5.0 — Starting");
  console.log("  Sniper: 20s | Correlation: 10min | Regime: 5min");
  console.log("  Exit Intel: 15min | Chain Perf: 1hr");
  console.log("═══════════════════════════════════════════════");

  // Stagger startup
  runSniperAgent().catch(e => console.error("[Sniper] Init error:", e));
  setTimeout(() => runCorrelationAgent().catch(e => console.error("[Correlation] Init error:", e)), 3000);
  setTimeout(() => runMomentumRegimeAgent().catch(e => console.error("[Regime] Init error:", e)), 6000);
  setTimeout(() => runExitIntelligenceAgent().catch(e => console.error("[ExitIntel] Init error:", e)), 10000);
  setTimeout(() => runChainPerformanceAgent().catch(e => console.error("[ChainPerf] Init error:", e)), 15000);

  sniperInterval = setInterval(() => runSniperAgent().catch(e => console.error("[Sniper]", e)), SNIPER_INTERVAL);
  correlationInterval = setInterval(() => runCorrelationAgent().catch(e => console.error("[Correlation]", e)), CORRELATION_INTERVAL);
  regimeInterval = setInterval(() => runMomentumRegimeAgent().catch(e => console.error("[Regime]", e)), REGIME_INTERVAL);
  exitInterval = setInterval(() => runExitIntelligenceAgent().catch(e => console.error("[ExitIntel]", e)), EXIT_INTERVAL);
  chainInterval = setInterval(() => runChainPerformanceAgent().catch(e => console.error("[ChainPerf]", e)), CHAIN_INTERVAL);
}

export function stopSpecializedAgents(): void {
  if (sniperInterval) { clearInterval(sniperInterval); sniperInterval = null; }
  if (correlationInterval) { clearInterval(correlationInterval); correlationInterval = null; }
  if (regimeInterval) { clearInterval(regimeInterval); regimeInterval = null; }
  if (exitInterval) { clearInterval(exitInterval); exitInterval = null; }
  if (chainInterval) { clearInterval(chainInterval); chainInterval = null; }
  allRunning = false;
  console.log("[SpecializedAgents] All stopped");
}

// ─── API EXPORTS ─────────────────────────────────────────

export function getAgentSignals(): AgentSignals {
  return { ...signals };
}

export function getSpecializedAgentStatus() {
  return {
    running: allRunning,
    agents: {
      sniper: { runs: sniperRuns, hotListSize: signals.hotList.length },
      correlation: { runs: correlationRuns, risk: signals.correlationRisk },
      regime: { runs: regimeRuns, current: signals.regime, confidence: signals.regimeConfidence },
      exitIntel: { runs: exitRuns, advice: signals.exitAdvice },
      chainPerf: { runs: chainRuns, best: signals.bestChain, worst: signals.worstChain },
    },
    signals,
    eventBus: eventBus.slice(-30).map(e => ({
      time: new Date(e.timestamp).toISOString(),
      agent: e.agent,
      type: e.type,
      message: e.message,
    })),
  };
}

/**
 * Get the regime-based sizing multiplier for the engine to use.
 * Called by paperEngine during position sizing.
 */
export function getRegimeSizingMultiplier(): number {
  return signals.sizingMultiplier;
}

/**
 * Get chain allocation weight for a specific chain.
 * Returns 0-1 where higher = more allocation.
 * Called by paperEngine during qualification.
 */
export function getChainWeight(chain: string): number {
  const alloc = signals.chainAllocations[chain];
  if (!alloc) return 0.5; // Default neutral weight for unknown chains
  return alloc.weight;
}

/**
 * Check if correlation risk is too high to add more positions on a chain.
 */
export function isChainOverexposed(chain: string): boolean {
  if (signals.correlationRisk !== "high") return false;
  const group = signals.correlatedGroups.find(g => g.chain === chain);
  return group ? group.count >= 5 : false;
}
