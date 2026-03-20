/**
 * Paper Trading Engine — Standalone Version
 *
 * Autonomous scanner + executor running on a 30-second interval.
 * Each cycle:
 * 1. Fetches trending/boosted tokens from DexScreener (all chains)
 * 2. Qualifies each token against 9+ trading rules with rug detection
 * 3. Auto-opens paper positions for qualifying setups
 * 4. Monitors open positions for SL/TP/trailing stop/circuit breaker
 * 5. Logs everything and sends Telegram notifications
 *
 * Zero Manus dependencies. Uses SQLite + Telegram.
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

// ─── DYNAMIC PARAMS (loaded from DB, refreshed each cycle) ──

let dynamicParams = {
  minConviction: 70,
  trailPreTp1: 12,
  trailPostTp1: 8,
  trailBigWin: 6,
  stopLossPercent: 10,
  tp1Percent: 25,
  breakEvenThreshold: 15,
  minRiskPercent: 1.0,
  maxRiskPercent: 2.5,
  maxPosPctLow: 3,
  maxPosPctHigh: 7,
  circuitBreakerPct: 50,
  rugLiqFdvMax: 5,
  volDryUpThreshold: 0.02,
};

async function refreshDynamicParams(): Promise<void> {
  try {
    const dbParams = await queries.getEngineParams();
    if (dbParams) {
      dynamicParams = {
        minConviction: dbParams.minConviction ?? 70,
        trailPreTp1: parseFloat(String(dbParams.trailPreTp1 ?? "12")),
        trailPostTp1: parseFloat(String(dbParams.trailPostTp1 ?? "8")),
        trailBigWin: parseFloat(String(dbParams.trailBigWin ?? "6")),
        stopLossPercent: parseFloat(String(dbParams.stopLossPercent ?? "10")),
        tp1Percent: parseFloat(String(dbParams.tp1Percent ?? "25")),
        breakEvenThreshold: parseFloat(String(dbParams.breakEvenThreshold ?? "15")),
        minRiskPercent: parseFloat(String(dbParams.minRiskPercent ?? "1.0")),
        maxRiskPercent: parseFloat(String(dbParams.maxRiskPercent ?? "2.5")),
        maxPosPctLow: parseFloat(String(dbParams.maxPosPctLow ?? "3")),
        maxPosPctHigh: parseFloat(String(dbParams.maxPosPctHigh ?? "7")),
        circuitBreakerPct: parseFloat(String(dbParams.circuitBreakerPct ?? "50")),
        rugLiqFdvMax: parseFloat(String(dbParams.rugLiqFdvMax ?? "5")),
        volDryUpThreshold: parseFloat(String(dbParams.volDryUpThreshold ?? "0.02")),
      };
      console.log(`[Engine] Loaded dynamic params v${dbParams.version ?? 1}`);
    }
  } catch {
    // Silently use defaults
  }
}

export function getDynamicParams() {
  return { ...dynamicParams };
}

// ─── TYPES ──────────────────────────────────────────────────

interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { symbol: string };
  priceUsd: string;
  priceChange?: { h1?: number; h6?: number; h24?: number; m5?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number; m5?: number };
  txns?: {
    h1?: { buys?: number; sells?: number };
    m5?: { buys?: number; sells?: number };
  };
  fdv?: number;
  pairCreatedAt?: number;
  info?: { socials?: any[] };
}

interface QualificationResult {
  qualified: boolean;
  score: number;
  reasons: string[];
  failures: string[];
  pair: DexPair;
}

// ─── DEXSCREENER API (with timeout + retry) ─────────────────

const DEX_API = "https://api.dexscreener.com";

async function trackedFetch(url: string, timeoutMs = 10000): Promise<Response> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    recordApiCall(Date.now() - start, res.ok);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    recordApiCall(Date.now() - start, false);
    throw err;
  }
}

async function fetchAllTokenSources(): Promise<DexPair[]> {
  const seen = new Set<string>();
  const allTokenRefs: { chainId: string; tokenAddress: string; source: string }[] = [];

  function addTokens(tokens: any[], source: string, maxPerSource = 50) {
    let added = 0;
    for (const t of tokens) {
      if (added >= maxPerSource) break;
      const chain = t.chainId;
      const addr = t.tokenAddress;
      if (!chain || !addr) continue;
      const key = `${chain}:${addr}`;
      if (!seen.has(key)) {
        seen.add(key);
        allTokenRefs.push({ chainId: chain, tokenAddress: addr, source });
        added++;
      }
    }
  }

  const [topBoosts, latestBoosts, latestProfiles, trendingResults] =
    await Promise.allSettled([
      trackedFetch(`${DEX_API}/token-boosts/top/v1`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      trackedFetch(`${DEX_API}/token-boosts/latest/v1`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      trackedFetch(`${DEX_API}/token-profiles/latest/v1`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      Promise.allSettled(
        ["meme", "AI", "gaming", "DeFi", "RWA"].map((q) =>
          trackedFetch(`${DEX_API}/latest/dex/search?q=${q}`)
            .then((r) => (r.ok ? r.json() : { pairs: [] }))
            .then((d) =>
              (d.pairs || []).map((p: any) => ({
                chainId: p.chainId,
                tokenAddress: p.baseToken?.address,
              }))
            )
            .catch(() => [])
        )
      ).then((results) =>
        results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      ),
    ]);

  if (topBoosts.status === "fulfilled") {
    addTokens(Array.isArray(topBoosts.value) ? topBoosts.value : [], "top_boost", 50);
  }
  if (latestBoosts.status === "fulfilled") {
    addTokens(Array.isArray(latestBoosts.value) ? latestBoosts.value : [], "latest_boost", 50);
  }
  if (latestProfiles.status === "fulfilled") {
    addTokens(Array.isArray(latestProfiles.value) ? latestProfiles.value : [], "profile", 40);
  }
  if (trendingResults.status === "fulfilled") {
    addTokens(Array.isArray(trendingResults.value) ? trendingResults.value : [], "trending", 60);
  }

  console.log(`[Engine] Discovered ${allTokenRefs.length} unique tokens across 4 sources`);

  // Batch fetch pair data by chain
  const byChain = new Map<string, string[]>();
  for (const t of allTokenRefs) {
    const arr = byChain.get(t.chainId) || [];
    arr.push(t.tokenAddress);
    byChain.set(t.chainId, arr);
  }

  const pairFetches: Promise<DexPair[]>[] = [];
  for (const [chainId, addresses] of Array.from(byChain.entries())) {
    for (let i = 0; i < addresses.length; i += 30) {
      const batch = addresses.slice(i, i + 30).join(",");
      pairFetches.push(
        trackedFetch(`${DEX_API}/tokens/v1/${chainId}/${batch}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((d) => (Array.isArray(d) ? d : []))
          .catch(() => [] as DexPair[])
      );
    }
  }

  const pairResults = await Promise.allSettled(pairFetches);
  const allPairs: DexPair[] = [];
  for (const result of pairResults) {
    if (result.status === "fulfilled") allPairs.push(...result.value);
  }

  // Deduplicate
  const seenPairs = new Set<string>();
  const uniquePairs: DexPair[] = [];
  for (const pair of allPairs) {
    if (pair.pairAddress && !seenPairs.has(pair.pairAddress)) {
      seenPairs.add(pair.pairAddress);
      uniquePairs.push(pair);
    }
  }

  console.log(`[Engine] Fetched ${uniquePairs.length} unique pairs`);
  return uniquePairs;
}

async function fetchPairPrice(pairAddress: string, chainId?: string): Promise<DexPair | null> {
  try {
    if (chainId) {
      const res = await trackedFetch(`${DEX_API}/latest/dex/pairs/${chainId}/${pairAddress}`);
      if (res.ok) {
        const data = await res.json();
        const pairs = data.pairs || (Array.isArray(data) ? data : []);
        if (pairs.length > 0) return pairs[0];
      }
    }
    const chains = chainId ? [] : ["solana", "ethereum", "bsc", "base", "arbitrum"];
    for (const chain of chains) {
      try {
        const res = await trackedFetch(`${DEX_API}/latest/dex/pairs/${chain}/${pairAddress}`);
        if (res.ok) {
          const data = await res.json();
          const pairs = data.pairs || (Array.isArray(data) ? data : []);
          if (pairs.length > 0) return pairs[0];
        }
      } catch { /* try next */ }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── TOKEN QUALIFICATION (ALL 9+ RULES) ─────────────────────

export function qualifyToken(pair: DexPair, learnedAdjustments?: Map<string, number>): QualificationResult {
  const reasons: string[] = [];
  const failures: string[] = [];
  let score = 50;

  const price = parseFloat(pair.priceUsd || "0");
  const liq = pair.liquidity?.usd ?? 0;
  const vol24h = pair.volume?.h24 ?? 0;
  const volH1 = pair.volume?.h1 ?? 0;
  const volM5 = pair.volume?.m5 ?? 0;
  const priceChangeH1 = pair.priceChange?.h1 ?? 0;
  const priceChangeH6 = pair.priceChange?.h6 ?? 0;
  const priceChangeM5 = pair.priceChange?.m5 ?? 0;
  const buysM5 = pair.txns?.m5?.buys ?? 0;
  const sellsM5 = pair.txns?.m5?.sells ?? 0;
  const buysH1 = pair.txns?.h1?.buys ?? 0;
  const sellsH1 = pair.txns?.h1?.sells ?? 0;
  const pairAge = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : Infinity;
  const pairAgeMinutes = pairAge / 60000;
  const fdv = pair.fdv ?? 0;

  // Rug-pull detection
  if (fdv > 0 && liq > fdv * dynamicParams.rugLiqFdvMax) {
    failures.push(`Suspicious: liquidity > ${dynamicParams.rugLiqFdvMax}x FDV — likely fake`);
    return { qualified: false, score: 0, reasons, failures, pair };
  }
  if (liq > 10_000_000 && fdv > 0 && fdv < 5_000_000) {
    failures.push(`Suspicious: high liq but low FDV — rug signal`);
    return { qualified: false, score: 0, reasons, failures, pair };
  }
  if (liq > 20_000_000 && pairAgeMinutes < 1440) {
    failures.push(`Suspicious: >$20M liq on pair < 24h old`);
    return { qualified: false, score: 0, reasons, failures, pair };
  }

  // Liquidity filter
  if (liq < 100_000) {
    failures.push(`Liquidity too low: $${liq.toLocaleString()}`);
    return { qualified: false, score: 0, reasons, failures, pair };
  }
  score += 10;
  reasons.push(`Liquidity: $${liq.toLocaleString()}`);

  // Sweet spot bonus
  if (liq >= 100_000 && liq <= 2_000_000) {
    score += 5;
    reasons.push(`Liquidity in sweet spot ($100K-$2M)`);
  }

  // Volume filter
  if (volM5 <= 0 && volH1 <= 0) {
    failures.push("No recent volume");
    return { qualified: false, score: 0, reasons, failures, pair };
  }
  if (volH1 > 10_000) {
    score += 5;
    reasons.push(`Strong H1 volume: $${volH1.toLocaleString()}`);
  }

  // Volume/liquidity health
  if (liq > 0 && vol24h > 0) {
    const volLiqRatio = vol24h / liq;
    if (volLiqRatio > 5) {
      score -= 10;
      reasons.push(`High vol/liq ratio ${volLiqRatio.toFixed(1)}x — wash trading risk`);
    } else if (volLiqRatio >= 0.5 && volLiqRatio <= 3) {
      score += 5;
      reasons.push(`Healthy vol/liq ratio: ${volLiqRatio.toFixed(1)}x`);
    }
  }

  // Honeypot check
  const totalTxnsM5 = buysM5 + sellsM5;
  if (totalTxnsM5 > 10 && sellsM5 / totalTxnsM5 < 0.1) {
    failures.push(`Possible honeypot: ${sellsM5} sells vs ${buysM5} buys`);
    return { qualified: false, score: 0, reasons, failures, pair };
  }

  // Entry strategy — pullback, not pump
  if (priceChangeM5 > 5) {
    failures.push(`Pumping +${priceChangeM5.toFixed(1)}% in 5m — no chase`);
    return { qualified: false, score: 0, reasons, failures, pair };
  }

  if (priceChangeH1 <= -5 && priceChangeH1 >= -20) {
    score += 15;
    reasons.push(`Good pullback: ${priceChangeH1.toFixed(1)}% H1`);
  } else if (priceChangeH1 < -20) {
    failures.push(`Crash too deep: ${priceChangeH1.toFixed(1)}% H1`);
    return { qualified: false, score: 0, reasons, failures, pair };
  } else if (priceChangeH1 > 0 && priceChangeH1 < 5) {
    score += 5;
    reasons.push(`Consolidating: ${priceChangeH1.toFixed(1)}% H1`);
  } else if (priceChangeH1 >= 5) {
    score -= 5;
    reasons.push(`Running up ${priceChangeH1.toFixed(1)}% H1`);
  }

  // Multi-timeframe confirmation
  if (priceChangeH6 > 10 && priceChangeH1 <= -5) {
    score += 10;
    reasons.push(`H6 uptrend with H1 pullback — strong setup`);
  } else if (priceChangeH6 < -30) {
    score -= 10;
    reasons.push(`H6 downtrend — falling knife risk`);
  }

  // Pair age
  if (pairAgeMinutes < 3) {
    failures.push(`Too new: ${pairAgeMinutes.toFixed(0)}m old`);
    return { qualified: false, score: 0, reasons, failures, pair };
  }
  if (pairAgeMinutes > 10) {
    score += 5;
    reasons.push(`Pair age: ${Math.floor(pairAgeMinutes)}m`);
  }

  // FDV check
  if (fdv > 0 && fdv < 10_000) {
    failures.push(`FDV too low: $${fdv.toLocaleString()}`);
    return { qualified: false, score: 0, reasons, failures, pair };
  }

  // Volume momentum
  if (volM5 > 5000) {
    score += 5;
    reasons.push(`Strong M5 volume: $${volM5.toLocaleString()}`);
  }

  // Buy/sell ratio
  if (totalTxnsM5 > 5) {
    const buyRatio = buysM5 / totalTxnsM5;
    if (buyRatio > 0.4 && buyRatio < 0.7) {
      score += 5;
      reasons.push(`Healthy buy/sell ratio: ${(buyRatio * 100).toFixed(0)}%`);
    }
  }

  // H1 activity
  const totalTxnsH1 = buysH1 + sellsH1;
  if (totalTxnsH1 > 50) {
    score += 5;
    reasons.push(`Active trading: ${totalTxnsH1} txns H1`);
  }

  // Learning adjustments
  if (learnedAdjustments && learnedAdjustments.size > 0) {
    const chainAdj = learnedAdjustments.get(`chain:${pair.chainId}`);
    if (chainAdj) { score += chainAdj; reasons.push(`Learning: chain adj ${chainAdj > 0 ? "+" : ""}${chainAdj}`); }

    const dexAdj = learnedAdjustments.get(`dex:${pair.dexId}`);
    if (dexAdj) { score += dexAdj; reasons.push(`Learning: dex adj ${dexAdj > 0 ? "+" : ""}${dexAdj}`); }

    let liqKey = "<100K";
    if (liq >= 100000 && liq < 500000) liqKey = "100K-500K";
    else if (liq >= 500000 && liq < 1000000) liqKey = "500K-1M";
    else if (liq >= 1000000) liqKey = ">1M";
    const liqAdj = learnedAdjustments.get(`liquidity_range:${liqKey}`);
    if (liqAdj) { score += liqAdj; reasons.push(`Learning: liq adj ${liqAdj > 0 ? "+" : ""}${liqAdj}`); }

    const hour = new Date().getUTCHours();
    let timeKey = "night";
    if (hour >= 6 && hour < 12) timeKey = "morning";
    else if (hour >= 12 && hour < 18) timeKey = "afternoon";
    else if (hour >= 18 && hour < 24) timeKey = "evening";
    const timeAdj = learnedAdjustments.get(`time_of_day:${timeKey}`);
    if (timeAdj) { score += timeAdj; reasons.push(`Learning: time adj ${timeAdj > 0 ? "+" : ""}${timeAdj}`); }
  }

  score = Math.min(100, Math.max(0, score));

  if (score < dynamicParams.minConviction) {
    failures.push(`Conviction too low: ${score}/100 (min ${dynamicParams.minConviction})`);
    return { qualified: false, score, reasons, failures, pair };
  }

  return { qualified: true, score, reasons, failures, pair };
}

// ─── POSITION SIZING ────────────────────────────────────────

function calculatePositionSize(
  balance: number,
  entryPrice: number,
  stopLossPrice: number,
  convictionScore: number = 70
): number {
  const minConv = dynamicParams.minConviction;
  const normalizedConviction = Math.max(0, Math.min(100 - minConv, convictionScore - minConv)) / (100 - minConv);
  const dynamicRisk = dynamicParams.minRiskPercent + normalizedConviction * (dynamicParams.maxRiskPercent - dynamicParams.minRiskPercent);
  const riskAmount = balance * (dynamicRisk / 100);
  const stopDistance = Math.abs(entryPrice - stopLossPrice) / entryPrice;
  if (stopDistance === 0) return riskAmount;
  const posSize = riskAmount / stopDistance;
  const maxPct = (dynamicParams.maxPosPctLow / 100) + normalizedConviction * ((dynamicParams.maxPosPctHigh - dynamicParams.maxPosPctLow) / 100);
  return Math.min(posSize, balance * maxPct);
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
  let scanned = 0, qualified = 0, executed = 0, positionsUpdated = 0;

  if (!acquireCycleLock()) {
    return { scanned: 0, qualified: 0, executed: 0, positionsUpdated: 0, errors: ["Cycle skipped: previous still running"] };
  }

  try {
    await refreshDynamicParams();

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

    // Check max positions
    const currentOpenCount = (await withDbRetry(() => queries.getOpenPositions(userId), "getOpenCount")).length;
    const maxPositions = CONFIG.maxPositions;

    if (currentOpenCount >= maxPositions) {
      console.log(`[Engine] Max ${maxPositions} positions — skipping scan`);
      return { scanned: 0, qualified: 0, executed: 0, positionsUpdated, errors: [`Max ${maxPositions} positions`] };
    }

    // Scan for new opportunities
    const pairs = await fetchAllTokenSources();
    scanned = pairs.length;

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
    const qualifiedSetups: QualificationResult[] = [];

    for (const pair of pairs) {
      const symbol = pair.baseToken?.symbol?.toUpperCase();
      if (!symbol || openSymbols.includes(symbol)) continue;

      const result = qualifyToken(pair, learnedAdjustments);
      if (result.qualified) {
        qualifiedSetups.push(result);
        qualified++;
      }
    }

    // Execute top setups
    const slotsAvailable = maxPositions - currentOpenCount;
    const toExecute = qualifiedSetups.sort((a, b) => b.score - a.score).slice(0, slotsAvailable);

    for (const setup of toExecute) {
      try {
        const entryPrice = parseFloat(setup.pair.priceUsd);
        if (entryPrice <= 0) continue;

        const stopLoss = entryPrice * (1 - dynamicParams.stopLossPercent / 100);
        const tp1 = entryPrice * (1 + dynamicParams.tp1Percent / 100);

        const posSize = calculatePositionSize(balance, entryPrice, stopLoss, setup.score);
        if (posSize < 1) continue;

        const tokenAmount = posSize / entryPrice;

        await withDbRetry(
          () => queries.createPaperPosition({
            userId,
            tokenAddress: setup.pair.baseToken.address,
            tokenSymbol: setup.pair.baseToken.symbol.toUpperCase(),
            chain: setup.pair.chainId,
            pairAddress: setup.pair.pairAddress,
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
            convictionScore: setup.score,
            entryReason: setup.reasons.join(" | "),
            entryVolume: (setup.pair.volume?.h24 ?? 0).toFixed(2),
            entryLiquidity: (setup.pair.liquidity?.usd ?? 0).toFixed(2),
            entryFdv: (setup.pair.fdv ?? 0).toFixed(2),
          }),
          "createPosition"
        );

        executed++;

        await notifyOwner({
          title: `PAPER BUY — ${setup.pair.baseToken.symbol}`,
          content: `Entry: $${entryPrice.toFixed(8)} | Size: $${posSize.toFixed(2)} | SL: $${stopLoss.toFixed(8)} | TP1: $${tp1.toFixed(8)} | Score: ${setup.score}/100 | Chain: ${setup.pair.chainId}\nReasons: ${setup.reasons.join(", ")}`,
        }).catch(() => {});
      } catch (err: any) {
        errors.push(`Execute ${setup.pair.baseToken.symbol}: ${err.message}`);
      }
    }

    // Log scan
    await withDbRetry(
      () => queries.createScanLog({
        userId,
        tokensScanned: scanned,
        tokensQualified: qualified,
        tradesExecuted: executed,
        positionsUpdated,
        topCandidate: qualifiedSetups[0]?.pair.baseToken.symbol,
        topCandidateScore: qualifiedSetups[0]?.score,
        topCandidateChain: qualifiedSetups[0]?.pair.chainId,
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
        lastScanTopCandidate: qualifiedSetups[0]?.pair.baseToken.symbol,
        lastScanTopScore: qualifiedSetups[0]?.score,
      } as any),
      "updateEngineState"
    );

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

// ─── POSITION MONITOR ───────────────────────────────────────

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
      // Close at entry price (0 P&L) since we can't get real price
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

  // Break-even move
  if (!pos.tp1Hit && pnlPercent >= dynamicParams.breakEvenThreshold) {
    updateData.stopLossPrice = entryPrice.toFixed(10);
    await notifyOwner({
      title: `BREAK-EVEN — ${pos.tokenSymbol}`,
      content: `Stop moved to break-even. Current: $${currentPrice.toFixed(8)} (+${pnlPercent.toFixed(1)}%)`,
    }).catch(() => {});
  }

  // TP1 hit — take 50% partial
  if (!pos.tp1Hit && currentPrice >= tp1) {
    updateData.tp1Hit = true;
    updateData.tp1Partial = true;
    const partialProfit = posSize * 0.5 * (pnlPercent / 100);
    updateData.positionSizeUsd = (posSize * 0.5).toFixed(2);
    updateData.stopLossPrice = entryPrice.toFixed(10); // Move to BE

    await notifyOwner({
      title: `TP1 HIT — ${pos.tokenSymbol} +${pnlPercent.toFixed(1)}%`,
      content: `Took 50% profit ($${partialProfit.toFixed(2)}). Remaining with BE stop.`,
    }).catch(() => {});
  }

  // Stop loss
  if (currentPrice <= stopLoss) {
    return await closePosition(pos, userId, currentPrice, "stopped_out", `Stop loss hit`);
  }

  // Circuit breaker
  if (pnlPercent < -dynamicParams.circuitBreakerPct) {
    return await closePosition(pos, userId, currentPrice, "stopped_out", `CIRCUIT BREAKER: -${Math.abs(pnlPercent).toFixed(1)}% crash`);
  }

  // Dynamic trailing stop
  if (newHighWater > entryPrice) {
    const dropFromHigh = ((newHighWater - currentPrice) / newHighWater) * 100;
    const gainFromEntry = ((newHighWater - entryPrice) / entryPrice) * 100;

    let trailPercent: number;
    if (gainFromEntry > 50) {
      trailPercent = dynamicParams.trailBigWin;
    } else if (pos.tp1Hit) {
      trailPercent = dynamicParams.trailPostTp1;
    } else {
      trailPercent = dynamicParams.trailPreTp1;
    }

    if (dropFromHigh > trailPercent && pnlPercent > 0) {
      return await closePosition(pos, userId, currentPrice, "closed", `Trailing stop: -${dropFromHigh.toFixed(1)}% from high`);
    }
  }

  // Volume dry-up
  const currentVolH1 = pair.volume?.h1 ?? 0;
  const entryVolume = parseFloat(pos.entryVolume ?? "0");
  if (entryVolume > 0 && currentVolH1 < entryVolume * dynamicParams.volDryUpThreshold && pnlPercent > 5) {
    return await closePosition(pos, userId, currentPrice, "closed", `Volume dry-up exit`);
  }

  // ─── STALE POSITION AUTO-CLOSE ────────────────────────────
  if (pos.openedAt) {
    const holdDurationMs = Date.now() - new Date(pos.openedAt).getTime();
    const absPnlPct = Math.abs(pnlPercent);

    if (holdDurationMs >= CONFIG.stalePositionTimeoutMs && absPnlPct < CONFIG.stalePositionMinMovePct) {
      const holdHours = (holdDurationMs / 3600000).toFixed(1);
      return await closePosition(pos, userId, currentPrice, "closed",
        `Stale position: held ${holdHours}h with only ${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}% move (min ${CONFIG.stalePositionMinMovePct}% required)`);
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

  // Learning system
  try {
    const holdTimeMin = pos.openedAt ? (Date.now() - new Date(pos.openedAt).getTime()) / 60000 : 0;

    // Update patterns
    const patternUpdates = [
      { type: "chain", value: pos.chain },
      { type: "conviction_range", value: `${Math.floor(pos.convictionScore / 10) * 10}-${Math.floor(pos.convictionScore / 10) * 10 + 9}` },
      { type: "exit_type", value: status === "stopped_out" ? "stop_loss" : status === "tp_hit" ? "take_profit" : "manual_close" },
    ];

    for (const p of patternUpdates) {
      await queries.upsertTradePattern(userId, p.type, p.value, {
        totalTrades: 1, // Will be incremented in upsert
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
  const emoji = isWin ? "PROFIT" : "LOSS";
  await notifyOwner({
    title: `${emoji} — ${pos.tokenSymbol} ${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%`,
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
  console.log(`[Engine] Starting for user ${userId}, interval: ${CONFIG.scanIntervalMs}ms`);

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
