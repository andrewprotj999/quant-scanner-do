/**
 * Paper Trading Engine — Standalone Version (v6)
 *
 * Autonomous scanner + executor running on an adaptive interval.
 * Each cycle:
 * 1. System health check + kill switch validation
 * 2. Equity curve MA analysis → trading mode
 * 3. Time-of-day optimization → size multiplier + conviction adjustment
 * 4. Fetches trending/boosted tokens from DexScreener (all chains)
 * 5. Data feed validation → quality check before processing
 * 6. ★ 14-LAYER SIGNAL PIPELINE (ported from Manus engine) ★
 *    - Hard/soft filters, persistence, tradeability, momentum
 *    - Multi-factor scoring, entry quality, scam defense
 *    - 11-dimension conviction model, behavior protection
 *    - Portfolio risk, exit planning, profiles
 * 7. Multi-source price validation before entry
 * 8. Volatility-adjusted + slippage-aware position sizing
 * 9. Execution abstraction layer (paper now, live-ready)
 * 10. 4-tier profit-taking + adaptive trailing stop with MAE tracking
 * 11. Logs everything and sends Telegram notifications
 *
 * Zero Manus dependencies. Uses SQLite + Telegram.
 *
 * v2: Rate limiter, 4-tier profit-taking, social+whale scoring
 * v3: Risk manager, Kelly criterion, BTC regime detection
 * v4: MAE, volatility sizing, price validation, time opt, slippage,
 *     holder analysis, equity curve MA, system guards, execution layer
 * v5: Specialized agents (sniper, correlation, momentum regime, exit intel, chain perf)
 * v6: Complete 14-layer signal pipeline from Manus engine — replaces old qualifyToken
 */

import { CONFIG } from "../config.js";
import { getDb } from "../db/index.js";
import * as queries from "../db/queries.js";
import { notifyOwner } from "../services/notify.js";
import {
  acquireCycleLock,
  releaseCycleLock,
  recordCycle,
  recordApiCall,
  withDbRetry,
  setSelfHealCallback,
} from "./healthMonitor.js";
import { dexFetch, dexFetchCached, getDexRateLimiterMetrics } from "./dexRateLimiter.js";
import {
  assessRisk,
  canEnterChain,
  getKellyMultiplier,
  checkDailyReset,
  type RiskAssessment,
} from "./riskManager.js";
import { recordMAE, getOptimalStopLoss } from "./maeAnalysis.js";
import { getVolatilityMultiplier } from "./volatilitySizer.js";
import { fullPriceValidation } from "./priceValidator.js";
import { getTimeOptimization } from "./timeOptimizer.js";
import { estimateSlippage, adjustPositionForSlippage } from "./slippageEstimator.js";
import { analyzeEquityCurve } from "./equityCurveMA.js";
import {
  checkSystemHealth,
  recordSuccess,
  recordFailure,
  validateDataFeed,
  detectVolatilityLevel,
  getAdaptiveScanInterval,
} from "./systemGuards.js";
import { executeOrder, executePartialExit, type OrderResult } from "./executionLayer.js";
import {
  runSignalPipeline,
  selectForEntry,
  calculatePositionSize as pipelineCalcSize,
  setLastPipelineResult,
  recordEntryOutcome,
  setTokenCooldown,
  type EnrichedSignal,
  type PipelineResult,
  type PortfolioContext,
} from "./signalPipeline.js";

// ─── DYNAMIC PARAMS (loaded from DB, refreshed each cycle) ──

let dynamicParams = {
  // v6 defaults — signal pipeline handles conviction scoring
  // These params now only affect position management (not entry qualification)
  trailPreTp1: 10,
  trailPostTp1: 7,
  trailBigWin: 5,
  stopLossPercent: 7,      // MAE-optimized default
  tp1Percent: 18,
  breakEvenThreshold: 10,
  minRiskPercent: 0.8,
  maxRiskPercent: 2.0,
  maxPosPctLow: 2.5,
  maxPosPctHigh: 5,
  circuitBreakerPct: 35,
  rugLiqFdvMax: 5,
  volDryUpThreshold: 0.03,
  // 4-tier profit-taking params
  tpEarlyPercent: 8,
  tpEarlySellRatio: 0.30,
  tp1SellRatio: 0.25,
  tp2Percent: 30,
  tp2SellRatio: 0.25,
  trailInitial: 8,
  trailGainIncrement: 4,
  trailMinPercent: 3,
  earlyProfitLockPercent: 1.5,
};

export function getDynamicParams() {
  return { ...dynamicParams };
}

async function refreshDynamicParams(): Promise<void> {
  try {
    const dbParams = await queries.getEngineParams();
    if (dbParams) {
      dynamicParams = {
        trailPreTp1: parseFloat(String(dbParams.trailPreTp1 ?? "10")),
        trailPostTp1: parseFloat(String(dbParams.trailPostTp1 ?? "7")),
        trailBigWin: parseFloat(String(dbParams.trailBigWin ?? "5")),
        stopLossPercent: parseFloat(String(dbParams.stopLossPercent ?? "7")),
        tp1Percent: parseFloat(String(dbParams.tp1Percent ?? "18")),
        breakEvenThreshold: parseFloat(String(dbParams.breakEvenThreshold ?? "10")),
        minRiskPercent: parseFloat(String(dbParams.minRiskPercent ?? "0.8")),
        maxRiskPercent: parseFloat(String(dbParams.maxRiskPercent ?? "2.0")),
        maxPosPctLow: parseFloat(String(dbParams.maxPosPctLow ?? "2.5")),
        maxPosPctHigh: parseFloat(String(dbParams.maxPosPctHigh ?? "5")),
        circuitBreakerPct: parseFloat(String(dbParams.circuitBreakerPct ?? "35")),
        rugLiqFdvMax: parseFloat(String(dbParams.rugLiqFdvMax ?? "5")),
        volDryUpThreshold: parseFloat(String(dbParams.volDryUpThreshold ?? "0.03")),
        tpEarlyPercent: parseFloat(String(dbParams.tpEarlyPercent ?? "8")),
        tpEarlySellRatio: parseFloat(String(dbParams.tpEarlySellRatio ?? "0.30")),
        tp1SellRatio: parseFloat(String(dbParams.tp1SellRatio ?? "0.25")),
        tp2Percent: parseFloat(String(dbParams.tp2Percent ?? "30")),
        tp2SellRatio: parseFloat(String(dbParams.tp2SellRatio ?? "0.25")),
        trailInitial: parseFloat(String(dbParams.trailInitial ?? "8")),
        trailGainIncrement: parseFloat(String(dbParams.trailGainIncrement ?? "4")),
        trailMinPercent: parseFloat(String(dbParams.trailMinPercent ?? "3")),
        earlyProfitLockPercent: parseFloat(String(dbParams.earlyProfitLockPercent ?? "1.5")),
      };
    }
  } catch { /* use defaults */ }
}

// ─── DEX API ────────────────────────────────────────────────

const DEX_API = "https://api.dexscreener.com";

// Cache scan data so position monitor can reuse without extra API calls
const lastScanPairMap = new Map<string, DexPair>();

interface DexPair {
  pairAddress: string;
  chainId: string;
  dexId: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string; name: string };
  priceUsd: string;
  priceNative: string;
  volume: { m5: number; h1: number; h6: number; h24: number };
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number;
  marketCap: number;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  pairCreatedAt?: number;
  url?: string;
  info?: {
    imageUrl?: string;
    websites?: Array<{ url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
}

async function fetchAllTokenSources(): Promise<DexPair[]> {
  const allPairs: DexPair[] = [];
  const seen = new Set<string>();

  const endpoints = [
    `${DEX_API}/token-boosts/latest/v1`,
    `${DEX_API}/token-profiles/latest/v1`,
  ];

  for (const url of endpoints) {
    try {
      const data = await dexFetchCached(url, 25_000, "normal");
      const items = Array.isArray(data) ? data : [];

      for (const item of items) {
        const chain = item.chainId;
        const addr = item.tokenAddress;
        if (!chain || !addr) continue;
        const key = `${chain}:${addr}`;
        if (seen.has(key)) continue;
        seen.add(key);

        try {
          const pairData = await dexFetchCached(
            `${DEX_API}/latest/dex/tokens/${addr}`,
            30_000,
            "normal"
          );
          const pairs = pairData?.pairs || [];
          if (pairs.length > 0) {
            const best = pairs.sort(
              (a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
            )[0];
            if (!seen.has(best.pairAddress)) {
              seen.add(best.pairAddress);
              allPairs.push(best);
              lastScanPairMap.set(best.pairAddress, best);
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip source */ }
  }

  // Also fetch trending
  try {
    const trending = await dexFetchCached(
      `${DEX_API}/token-boosts/top/v1`,
      30_000,
      "normal"
    );
    const items = Array.isArray(trending) ? trending : [];
    for (const item of items.slice(0, 20)) {
      const chain = item.chainId;
      const addr = item.tokenAddress;
      if (!chain || !addr) continue;
      const key = `${chain}:${addr}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const pairData = await dexFetchCached(
          `${DEX_API}/latest/dex/tokens/${addr}`,
          30_000,
          "normal"
        );
        const pairs = pairData?.pairs || [];
        if (pairs.length > 0) {
          const best = pairs.sort(
            (a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
          )[0];
          if (!seen.has(best.pairAddress)) {
            seen.add(best.pairAddress);
            allPairs.push(best);
            lastScanPairMap.set(best.pairAddress, best);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return allPairs;
}

// ─── PRICE FETCHER (for position monitoring) ────────────────

export async function fetchPairPrice(pairAddress: string, chainId?: string): Promise<DexPair | null> {
  // First check scan data cache (avoids extra API call)
  const cached = lastScanPairMap.get(pairAddress);
  if (cached) return cached;

  try {
    if (chainId) {
      const data = await dexFetchCached(
        `${DEX_API}/latest/dex/pairs/${chainId}/${pairAddress}`,
        15_000,
        "high"
      );
      const pairs = data?.pairs || (Array.isArray(data) ? data : []);
      if (pairs.length > 0) return pairs[0];
    }
    const chains = chainId ? [] : ["solana", "ethereum", "bsc", "base", "arbitrum"];
    for (const chain of chains) {
      try {
        const data = await dexFetchCached(
          `${DEX_API}/latest/dex/pairs/${chain}/${pairAddress}`,
          15_000,
          "high"
        );
        const pairs = data?.pairs || (Array.isArray(data) ? data : []);
        if (pairs.length > 0) return pairs[0];
      } catch { /* try next */ }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── MAIN ENGINE CYCLE ──────────────────────────────────────

const DEFAULT_USER_ID = 1;

export async function runEngineCycle(userId: number = DEFAULT_USER_ID): Promise<{
  scanned: number;
  qualified: number;
  executed: number;
  positionsUpdated: number;
  errors: string[];
}> {
  const cycleStartTime = Date.now();
  const errors: string[] = [];
  let scanned = 0;
  let qualified = 0;
  let executed = 0;
  let positionsUpdated = 0;

  if (!acquireCycleLock()) {
    return { scanned: 0, qualified: 0, executed: 0, positionsUpdated: 0, errors: ["Cycle locked"] };
  }

  try {
    await refreshDynamicParams();

    // ── System health check + kill switch ──
    const sysHealth = checkSystemHealth();
    if (!sysHealth.tradingAllowed) {
      console.log(`[SystemGuard] Trading BLOCKED — Health: ${sysHealth.healthScore}/100 | Issues: ${sysHealth.issues.join(", ")}`);
      return { scanned: 0, qualified: 0, executed: 0, positionsUpdated: 0, errors: [`System health too low: ${sysHealth.healthScore}/100`] };
    }

    // ── Daily P&L reset check ──
    await checkDailyReset(userId).catch(() => {});

    // ── Equity curve MA analysis ──
    let equityCurveMultiplier = 1.0;
    let equityCurveMode = "normal";
    try {
      const ecState = await analyzeEquityCurve(userId);
      equityCurveMultiplier = ecState.sizeMultiplier;
      equityCurveMode = ecState.mode;
      if (ecState.mode !== "normal") {
        console.log(`[EquityCurve] Mode: ${ecState.mode} | Mult: ${ecState.sizeMultiplier.toFixed(2)}x`);
      }
    } catch { /* non-critical */ }

    // ── Time-of-day optimization ──
    let timeMultiplier = 1.0;
    let timeConvictionAdj = 0;
    try {
      const timeOpt = await getTimeOptimization(userId);
      timeMultiplier = timeOpt.sizeMultiplier;
      timeConvictionAdj = timeOpt.convictionAdjustment;
    } catch { /* non-critical */ }

    // ── Risk assessment ──
    let riskAssessment: RiskAssessment | null = null;
    try {
      riskAssessment = await assessRisk(userId);
      if (riskAssessment.riskLevel === "halted") {
        console.log(`[RiskManager] HALTED — ${riskAssessment.reasons.join(", ")}`);
      }
    } catch { /* use defaults */ }

    // Get or init engine state
    let state = await withDbRetry(() => queries.getEngineState(userId), "getEngineState");
    if (!state) {
      await withDbRetry(
        () => queries.upsertEngineState(userId, {
          status: "running",
          equity: "1000",
          peakEquity: "1000",
          totalScans: 0,
          totalTrades: 0,
          totalPnlUsd: "0",
          dailyPnlUsd: "0",
          consecutiveLosses: 0,
        } as any),
        "initEngineState"
      );
      state = await withDbRetry(() => queries.getEngineState(userId), "getEngineState_2");
    }

    if (!state) {
      errors.push("Failed to initialize engine state");
      return { scanned, qualified, executed, positionsUpdated, errors };
    }

    const balance = parseFloat(state.equity ?? "1000");

    // Monitor existing positions
    const openPositions = await withDbRetry(() => queries.getOpenPositions(userId), "getOpenPositions");

    for (const pos of openPositions) {
      try {
        const updated = await monitorPosition(pos, userId);
        if (updated) positionsUpdated++;
      } catch (err: any) {
        errors.push(`Position ${pos.id} error: ${err.message}`);
      }
    }

    // Check max positions + risk-based limits
    const currentOpenCount = (await withDbRetry(() => queries.getOpenPositions(userId), "getOpenCount")).length;
    const maxPositions = riskAssessment
      ? Math.min(CONFIG.maxPositions, riskAssessment.maxNewPositions + currentOpenCount)
      : CONFIG.maxPositions;

    if (currentOpenCount >= maxPositions) {
      const reason = riskAssessment?.riskLevel === "halted"
        ? `Risk HALTED: ${riskAssessment.reasons.join(", ")}`
        : `Max ${maxPositions} positions`;
      console.log(`[Engine] ${reason} — skipping scan`);
      return { scanned: 0, qualified: 0, executed: 0, positionsUpdated, errors: [reason] };
    }

    // Scan for new opportunities
    const cycleStart = Date.now();
    const pairs = await fetchAllTokenSources();
    scanned = pairs.length;

    // Data feed validation
    if (pairs.length > 0) {
      const feedCheck = validateDataFeed(pairs);
      if (!feedCheck.healthy) {
        console.log(`[DataFeed] UNHEALTHY (${feedCheck.qualityScore}/100): ${feedCheck.issues.join(", ")}`);
        recordFailure();
      } else {
        recordSuccess(pairs.length, Date.now() - cycleStart);
      }
    } else {
      recordSuccess(0, Date.now() - cycleStart);
    }

    // Load learned adjustments
    let learnedAdjustments: Map<string, number> | undefined;
    try {
      const patterns = await withDbRetry(() => queries.getTradePatterns(userId), "getPatterns");
      learnedAdjustments = new Map();
      for (const p of patterns) {
        const adj = parseFloat(p.weightAdjustment ?? "0");
        if (adj !== 0) learnedAdjustments.set(`${p.patternType}:${p.patternValue}`, adj);
      }
    } catch { /* non-critical */ }

    const openSymbols = openPositions.map((p) => p.tokenSymbol.toUpperCase());

    // ★★★ v6: RUN THE 14-LAYER SIGNAL PIPELINE ★★★
    // This replaces the old qualifyToken() with the full Manus intelligence stack
    const portfolioContext: PortfolioContext = {
      openPositionCount: currentOpenCount,
      maxPositions,
      openChains: openPositions.map(p => p.chain),
      maxSameChain: 5,
      dailyPnlPercent: parseFloat(state.dailyPnlUsd ?? "0") / balance * 100,
      totalEquity: balance,
      consecutiveLosses: state.consecutiveLosses ?? 0,
    };

    const pipelineResult = runSignalPipeline(
      pairs,
      learnedAdjustments,
      openSymbols,
      [], // avoidTokens — handled by pipeline cooldown system
      portfolioContext
    );

    // Store pipeline result for API access
    setLastPipelineResult(pipelineResult);

    qualified = pipelineResult.stats.entryAllowed;

    // Log pipeline stats
    const ps = pipelineResult.stats;
    console.log(`[Pipeline] Scanned: ${ps.totalScanned} | Hard-filtered: ${ps.hardFiltered} | Scored: ${ps.scored} | Entry-allowed: ${ps.entryAllowed} | Scam-blocked: ${ps.scamBlocked}`);
    console.log(`[Pipeline] Tiers: A+=${ps.tierAPlus} A=${ps.tierA} B=${ps.tierB} C=${ps.tierC} D=${ps.tierD} | Avg conviction: ${ps.avgConvictionScore} | Avg trust: ${ps.avgTrustScore}`);

    // Select best entries using the pipeline's selectForEntry
    const slotsAvailable = riskAssessment
      ? Math.min(maxPositions - currentOpenCount, riskAssessment.maxNewPositions)
      : maxPositions - currentOpenCount;

    const toExecute = selectForEntry(
      pipelineResult.signals,
      Math.max(0, slotsAvailable),
      state.consecutiveLosses ?? 0
    );

    // Get Kelly multiplier for position sizing
    let kellyMult = 1.0;
    try {
      kellyMult = await getKellyMultiplier(userId);
    } catch { /* use default */ }

    for (const signal of toExecute) {
      try {
        const entryPrice = signal.priceUsd;
        if (entryPrice <= 0) continue;

        // Multi-source price validation
        try {
          const priceCheck = await fullPriceValidation(signal.rawPair || signal, 100);
          if (!priceCheck.valid) {
            console.log(`[PriceValidator] Rejected ${signal.symbol}: ${priceCheck.reasons.join(", ")}`);
            continue;
          }
        } catch { /* proceed if validation fails */ }

        // Use pipeline's exit plan for stop loss and TP levels
        const exitPlan = signal.exitPlan;
        const stopLossPct = exitPlan?.stopLossPercent ?? dynamicParams.stopLossPercent;
        const tp1Pct = exitPlan?.tp1Percent ?? dynamicParams.tp1Percent;
        const tpEarlyPct = exitPlan?.tpEarlyPercent ?? dynamicParams.tpEarlyPercent;
        const tp2Pct = exitPlan?.tp2Percent ?? dynamicParams.tp2Percent;

        // MAE-optimized stop loss override (if we have enough data)
        let optimalSL: number | null = null;
        try {
          optimalSL = await getOptimalStopLoss(userId, stopLossPct);
        } catch { /* use pipeline default */ }
        const finalSLPct = optimalSL ?? stopLossPct;

        const stopLoss = entryPrice * (1 - finalSLPct / 100);
        const tp1 = entryPrice * (1 + tp1Pct / 100);

        // Position sizing: use pipeline's conviction-based size
        let posSize = pipelineCalcSize(signal, balance, kellyMult);

        // Apply risk manager multiplier
        if (riskAssessment) {
          posSize *= riskAssessment.positionSizeMultiplier;
        }

        // Apply equity curve multiplier
        posSize *= equityCurveMultiplier;

        // Apply time-of-day multiplier
        posSize *= timeMultiplier;

        // Apply volatility-adjusted sizing
        try {
          const volMult = getVolatilityMultiplier(signal.rawPair || signal);
          posSize *= volMult;
        } catch { /* use default */ }

        // Slippage-aware sizing
        try {
          const { adjustedSize, wasReduced, slippage } = adjustPositionForSlippage(posSize, signal.rawPair || signal);
          if (!slippage.executable) {
            console.log(`[Slippage] Skipping ${signal.symbol}: ${slippage.tier} slippage`);
            continue;
          }
          posSize = adjustedSize;
        } catch { /* use original size */ }

        if (posSize < 1) continue;

        // Chain concentration limits
        const chainCheck = canEnterChain(
          signal.chain,
          posSize,
          openPositions,
          balance
        );
        if (!chainCheck.allowed) {
          console.log(`[RiskManager] Skipping ${signal.symbol}: ${chainCheck.reason}`);
          continue;
        }

        const tokenAmount = posSize / entryPrice;

        // Build comprehensive entry reason from pipeline
        const entryReasons = [
          `Tier:${signal.convictionTier}`,
          `Conv:${signal.convictionScore}`,
          `Trust:${signal.trustScore}`,
          `Momentum:${signal.momentumQuality}`,
          `Entry:${signal.entryGuidance}`,
          `Persist:${signal.persistenceScanCount}scans`,
          `Trade:${signal.tradeabilityGrade}`,
          ...signal.topFactors.slice(0, 3),
        ].join(" | ");

        await withDbRetry(
          () => queries.createPaperPosition({
            userId,
            tokenAddress: signal.tokenAddress,
            tokenSymbol: signal.symbol,
            chain: signal.chain,
            pairAddress: signal.pairAddress,
            entryPrice: entryPrice.toFixed(10),
            currentPrice: entryPrice.toFixed(10),
            positionSizeUsd: posSize.toFixed(2),
            tokenAmount: tokenAmount.toFixed(10),
            status: "open",
            highestPrice: entryPrice.toFixed(10),
            lowestPrice: entryPrice.toFixed(10),
            stopLossPrice: stopLoss.toFixed(10),
            tp1Price: tp1.toFixed(10),
            tp1Hit: false,
            tp1Partial: false,
            tpEarlyHit: false,
            tp2Hit: false,
            originalPositionSize: posSize.toFixed(2),
            sizeSoldPercent: "0",
            convictionScore: signal.convictionScore,
            entryReason: entryReasons,
            entryVolume: signal.volumeH24.toFixed(2),
            entryLiquidity: signal.liquidity.toFixed(2),
            entryFdv: signal.fdv.toFixed(2),
          }),
          "createPosition"
        );

        executed++;

        // Notification with full pipeline context
        const riskInfo = riskAssessment
          ? ` | Risk: ${riskAssessment.riskLevel} (${riskAssessment.positionSizeMultiplier.toFixed(2)}x)`
          : "";
        const pipelineInfo = `Tier:${signal.convictionTier} Conv:${signal.convictionScore} Trust:${signal.trustScore} Momentum:${signal.momentumQuality}`;
        await notifyOwner({
          title: `📈 PAPER BUY — ${signal.symbol} [${signal.convictionTier}]`,
          content: `Entry: $${entryPrice.toFixed(8)} | Size: $${posSize.toFixed(2)} | SL: ${finalSLPct.toFixed(0)}% | TP1: ${tp1Pct}% | Chain: ${signal.chain}${riskInfo}\n${pipelineInfo}\nTop: ${signal.topFactors.slice(0, 3).join(", ")}`,
        }).catch(() => {});
      } catch (err: any) {
        errors.push(`Execute ${signal.symbol}: ${err.message}`);
      }
    }

    // Log scan
    const topSignal = pipelineResult.signals[0];
    await withDbRetry(
      () => queries.createScanLog({
        userId,
        tokensScanned: scanned,
        tokensQualified: qualified,
        tradesExecuted: executed,
        positionsUpdated,
        topCandidate: topSignal?.symbol,
        topCandidateScore: topSignal?.convictionScore,
        topCandidateChain: topSignal?.chain,
        scanDurationMs: Date.now() - cycleStartTime,
      }),
      "createScanLog"
    );

    // Update engine state
    await withDbRetry(
      () => queries.upsertEngineState(userId, {
        status: "running",
        lastScanAt: new Date(),
        totalScans: (state!.totalScans ?? 0) + 1,
        lastScanTokensScanned: scanned,
        lastScanTokensQualified: qualified,
        lastScanTopCandidate: topSignal?.symbol,
        lastScanTopScore: topSignal?.convictionScore,
      } as any),
      "updateEngineState"
    );

    // Log rate limiter metrics
    const rlMetrics = getDexRateLimiterMetrics();
    if (rlMetrics.rateLimitHits > 0 || rlMetrics.failedRequests > 0) {
      console.log(`[RateLimiter] Requests: ${rlMetrics.totalRequests} | Failed: ${rlMetrics.failedRequests} | 429s: ${rlMetrics.rateLimitHits}`);
    }

  } catch (err: any) {
    errors.push(`Cycle error: ${err.message}`);
  } finally {
    releaseCycleLock();
  }

  const cycleDuration = Date.now() - cycleStartTime;

  recordCycle({
    startTime: cycleStartTime,
    endTime: Date.now(),
    durationMs: cycleDuration,
    tokensScanned: scanned,
    tokensQualified: qualified,
    tradesExecuted: executed,
    positionsUpdated,
    errors,
    success: errors.length === 0 || errors.every((e) => e.includes("Max")),
  });

  return { scanned, qualified, executed, positionsUpdated, errors };
}

// ─── POSITION MONITOR (4-TIER PROFIT-TAKING + ADAPTIVE TRAIL) ──

// Track consecutive unfetchable price failures per position
const unfetchableCounters = new Map<number, number>();

async function monitorPosition(pos: any, userId: number): Promise<boolean> {
  const pair = await fetchPairPrice(pos.pairAddress, pos.chain);

  // ─── UNFETCHABLE PRICE AUTO-CLOSE ─────────────────────────
  if (!pair || !pair.priceUsd) {
    const count = (unfetchableCounters.get(pos.id) ?? 0) + 1;
    unfetchableCounters.set(pos.id, count);
    console.log(`[Engine] ${pos.tokenSymbol} price unfetchable (${count}/${CONFIG.unfetchableMaxRetries})`);

    if (count >= CONFIG.unfetchableMaxRetries) {
      unfetchableCounters.delete(pos.id);
      const entryPrice = parseFloat(pos.entryPrice);
      return await closePosition(pos, userId, entryPrice, "closed",
        `Auto-closed: price data unavailable for ${count} consecutive checks`);
    }
    return false;
  }

  // Reset unfetchable counter on successful fetch
  unfetchableCounters.delete(pos.id);

  const currentPrice = parseFloat(pair.priceUsd);
  const entryPrice = parseFloat(pos.entryPrice);
  const stopLoss = parseFloat(pos.stopLossPrice ?? "0");
  const tp1 = parseFloat(pos.tp1Price ?? "0");
  const posSize = parseFloat(pos.positionSizeUsd);
  const highWater = parseFloat(pos.highestPrice ?? pos.entryPrice);

  // Track MAE (Maximum Adverse Excursion) for stop-loss optimization
  const drawdownFromEntry = ((entryPrice - currentPrice) / entryPrice) * 100;
  if (drawdownFromEntry > 0) {
    try {
      await recordMAE(pos.id, drawdownFromEntry, pos.chain);
    } catch { /* non-critical */ }
  }

  const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  const pnlUsd = (pnlPercent / 100) * posSize;
  const newHighWater = Math.max(highWater, currentPrice);
  const newLow = Math.min(parseFloat(pos.lowestPrice ?? pos.entryPrice), currentPrice);

  const updateData: any = {
    currentPrice: currentPrice.toFixed(10),
    pnlUsd: pnlUsd.toFixed(2),
    pnlPercent: pnlPercent.toFixed(2),
    highestPrice: newHighWater.toFixed(10),
    lowestPrice: newLow.toFixed(10),
  };

  // ── 4-TIER PROFIT-TAKING SYSTEM ──
  const origPosSize = pos.originalPositionSize ? parseFloat(pos.originalPositionSize) : posSize;
  const currentSizeSold = parseFloat(pos.sizeSoldPercent ?? "0");

  // Helper: execute a partial exit at a given tier
  async function handlePartialExit(
    sellRatio: number,
    tierName: string,
    tierUpdate: Record<string, any>
  ): Promise<void> {
    const sellAmount = origPosSize * sellRatio;
    const partialPnl = sellAmount * (pnlPercent / 100);
    const newSizeSold = currentSizeSold + sellRatio * 100;
    const newPosSize = origPosSize * (1 - newSizeSold / 100);

    // Return capital + profit to equity
    const state = await withDbRetry(() => queries.getEngineState(userId), `getState_${tierName}`);
    if (state) {
      const newEquity = parseFloat(state.equity ?? "1000") + sellAmount + partialPnl;
      const newDailyPnl = parseFloat(state.dailyPnlUsd ?? "0") + partialPnl;
      await withDbRetry(
        () => queries.upsertEngineState(userId, {
          equity: newEquity.toFixed(2),
          peakEquity: Math.max(newEquity, parseFloat(state.peakEquity ?? "1000")).toFixed(2),
          dailyPnlUsd: newDailyPnl.toFixed(2),
          totalPnlUsd: (parseFloat(state.totalPnlUsd ?? "0") + partialPnl).toFixed(2),
        } as any),
        `updateState_${tierName}`
      );
    }

    Object.assign(updateData, tierUpdate, {
      positionSizeUsd: newPosSize.toFixed(2),
      sizeSoldPercent: newSizeSold.toFixed(2),
    });

    await notifyOwner({
      title: `🎯 ${tierName} — ${pos.tokenSymbol} +${pnlPercent.toFixed(1)}%`,
      content: `Sold ${(sellRatio * 100).toFixed(0)}% ($${sellAmount.toFixed(2)}) | P&L: $${partialPnl.toFixed(2)} | Remaining: ${(100 - newSizeSold).toFixed(0)}%`,
    }).catch(() => {});
  }

  // TIER 0: Early profit lock
  if (!pos.tpEarlyHit && pnlPercent >= dynamicParams.tpEarlyPercent) {
    await handlePartialExit(dynamicParams.tpEarlySellRatio, "TP-EARLY", { tpEarlyHit: true });
  }

  // TIER 1: First take-profit
  if (!pos.tp1Hit && currentPrice >= tp1) {
    await handlePartialExit(dynamicParams.tp1SellRatio, "TP1", {
      tp1Hit: true,
      tp1Partial: true,
    });

    // Move stop to breakeven + buffer
    const breakEvenStop = entryPrice * (1 + dynamicParams.earlyProfitLockPercent / 100);
    if (breakEvenStop > stopLoss) {
      updateData.stopLossPrice = breakEvenStop.toFixed(10);
    }
  }

  // TIER 2: Second take-profit
  const tp2Price = entryPrice * (1 + dynamicParams.tp2Percent / 100);
  if (pos.tp1Hit && !pos.tp2Hit && currentPrice >= tp2Price) {
    await handlePartialExit(dynamicParams.tp2SellRatio, "TP2", { tp2Hit: true });
  }

  // ── STOP LOSS ──
  if (currentPrice <= stopLoss) {
    return await closePosition(pos, userId, currentPrice, "stopped_out",
      `Stop loss hit at $${currentPrice.toFixed(8)} (SL: $${stopLoss.toFixed(8)})`);
  }

  // ── BREAKEVEN STOP RATCHET ──
  if (pnlPercent >= dynamicParams.breakEvenThreshold && !pos.tp1Hit) {
    const beStop = entryPrice * (1 + dynamicParams.earlyProfitLockPercent / 100);
    if (beStop > stopLoss) {
      updateData.stopLossPrice = beStop.toFixed(10);
    }
  }

  // ── ADAPTIVE TRAILING STOP ──
  if (pnlPercent > 0 && currentPrice < newHighWater) {
    const dropFromHigh = ((newHighWater - currentPrice) / newHighWater) * 100;
    const gainFromEntry = ((newHighWater - entryPrice) / entryPrice) * 100;

    // Trail tightens as profit grows
    let trailPercent: number;
    if (pos.tp2Hit) {
      trailPercent = dynamicParams.trailBigWin;
    } else if (pos.tp1Hit) {
      trailPercent = dynamicParams.trailPostTp1;
    } else {
      trailPercent = dynamicParams.trailPreTp1;
    }

    // Tighten trail based on gain magnitude
    const gainTightening = Math.floor(gainFromEntry / 10) * (dynamicParams.trailGainIncrement / 2);
    trailPercent = Math.max(dynamicParams.trailMinPercent, trailPercent - gainTightening);

    // Momentum fade detection: if price dropped >50% from peak gain, tighten aggressively
    if (gainFromEntry > 0 && pnlPercent < gainFromEntry * 0.5) {
      trailPercent = Math.max(dynamicParams.trailMinPercent, trailPercent * 0.7);
    }

    if (dropFromHigh >= trailPercent) {
      return await closePosition(pos, userId, currentPrice, "closed",
        `Adaptive trail ${trailPercent.toFixed(1)}%: -${dropFromHigh.toFixed(1)}% from high ($${newHighWater.toFixed(8)})`);
    }
  }

  // ── Volume dry-up ──
  const currentVolH1 = pair.volume?.h1 ?? 0;
  const entryVolume = parseFloat(pos.entryVolume ?? "0");
  if (entryVolume > 0 && currentVolH1 < entryVolume * dynamicParams.volDryUpThreshold && pnlPercent > 5) {
    return await closePosition(pos, userId, currentPrice, "closed", `Volume dry-up exit`);
  }

  // ── STALE POSITION AUTO-CLOSE ────────────────────────────
  if (pos.openedAt) {
    const holdDurationMs = Date.now() - new Date(pos.openedAt).getTime();
    const absPnlPct = Math.abs(pnlPercent);

    if (holdDurationMs >= CONFIG.stalePositionTimeoutMs && absPnlPct < CONFIG.stalePositionMinMovePct) {
      const holdHours = (holdDurationMs / 3600000).toFixed(1);
      return await closePosition(pos, userId, currentPrice, "closed",
        `Stale position: held ${holdHours}h with only ${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}% move`);
    }
  }

  // Just update
  await withDbRetry(() => queries.updatePaperPosition(pos.id, updateData), `updatePos_${pos.id}`);
  return true;
}

// ─── CLOSE POSITION ─────────────────────────────────────────

async function closePosition(
  pos: any,
  userId: number,
  exitPrice: number,
  status: "closed" | "stopped_out" | "tp_hit",
  reason: string
): Promise<boolean> {
  const entryPrice = parseFloat(pos.entryPrice);
  const posSize = parseFloat(pos.positionSizeUsd);
  const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const pnlUsd = (pnlPercent / 100) * posSize;
  const isWin = pnlUsd >= 0;

  await withDbRetry(
    () => queries.updatePaperPosition(pos.id, {
      status,
      currentPrice: exitPrice.toFixed(10),
      exitPrice: exitPrice.toFixed(10),
      pnlUsd: pnlUsd.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2),
      exitReason: reason,
      closedAt: new Date(),
    }),
    `closePos_${pos.id}`
  );

  // Update engine state: return remaining position size + P&L to equity
  const state = await withDbRetry(() => queries.getEngineState(userId), "getState_close");
  if (state) {
    const newEquity = parseFloat(state.equity ?? "1000") + posSize + pnlUsd;
    const newDailyPnl = parseFloat(state.dailyPnlUsd ?? "0") + pnlUsd;
    const newConsecLosses = isWin ? 0 : (state.consecutiveLosses ?? 0) + 1;

    const updateObj: any = {
      equity: newEquity.toFixed(2),
      dailyPnlUsd: newDailyPnl.toFixed(2),
      consecutiveLosses: newConsecLosses,
      totalTrades: (state.totalTrades ?? 0) + 1,
      totalPnlUsd: (parseFloat(state.totalPnlUsd ?? "0") + pnlUsd).toFixed(2),
    };

    if (newEquity > parseFloat(state.peakEquity ?? "1000")) {
      updateObj.peakEquity = newEquity.toFixed(2);
    }

    await withDbRetry(
      () => queries.upsertEngineState(userId, updateObj),
      "updateState_close"
    );

    // Create equity snapshot
    try {
      await withDbRetry(
        () => queries.createEquitySnapshot({
          userId,
          equity: newEquity.toFixed(2),
          dailyPnl: newDailyPnl.toFixed(2),
        }),
        "createSnapshot"
      );
    } catch { /* non-critical */ }
  }

  // Log to trades
  try {
    await withDbRetry(
      () => queries.createTrade({
        userId,
        pair: `${pos.tokenSymbol}/USD`,
        chain: pos.chain,
        status: "closed",
        entryPrice: pos.entryPrice,
        exitPrice: exitPrice.toFixed(10),
        positionSize: pos.positionSizeUsd,
        pnl: pnlUsd.toFixed(2),
        pnlPercent: pnlPercent.toFixed(2),
        conviction: pos.convictionScore,
        entryReason: pos.entryReason,
        exitReason: reason,
        source: "engine",
        entryDate: pos.openedAt,
        exitDate: new Date(),
      }),
      "logTrade"
    );
  } catch { /* non-critical */ }

  // v6: Record outcome in signal pipeline for cooldown learning
  if (!isWin) {
    recordEntryOutcome(pos.tokenSymbol, true);
    // Set cooldown on losing tokens — prevent re-entry for 2 hours
    setTokenCooldown(pos.tokenAddress, 2 * 60 * 60 * 1000, `Loss: ${pnlPercent.toFixed(1)}%`);
  } else {
    recordEntryOutcome(pos.tokenSymbol, false);
  }

  // Learning system
  try {
    const holdTimeMin = pos.openedAt ? (Date.now() - new Date(pos.openedAt).getTime()) / 60000 : 0;

    const patternUpdates = [
      { type: "chain", value: pos.chain },
      { type: "conviction_range", value: `${Math.floor(pos.convictionScore / 10) * 10}-${Math.floor(pos.convictionScore / 10) * 10 + 9}` },
      { type: "exit_type", value: status === "stopped_out" ? "stop_loss" : status === "tp_hit" ? "take_profit" : "manual_close" },
    ];

    for (const p of patternUpdates) {
      await queries.upsertTradePattern(userId, p.type, p.value, {
        totalTrades: 1,
        wins: isWin ? 1 : 0,
        losses: isWin ? 0 : 1,
        avgPnlPercent: pnlPercent.toFixed(2),
        totalPnlUsd: pnlUsd.toFixed(2),
      });
    }

    await queries.createLearningLog({
      userId,
      tradeId: pos.id,
      tokenSymbol: pos.tokenSymbol,
      chain: pos.chain,
      outcome: isWin ? "win" : "loss",
      pnlPercent: pnlPercent.toFixed(2),
      convictionScore: pos.convictionScore,
      holdDurationMs: holdTimeMin * 60000,
      exitReason: reason,
    });
  } catch { /* non-critical */ }

  // Notify
  const emoji = isWin ? "💰 PROFIT" : "📉 LOSS";
  const tierInfo = pos.tp2Hit ? " (TP2+)" : pos.tp1Hit ? " (TP1+)" : pos.tpEarlyHit ? " (Early+)" : "";
  await notifyOwner({
    title: `${emoji} — ${pos.tokenSymbol} ${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%${tierInfo}`,
    content: `Closed: $${pnlUsd.toFixed(2)} | Exit: $${exitPrice.toFixed(8)} | Reason: ${reason}`,
  }).catch(() => {});

  return true;
}

// ─── ENGINE INTERVAL MANAGER ────────────────────────────────

let engineInterval: NodeJS.Timeout | null = null;
let running = false;

export function startEngine(userId: number = DEFAULT_USER_ID) {
  if (engineInterval) {
    clearInterval(engineInterval);
  }

  running = true;
  console.log(`[Engine v6] Starting for user ${userId}, interval: ${CONFIG.scanIntervalMs}ms`);
  console.log(`[Engine v6] 14-Layer Signal Pipeline ACTIVE — conviction model, scam defense, persistence tracking, behavior protection, exit planning`);
  console.log(`[Engine v6] Risk layers: Kelly criterion, BTC regime, equity curve MA, MAE stop-loss, volatility sizing, slippage estimation`);
  console.log(`[Engine v6] Learning: auto-tuner, pattern tracking, token cooldowns, per-chain weight adjustment`);

  // Register self-heal
  setSelfHealCallback(async () => {
    console.log(`[Engine] Self-heal restart...`);
    stopEngine();
    setTimeout(() => startEngine(userId), 5000);
  });

  // Run immediately
  runEngineCycle(userId)
    .then((r) => console.log(`[Engine] Initial: scanned=${r.scanned}, qualified=${r.qualified}, executed=${r.executed}`))
    .catch((err) => console.error("[Engine] Initial error:", err));

  // Then every interval
  engineInterval = setInterval(() => {
    runEngineCycle(userId)
      .then((r) => console.log(`[Engine] Cycle: scanned=${r.scanned}, qualified=${r.qualified}, executed=${r.executed}, posUpdated=${r.positionsUpdated}`))
      .catch((err) => console.error("[Engine] Cycle error:", err));
  }, CONFIG.scanIntervalMs);
}

export function stopEngine() {
  if (engineInterval) {
    clearInterval(engineInterval);
    engineInterval = null;
  }
  running = false;
  console.log("[Engine] Stopped");
}

export function isEngineRunning(): boolean {
  return running;
}
