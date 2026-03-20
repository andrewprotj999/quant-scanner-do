/**
 * Signal Pipeline — Standalone Version (v6)
 *
 * Complete 14-layer signal processing pipeline ported from the Manus engine.
 * Replaces the old additive qualifyToken scorer with multi-dimensional
 * conviction-based analysis.
 *
 * Pipeline layers:
 * 1.  Normalize raw DexScreener pair data
 * 2.  Hard rejection filters (instant disqualify)
 * 3.  Soft penalty assessment
 * 4.  Persistence tracking (multi-scan confirmation)
 * 5.  Tradeability scoring (spread, depth, activity)
 * 6.  Momentum classification (early/exhausted/overextended)
 * 7.  Multi-factor scoring (weighted composite)
 * 8.  Entry quality evaluation (chase risk, pullback quality)
 * 9.  Scam defense (trust scoring, honeypot, wash trading)
 * 10. Risk assessment (volatility, concentration, correlation)
 * 11. Portfolio risk (max positions, chain limits, heat)
 * 12. Multi-dimensional conviction model (11 weighted dimensions)
 * 13. Behavior protection (anti-revenge, anti-FOMO)
 * 14. Exit planning (token-specific strategy before entry)
 *
 * Zero Manus dependencies. Uses same DexScreener data as the scanner.
 */

import { CONFIG } from "../config.js";
import { extractSocialSignals, calculateSocialScore, getSocialRiskFlags } from "./socialSentiment.js";
import { analyzeWhaleActivity, calculateWhaleScore, getWhaleRiskFlags } from "./whaleTracker.js";

// ─── TYPES ────────────────────────────────────────────────

export interface NormalizedCoin {
  symbol: string;
  tokenAddress: string;
  pairAddress: string;
  chain: string;
  dexId: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume5m: number;
  volumeH1: number;
  volumeH6: number;
  volumeH24: number;
  liquidity: number;
  marketCap: number;
  fdv: number;
  pairAge: number; // minutes
  buys5m: number;
  sells5m: number;
  buys1h: number;
  sells1h: number;
  txCount5m: number;
  txCount1h: number;
  url?: string;
  imageUrl?: string;
  baseToken?: any;
  quoteToken?: any;
  rawPair?: any;
  // Injected by pipeline stages
  persistenceScore?: number;
  persistenceTrend?: string;
  persistenceScanCount?: number;
  volumeTrend?: string;
  liquidityTrend?: string;
  tradeabilityScore?: number;
  tradeabilityGrade?: string;
  momentumQuality?: string;
  momentumScore?: number;
  compositeScore?: number;
}

export type ConvictionTier = "A+" | "A" | "B" | "C" | "D";

export interface ConvictionDimension {
  name: string;
  score: number;
  weight: number;
  weightedScore: number;
  status: "strong" | "neutral" | "weak" | "critical";
  detail: string;
}

export interface ConvictionResult {
  tier: ConvictionTier;
  convictionScore: number;
  dimensions: ConvictionDimension[];
  entryAllowed: boolean;
  entryGuidance: string;
  positionSizePercent: number;
  exitPlan: ExitPlan | null;
  warnings: string[];
  blocks: string[];
  summary: string;
}

export interface ExitPlan {
  stopLossPercent: number;
  tpEarlyPercent: number;
  tp1Percent: number;
  tp2Percent: number;
  trailPercent: number;
  maxHoldMinutes: number;
  reasoning: string;
}

export interface EntryQualityResult {
  score: number;
  guidance: "VALID_NOW" | "VALID_STARTER" | "WATCHLIST_ONLY" | "AVOID";
  chaseRisk: number;
  overextensionRisk: number;
  pullbackQuality: number;
  reasons: string[];
}

export interface ScamDefenseResult {
  trustScore: number;
  blocked: boolean;
  blockReason: string;
  flags: Array<{ type: string; severity: "critical" | "high" | "medium" | "low"; detail: string }>;
}

export interface RiskResult {
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  flags: string[];
}

export interface PortfolioRiskResult {
  allowed: boolean;
  sizeAdjustment: number;
  reasons: string[];
}

export interface EnrichedSignal extends NormalizedCoin {
  compositeScore: number;
  adjustedScore: number;
  topFactors: string[];
  weakFactors: string[];
  filterPassed: boolean;
  filterPenalty: number;
  filterReasons: string[];
  persistenceScore: number;
  persistenceTrend: string;
  persistenceScanCount: number;
  tradeabilityScore: number;
  tradeabilityGrade: string;
  momentumQuality: string;
  momentumScore: number;
  momentumSignals: string[];
  riskFlags: string[];
  riskScore: number;
  riskLevel: string;
  entryQuality: EntryQualityResult;
  chaseRisk: number;
  overextensionRisk: number;
  scamDefense: ScamDefenseResult;
  trustScore: number;
  conviction: ConvictionResult;
  convictionTier: ConvictionTier;
  convictionScore: number;
  convictionSummary: string;
  entryGuidance: string;
  exitPlan: ExitPlan | null;
  socialScore: number;
  socialFactors: string[];
  socialRiskFlags: string[];
  whaleScore: number;
  whaleFactors: string[];
  whaleRiskFlags: string[];
  portfolioRisk: PortfolioRiskResult;
  signalTime: number;
}

export interface PipelineResult {
  signals: EnrichedSignal[];
  rejected: Array<{ symbol: string; chain: string; reasons: string[] }>;
  stats: PipelineStats;
}

export interface PipelineStats {
  totalScanned: number;
  hardFiltered: number;
  scored: number;
  tierAPlus: number;
  tierA: number;
  tierB: number;
  tierC: number;
  tierD: number;
  entryAllowed: number;
  scamBlocked: number;
  avgTrustScore: number;
  avgConvictionScore: number;
}

// ─── PERSISTENCE TRACKING ─────────────────────────────────

interface PersistenceRecord {
  tokenAddress: string;
  symbol: string;
  chain: string;
  firstSeen: number;
  scanCount: number;
  scanHistory: Array<{
    timestamp: number;
    price: number;
    volume: number;
    liquidity: number;
    score: number;
  }>;
  persistenceScore: number;
  persistenceTrend: string;
  volumeTrend: string;
  liquidityTrend: string;
}

const persistenceMap = new Map<string, PersistenceRecord>();
const PERSISTENCE_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const PERSISTENCE_MIN_SCANS = 2; // Require 2+ scans before entry

function updatePersistence(
  tokenAddress: string,
  symbol: string,
  chain: string,
  price: number,
  volume: number,
  liquidity: number,
  score: number
): PersistenceRecord {
  const now = Date.now();
  let record = persistenceMap.get(tokenAddress);

  if (!record) {
    record = {
      tokenAddress,
      symbol,
      chain,
      firstSeen: now,
      scanCount: 0,
      scanHistory: [],
      persistenceScore: 0,
      persistenceTrend: "new",
      volumeTrend: "stable",
      liquidityTrend: "stable",
    };
    persistenceMap.set(tokenAddress, record);
  }

  record.scanCount++;
  record.scanHistory.push({ timestamp: now, price, volume, liquidity, score });

  // Keep last 20 scans
  if (record.scanHistory.length > 20) {
    record.scanHistory = record.scanHistory.slice(-20);
  }

  // Calculate persistence score (0-100)
  const ageMins = (now - record.firstSeen) / 60000;
  let pScore = 0;

  // Scan count contribution (0-40)
  pScore += Math.min(40, record.scanCount * 8);

  // Age contribution (0-20) — older = more persistent
  if (ageMins > 60) pScore += 20;
  else if (ageMins > 30) pScore += 15;
  else if (ageMins > 10) pScore += 10;
  else if (ageMins > 5) pScore += 5;

  // Volume trend contribution (0-20)
  if (record.scanHistory.length >= 3) {
    const recent = record.scanHistory.slice(-3);
    const volGrowing = recent[2].volume > recent[0].volume;
    const liqGrowing = recent[2].liquidity >= recent[0].liquidity * 0.95;
    if (volGrowing && liqGrowing) {
      pScore += 20;
      record.volumeTrend = "growing";
      record.liquidityTrend = "stable";
    } else if (volGrowing) {
      pScore += 10;
      record.volumeTrend = "growing";
    } else {
      record.volumeTrend = recent[2].volume < recent[0].volume * 0.7 ? "declining" : "stable";
    }

    // Liquidity trend
    if (recent[2].liquidity > recent[0].liquidity * 1.1) {
      record.liquidityTrend = "growing";
      pScore += 10;
    } else if (recent[2].liquidity < recent[0].liquidity * 0.85) {
      record.liquidityTrend = "declining";
      pScore -= 10;
    }
  }

  // Score trend contribution (0-10)
  if (record.scanHistory.length >= 2) {
    const last = record.scanHistory[record.scanHistory.length - 1];
    const prev = record.scanHistory[record.scanHistory.length - 2];
    if (last.score > prev.score) pScore += 10;
    else if (last.score < prev.score - 10) pScore -= 5;
  }

  record.persistenceScore = Math.max(0, Math.min(100, pScore));

  // Trend classification
  if (record.scanCount <= 1) record.persistenceTrend = "new";
  else if (record.persistenceScore >= 60) record.persistenceTrend = "confirmed";
  else if (record.persistenceScore >= 30) record.persistenceTrend = "developing";
  else record.persistenceTrend = "weak";

  return record;
}

function cleanupStaleRecords(): void {
  const now = Date.now();
  for (const [key, record] of persistenceMap) {
    const lastScan = record.scanHistory[record.scanHistory.length - 1]?.timestamp ?? record.firstSeen;
    if (now - lastScan > PERSISTENCE_MAX_AGE_MS) {
      persistenceMap.delete(key);
    }
  }
}

// ─── TOKEN COOLDOWN (anti-repeat-loss) ────────────────────

const tokenCooldowns = new Map<string, { until: number; reason: string }>();

export function setTokenCooldown(tokenAddress: string, durationMs: number, reason: string): void {
  tokenCooldowns.set(tokenAddress, { until: Date.now() + durationMs, reason });
}

function isOnCooldown(tokenAddress: string): { cooled: boolean; reason: string } {
  const cd = tokenCooldowns.get(tokenAddress);
  if (!cd) return { cooled: false, reason: "" };
  if (Date.now() > cd.until) {
    tokenCooldowns.delete(tokenAddress);
    return { cooled: false, reason: "" };
  }
  return { cooled: true, reason: cd.reason };
}

// ─── LAYER 1: NORMALIZE ───────────────────────────────────

function normalizePair(pair: any): NormalizedCoin {
  const pairAge = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 60000 : 999;
  return {
    symbol: pair.baseToken?.symbol?.toUpperCase() || "UNKNOWN",
    tokenAddress: pair.baseToken?.address || "",
    pairAddress: pair.pairAddress || "",
    chain: pair.chainId || "",
    dexId: pair.dexId || "",
    priceUsd: parseFloat(pair.priceUsd || "0"),
    priceChange5m: pair.priceChange?.m5 ?? 0,
    priceChange1h: pair.priceChange?.h1 ?? 0,
    priceChange6h: pair.priceChange?.h6 ?? 0,
    priceChange24h: pair.priceChange?.h24 ?? 0,
    volume5m: pair.volume?.m5 ?? 0,
    volumeH1: pair.volume?.h1 ?? 0,
    volumeH6: pair.volume?.h6 ?? 0,
    volumeH24: pair.volume?.h24 ?? 0,
    liquidity: pair.liquidity?.usd ?? 0,
    marketCap: pair.marketCap ?? pair.fdv ?? 0,
    fdv: pair.fdv ?? 0,
    pairAge,
    buys5m: pair.txns?.m5?.buys ?? 0,
    sells5m: pair.txns?.m5?.sells ?? 0,
    buys1h: pair.txns?.h1?.buys ?? 0,
    sells1h: pair.txns?.h1?.sells ?? 0,
    txCount5m: (pair.txns?.m5?.buys ?? 0) + (pair.txns?.m5?.sells ?? 0),
    txCount1h: (pair.txns?.h1?.buys ?? 0) + (pair.txns?.h1?.sells ?? 0),
    url: pair.url,
    imageUrl: pair.info?.imageUrl,
    baseToken: pair.baseToken,
    quoteToken: pair.quoteToken,
    rawPair: pair,
  };
}

// ─── LAYER 2: HARD REJECTION FILTERS ──────────────────────

interface FilterResult {
  passed: boolean;
  rejectionReasons: string[];
  softPenalties: Array<{ reason: string; penalty: number }>;
  totalPenalty: number;
}

function applyFilters(coin: NormalizedCoin): FilterResult {
  const rejections: string[] = [];
  const softPenalties: Array<{ reason: string; penalty: number }> = [];

  // ── Hard filters (instant reject) ──

  // Minimum liquidity
  const minLiq = coin.chain === "bsc" ? 200_000 : 100_000;
  if (coin.liquidity < minLiq) {
    rejections.push(`Liquidity $${coin.liquidity.toLocaleString()} < $${minLiq.toLocaleString()} min`);
  }

  // Minimum volume
  if (coin.volumeH1 <= 0 && coin.volume5m <= 0) {
    rejections.push("No recent volume");
  }

  // Minimum FDV
  if (coin.fdv > 0 && coin.fdv < 10_000) {
    rejections.push(`FDV too low: $${coin.fdv.toLocaleString()}`);
  }

  // Pair age
  if (coin.pairAge < 3) {
    rejections.push(`Too new: ${coin.pairAge.toFixed(0)}m old`);
  }

  // Maximum pair age (avoid stale tokens)
  if (coin.pairAge > 14400) { // 10 days
    rejections.push(`Too old: ${(coin.pairAge / 1440).toFixed(0)} days`);
  }

  // Minimum buy ratio (honeypot check)
  const totalTxns5m = coin.buys5m + coin.sells5m;
  if (totalTxns5m > 10 && coin.sells5m / totalTxns5m < 0.1) {
    rejections.push(`Possible honeypot: ${coin.sells5m} sells vs ${coin.buys5m} buys in 5m`);
  }

  // Rug-pull: liquidity > FDV ratio
  if (coin.fdv > 0 && coin.liquidity > coin.fdv * 1.5) {
    rejections.push(`Suspicious: liquidity > 1.5x FDV`);
  }

  // Rug-pull: high liq + low FDV
  if (coin.liquidity > 10_000_000 && coin.fdv > 0 && coin.fdv < 5_000_000) {
    rejections.push("Suspicious: high liq but low FDV");
  }

  // Rug-pull: massive liq on new pair
  if (coin.liquidity > 20_000_000 && coin.pairAge < 1440) {
    rejections.push("Suspicious: >$20M liq on pair < 24h old");
  }

  // No chase: pumping too fast in 5m
  if (coin.priceChange5m > 8) {
    rejections.push(`Pumping +${coin.priceChange5m.toFixed(1)}% in 5m — no chase`);
  }

  // Crash too deep
  if (coin.priceChange1h < -25) {
    rejections.push(`Crash too deep: ${coin.priceChange1h.toFixed(1)}% H1`);
  }

  // Minimum transactions
  if (coin.txCount5m < 3) {
    rejections.push(`Too few transactions: ${coin.txCount5m} in 5m`);
  }

  // ── Soft penalties (reduce score but don't reject) ──

  // Low liquidity penalty
  if (coin.liquidity < 200_000) {
    softPenalties.push({ reason: "Low liquidity < $200K", penalty: 8 });
  }

  // New pair penalty
  if (coin.pairAge < 15) {
    softPenalties.push({ reason: `Very new pair: ${coin.pairAge.toFixed(0)}m`, penalty: 6 });
  }

  // Overextended 5m
  if (coin.priceChange5m > 5) {
    softPenalties.push({ reason: `Overextended 5m: +${coin.priceChange5m.toFixed(1)}%`, penalty: 10 });
  }

  // Overextended 1h
  if (coin.priceChange1h > 30) {
    softPenalties.push({ reason: `Overextended 1h: +${coin.priceChange1h.toFixed(1)}%`, penalty: 12 });
  }

  // High vol/liq ratio (wash trading risk)
  if (coin.liquidity > 0 && coin.volumeH24 / coin.liquidity > 5) {
    softPenalties.push({ reason: `High vol/liq ratio: ${(coin.volumeH24 / coin.liquidity).toFixed(1)}x`, penalty: 10 });
  }

  // BSC chain penalty (historically underperforms)
  if (coin.chain === "bsc") {
    softPenalties.push({ reason: "BSC chain: historically lower win rate", penalty: 12 });
  }

  // Declining volume trend
  if (coin.volumeH1 > 0 && coin.volume5m > 0) {
    const projectedH1 = coin.volume5m * 12;
    if (projectedH1 < coin.volumeH1 * 0.3) {
      softPenalties.push({ reason: "Volume declining rapidly", penalty: 8 });
    }
  }

  // Weak persistence
  const persistence = persistenceMap.get(coin.tokenAddress);
  if (persistence && persistence.scanCount < PERSISTENCE_MIN_SCANS) {
    softPenalties.push({ reason: `Only ${persistence.scanCount} scan(s) — needs ${PERSISTENCE_MIN_SCANS}+`, penalty: 15 });
  }

  const totalPenalty = softPenalties.reduce((sum, p) => sum + p.penalty, 0);

  return {
    passed: rejections.length === 0,
    rejectionReasons: rejections,
    softPenalties,
    totalPenalty,
  };
}

// ─── LAYER 5: TRADEABILITY SCORING ───────────────────────

interface TradeabilityResult {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: string[];
}

function computeTradeability(coin: NormalizedCoin): TradeabilityResult {
  let score = 50;
  const factors: string[] = [];

  // Spread proxy: buy/sell balance indicates tight spread
  const totalTxns = coin.buys5m + coin.sells5m;
  if (totalTxns > 0) {
    const buyRatio = coin.buys5m / totalTxns;
    if (buyRatio >= 0.35 && buyRatio <= 0.65) {
      score += 15;
      factors.push("Balanced order flow");
    } else if (buyRatio > 0.8 || buyRatio < 0.2) {
      score -= 15;
      factors.push("One-sided order flow");
    }
  }

  // Depth proxy: liquidity relative to volume
  if (coin.liquidity > 0 && coin.volumeH1 > 0) {
    const depthRatio = coin.liquidity / coin.volumeH1;
    if (depthRatio >= 2 && depthRatio <= 20) {
      score += 15;
      factors.push("Good depth/volume ratio");
    } else if (depthRatio < 0.5) {
      score -= 20;
      factors.push("Thin liquidity relative to volume");
    } else if (depthRatio > 50) {
      score -= 5;
      factors.push("Very low activity for liquidity");
    }
  }

  // Activity: transaction count
  if (coin.txCount1h > 100) {
    score += 10;
    factors.push("High transaction activity");
  } else if (coin.txCount1h > 30) {
    score += 5;
    factors.push("Moderate activity");
  } else if (coin.txCount1h < 10) {
    score -= 10;
    factors.push("Low activity");
  }

  // Multi-DEX presence (if available)
  if (coin.dexId) {
    score += 3;
    factors.push(`Listed on ${coin.dexId}`);
  }

  // Volume consistency
  if (coin.volumeH1 > 0 && coin.volumeH6 > 0) {
    const h1Projected = coin.volumeH1 * 6;
    const consistency = Math.min(h1Projected, coin.volumeH6) / Math.max(h1Projected, coin.volumeH6);
    if (consistency > 0.5) {
      score += 5;
      factors.push("Consistent volume");
    }
  }

  score = Math.max(0, Math.min(100, score));

  let grade: TradeabilityResult["grade"];
  if (score >= 80) grade = "A";
  else if (score >= 60) grade = "B";
  else if (score >= 40) grade = "C";
  else if (score >= 20) grade = "D";
  else grade = "F";

  return { score, grade, factors };
}

// ─── LAYER 6: MOMENTUM CLASSIFICATION ────────────────────

interface MomentumResult {
  quality: "early_acceleration" | "sustained" | "exhausted" | "overextended" | "reversal" | "neutral";
  score: number;
  signals: string[];
}

function classifyMomentum(coin: NormalizedCoin): MomentumResult {
  let score = 50;
  const signals: string[] = [];

  const m5 = coin.priceChange5m;
  const h1 = coin.priceChange1h;
  const h6 = coin.priceChange6h;

  // Early acceleration: 5m positive, 1h moderate, 6h flat/positive
  if (m5 > 1 && m5 < 5 && h1 > -5 && h1 < 15 && h6 >= -10) {
    score += 25;
    signals.push("Early acceleration pattern");
    return { quality: "early_acceleration", score: Math.min(100, score), signals };
  }

  // Sustained momentum: all timeframes positive and aligned
  if (m5 > 0 && h1 > 5 && h6 > 10) {
    score += 15;
    signals.push("Sustained upward momentum");
    // Check if overextended
    if (h1 > 30 || h6 > 60) {
      score -= 20;
      signals.push("Overextended — reversal risk");
      return { quality: "overextended", score: Math.max(0, score), signals };
    }
    return { quality: "sustained", score: Math.min(100, score), signals };
  }

  // Exhausted: was running but 5m turning negative
  if (m5 < -2 && h1 > 10) {
    score -= 10;
    signals.push("Momentum exhaustion — 5m reversal after 1h run");
    return { quality: "exhausted", score: Math.max(0, score), signals };
  }

  // Reversal: all timeframes negative
  if (m5 < -3 && h1 < -5 && h6 < -10) {
    score -= 20;
    signals.push("Full reversal pattern");
    return { quality: "reversal", score: Math.max(0, score), signals };
  }

  // Pullback entry: 6h positive, 1h pulling back, 5m stabilizing
  if (h6 > 10 && h1 >= -15 && h1 <= -3 && m5 > -3) {
    score += 20;
    signals.push("Healthy pullback in uptrend");
    return { quality: "early_acceleration", score: Math.min(100, score), signals };
  }

  signals.push("Neutral momentum");
  return { quality: "neutral", score, signals };
}

// ─── LAYER 7: MULTI-FACTOR SCORING ──────────────────────

interface ScoringResult {
  adjustedScore: number;
  factors: Array<{ name: string; score: number; weight: number }>;
  topFactors: string[];
  weakFactors: string[];
}

function computeScore(coin: NormalizedCoin, penalty: number): ScoringResult {
  const factors: Array<{ name: string; score: number; weight: number }> = [];

  // Factor 1: Liquidity quality (0-100)
  let liqScore = 0;
  if (coin.liquidity >= 1_000_000) liqScore = 90;
  else if (coin.liquidity >= 500_000) liqScore = 80;
  else if (coin.liquidity >= 200_000) liqScore = 65;
  else if (coin.liquidity >= 100_000) liqScore = 50;
  else liqScore = 20;
  // Sweet spot bonus
  if (coin.liquidity >= 200_000 && coin.liquidity <= 2_000_000) liqScore += 10;
  factors.push({ name: "Liquidity", score: Math.min(100, liqScore), weight: 0.15 });

  // Factor 2: Volume health (0-100)
  let volScore = 0;
  if (coin.volumeH1 > 50_000) volScore = 85;
  else if (coin.volumeH1 > 20_000) volScore = 70;
  else if (coin.volumeH1 > 10_000) volScore = 55;
  else if (coin.volumeH1 > 5_000) volScore = 40;
  else volScore = 20;
  // Vol/liq health
  if (coin.liquidity > 0) {
    const ratio = coin.volumeH24 / coin.liquidity;
    if (ratio >= 0.5 && ratio <= 3) volScore += 10;
    else if (ratio > 5) volScore -= 15;
  }
  factors.push({ name: "Volume", score: Math.max(0, Math.min(100, volScore)), weight: 0.12 });

  // Factor 3: Price action (0-100)
  let priceScore = 50;
  // Pullback in uptrend = best
  if (coin.priceChange6h > 10 && coin.priceChange1h >= -15 && coin.priceChange1h <= -3) {
    priceScore = 85;
  }
  // Consolidation after move
  else if (coin.priceChange1h > -3 && coin.priceChange1h < 5 && coin.priceChange6h > 0) {
    priceScore = 70;
  }
  // Running up — risky
  else if (coin.priceChange1h > 10) {
    priceScore = 30;
  }
  // Falling knife
  else if (coin.priceChange1h < -15) {
    priceScore = 15;
  }
  // Moderate pullback
  else if (coin.priceChange1h >= -10 && coin.priceChange1h < -3) {
    priceScore = 65;
  }
  factors.push({ name: "Price Action", score: priceScore, weight: 0.15 });

  // Factor 4: Buy pressure (0-100)
  let buyScore = 50;
  const total5m = coin.buys5m + coin.sells5m;
  if (total5m > 5) {
    const buyRatio = coin.buys5m / total5m;
    if (buyRatio >= 0.55 && buyRatio <= 0.75) buyScore = 80;
    else if (buyRatio >= 0.45 && buyRatio <= 0.55) buyScore = 65;
    else if (buyRatio > 0.75) buyScore = 40; // Too one-sided
    else buyScore = 30;
  }
  factors.push({ name: "Buy Pressure", score: buyScore, weight: 0.10 });

  // Factor 5: Pair maturity (0-100)
  let ageScore = 50;
  if (coin.pairAge >= 30 && coin.pairAge <= 1440) ageScore = 80; // 30m - 1 day
  else if (coin.pairAge > 1440 && coin.pairAge <= 4320) ageScore = 70; // 1-3 days
  else if (coin.pairAge > 4320 && coin.pairAge <= 10080) ageScore = 60; // 3-7 days
  else if (coin.pairAge < 10) ageScore = 25;
  else ageScore = 40;
  factors.push({ name: "Pair Maturity", score: ageScore, weight: 0.08 });

  // Factor 6: FDV/Market cap (0-100)
  let fdvScore = 50;
  if (coin.fdv >= 100_000 && coin.fdv <= 5_000_000) fdvScore = 80; // Sweet spot
  else if (coin.fdv > 5_000_000 && coin.fdv <= 50_000_000) fdvScore = 60;
  else if (coin.fdv > 50_000_000) fdvScore = 35;
  else fdvScore = 30;
  factors.push({ name: "Market Cap", score: fdvScore, weight: 0.08 });

  // Factor 7: Transaction activity (0-100)
  let txScore = 50;
  if (coin.txCount1h > 100) txScore = 85;
  else if (coin.txCount1h > 50) txScore = 70;
  else if (coin.txCount1h > 20) txScore = 55;
  else txScore = 30;
  factors.push({ name: "Activity", score: txScore, weight: 0.07 });

  // Factor 8: Multi-timeframe alignment (0-100)
  let mtfScore = 50;
  const aligned = (coin.priceChange5m > 0 ? 1 : 0) + (coin.priceChange1h > 0 ? 1 : 0) + (coin.priceChange6h > 0 ? 1 : 0);
  if (aligned === 3) mtfScore = 75;
  else if (aligned === 2) mtfScore = 60;
  else if (aligned === 1) mtfScore = 40;
  else mtfScore = 20;
  // Pullback bonus
  if (coin.priceChange6h > 10 && coin.priceChange1h < 0) mtfScore += 15;
  factors.push({ name: "Timeframe Alignment", score: Math.min(100, mtfScore), weight: 0.10 });

  // Factor 9: Volume momentum (0-100)
  let volMomScore = 50;
  if (coin.volume5m > 0 && coin.volumeH1 > 0) {
    const projected = coin.volume5m * 12;
    if (projected > coin.volumeH1 * 1.5) {
      volMomScore = 85;
    } else if (projected > coin.volumeH1) {
      volMomScore = 70;
    } else if (projected > coin.volumeH1 * 0.5) {
      volMomScore = 50;
    } else {
      volMomScore = 25;
    }
  }
  factors.push({ name: "Volume Momentum", score: volMomScore, weight: 0.08 });

  // Factor 10: Chain quality (0-100)
  let chainScore = 50;
  if (coin.chain === "solana") chainScore = 75;
  else if (coin.chain === "base") chainScore = 65;
  else if (coin.chain === "ethereum") chainScore = 55;
  else if (coin.chain === "arbitrum") chainScore = 55;
  else if (coin.chain === "bsc") chainScore = 35;
  else chainScore = 40;
  factors.push({ name: "Chain Quality", score: chainScore, weight: 0.07 });

  // Compute weighted score
  let rawScore = 0;
  for (const f of factors) {
    rawScore += f.score * f.weight;
  }

  // Apply penalties
  const adjustedScore = Math.max(0, Math.min(100, Math.round(rawScore - penalty)));

  // Top and weak factors
  const sorted = [...factors].sort((a, b) => b.score - a.score);
  const topFactors = sorted.slice(0, 3).map(f => `${f.name}: ${f.score}`);
  const weakFactors = sorted.slice(-3).map(f => `${f.name}: ${f.score}`);

  return { adjustedScore, factors, topFactors, weakFactors };
}

// ─── LAYER 8: ENTRY QUALITY EVALUATION ──────────────────

function evaluateEntryQuality(coin: NormalizedCoin, tradeability: TradeabilityResult): EntryQualityResult {
  let score = 50;
  const reasons: string[] = [];

  // Chase risk (0-100): how much we'd be chasing
  let chaseRisk = 0;
  if (coin.priceChange5m > 3) chaseRisk += 30;
  if (coin.priceChange5m > 5) chaseRisk += 20;
  if (coin.priceChange1h > 15) chaseRisk += 25;
  if (coin.priceChange1h > 25) chaseRisk += 25;

  // Overextension risk (0-100)
  let overextensionRisk = 0;
  if (coin.priceChange1h > 20) overextensionRisk += 30;
  if (coin.priceChange6h > 40) overextensionRisk += 30;
  if (coin.priceChange1h > 30 && coin.priceChange6h > 50) overextensionRisk += 40;

  // Pullback quality (0-100): how good the entry timing is
  let pullbackQuality = 30;
  if (coin.priceChange6h > 10 && coin.priceChange1h >= -15 && coin.priceChange1h <= -3) {
    pullbackQuality = 90;
    score += 25;
    reasons.push("Excellent pullback entry in uptrend");
  } else if (coin.priceChange1h >= -5 && coin.priceChange1h <= 0 && coin.priceChange6h > 0) {
    pullbackQuality = 70;
    score += 15;
    reasons.push("Good consolidation entry");
  } else if (coin.priceChange5m > 3) {
    pullbackQuality = 20;
    score -= 15;
    reasons.push("Chasing momentum — poor entry timing");
  }

  // Tradeability impact
  if (tradeability.score >= 70) {
    score += 10;
    reasons.push("Good tradeability");
  } else if (tradeability.score < 40) {
    score -= 15;
    reasons.push("Poor tradeability — hard to exit");
  }

  // Volume confirmation
  if (coin.volume5m > 5000 && coin.buys5m > coin.sells5m) {
    score += 10;
    reasons.push("Volume-confirmed buying");
  }

  score = Math.max(0, Math.min(100, score));

  let guidance: EntryQualityResult["guidance"];
  if (score >= 70 && chaseRisk < 30 && overextensionRisk < 30) {
    guidance = "VALID_NOW";
  } else if (score >= 50 && chaseRisk < 50) {
    guidance = "VALID_STARTER";
  } else if (score >= 30) {
    guidance = "WATCHLIST_ONLY";
  } else {
    guidance = "AVOID";
  }

  return { score, guidance, chaseRisk, overextensionRisk, pullbackQuality, reasons };
}

// ─── LAYER 9: SCAM DEFENSE ──────────────────────────────

function evaluateScamRisk(coin: NormalizedCoin): ScamDefenseResult {
  let trustScore = 70; // Start neutral-positive
  const flags: ScamDefenseResult["flags"] = [];
  let blocked = false;
  let blockReason = "";

  // Honeypot detection
  const total5m = coin.buys5m + coin.sells5m;
  if (total5m > 15 && coin.sells5m < 2) {
    flags.push({ type: "honeypot", severity: "critical", detail: "No sells despite high buys — likely honeypot" });
    blocked = true;
    blockReason = "Honeypot pattern detected";
    trustScore -= 50;
  }

  // Wash trading detection
  if (coin.liquidity > 0 && coin.volumeH24 / coin.liquidity > 8) {
    flags.push({ type: "wash_trading", severity: "high", detail: `Vol/Liq ratio ${(coin.volumeH24 / coin.liquidity).toFixed(1)}x — wash trading likely` });
    trustScore -= 20;
  }

  // Suspicious liquidity patterns
  if (coin.fdv > 0 && coin.liquidity > coin.fdv * 1.2) {
    flags.push({ type: "fake_liquidity", severity: "high", detail: "Liquidity exceeds FDV — likely manipulated" });
    trustScore -= 25;
  }

  // Very new + very high volume = suspicious
  if (coin.pairAge < 10 && coin.volumeH1 > 100_000) {
    flags.push({ type: "suspicious_launch", severity: "medium", detail: "Very new pair with unusually high volume" });
    trustScore -= 10;
  }

  // No social presence
  const rawPair = coin.rawPair;
  const hasSocials = rawPair?.info?.socials?.length > 0;
  const hasWebsite = rawPair?.info?.websites?.length > 0 || rawPair?.info?.socials?.some((s: any) => s.type === "website");
  if (!hasSocials && !hasWebsite) {
    flags.push({ type: "no_socials", severity: "medium", detail: "No social links or website" });
    trustScore -= 10;
  }

  // Extreme price movement on new pair
  if (coin.pairAge < 30 && Math.abs(coin.priceChange1h) > 50) {
    flags.push({ type: "volatile_launch", severity: "medium", detail: "Extreme volatility on new pair" });
    trustScore -= 10;
  }

  // Single-sided trading
  const totalH1 = coin.buys1h + coin.sells1h;
  if (totalH1 > 30 && (coin.buys1h / totalH1 > 0.9 || coin.sells1h / totalH1 > 0.9)) {
    flags.push({ type: "one_sided", severity: "high", detail: "Extremely one-sided trading in 1h" });
    trustScore -= 15;
  }

  trustScore = Math.max(0, Math.min(100, trustScore));

  // Block if trust score is critically low
  if (trustScore < 25 && !blocked) {
    blocked = true;
    blockReason = `Trust score critically low: ${trustScore}/100`;
  }

  return { trustScore, blocked, blockReason, flags };
}

// ─── LAYER 10: RISK ASSESSMENT ──────────────────────────

function assessTokenRisk(coin: NormalizedCoin): RiskResult {
  let riskScore = 0;
  const flags: string[] = [];

  // Volatility risk
  if (Math.abs(coin.priceChange1h) > 20) {
    riskScore += 20;
    flags.push("High 1h volatility");
  }
  if (Math.abs(coin.priceChange5m) > 5) {
    riskScore += 10;
    flags.push("High 5m volatility");
  }

  // Liquidity risk
  if (coin.liquidity < 200_000) {
    riskScore += 15;
    flags.push("Low liquidity");
  }

  // Concentration risk (high FDV/liq ratio)
  if (coin.fdv > 0 && coin.fdv / coin.liquidity > 50) {
    riskScore += 15;
    flags.push("High FDV/liquidity ratio");
  }

  // Age risk
  if (coin.pairAge < 15) {
    riskScore += 10;
    flags.push("Very new pair");
  }

  // Volume decline risk
  if (coin.volumeH1 > 0 && coin.volume5m * 12 < coin.volumeH1 * 0.3) {
    riskScore += 10;
    flags.push("Volume declining");
  }

  // Sell pressure risk
  const total = coin.buys5m + coin.sells5m;
  if (total > 5 && coin.sells5m / total > 0.65) {
    riskScore += 15;
    flags.push("Heavy sell pressure");
  }

  riskScore = Math.min(100, riskScore);

  let riskLevel: RiskResult["riskLevel"];
  if (riskScore >= 60) riskLevel = "critical";
  else if (riskScore >= 40) riskLevel = "high";
  else if (riskScore >= 20) riskLevel = "medium";
  else riskLevel = "low";

  return { riskScore, riskLevel, flags };
}

// ─── LAYER 11: PORTFOLIO RISK ───────────────────────────

export interface PortfolioContext {
  openPositionCount: number;
  maxPositions: number;
  openChains: string[];
  maxSameChain: number;
  dailyPnlPercent: number;
  totalEquity: number;
  consecutiveLosses: number;
}

function evaluatePortfolioRisk(
  coin: NormalizedCoin,
  ctx: PortfolioContext
): PortfolioRiskResult {
  const reasons: string[] = [];
  let sizeAdjustment = 1.0;

  // Max positions check
  if (ctx.openPositionCount >= ctx.maxPositions) {
    return { allowed: false, sizeAdjustment: 0, reasons: ["Max positions reached"] };
  }

  // Chain concentration
  const chainCount = ctx.openChains.filter(c => c === coin.chain).length;
  if (chainCount >= ctx.maxSameChain) {
    return { allowed: false, sizeAdjustment: 0, reasons: [`Max ${ctx.maxSameChain} positions on ${coin.chain}`] };
  }

  // Reduce size if many positions open
  if (ctx.openPositionCount >= ctx.maxPositions * 0.7) {
    sizeAdjustment *= 0.7;
    reasons.push("Near max positions — reduced size");
  }

  // Reduce size on losing streak
  if (ctx.consecutiveLosses >= 3) {
    sizeAdjustment *= Math.max(0.3, 1 - ctx.consecutiveLosses * 0.15);
    reasons.push(`Loss streak (${ctx.consecutiveLosses}) — reduced size`);
  }

  // Reduce size if daily P&L is negative
  if (ctx.dailyPnlPercent < -3) {
    sizeAdjustment *= 0.5;
    reasons.push("Daily P&L < -3% — defensive sizing");
  }

  return { allowed: true, sizeAdjustment, reasons };
}

// ─── LAYER 12: MULTI-DIMENSIONAL CONVICTION MODEL ──────

interface DimensionWeights {
  compositeScore: number;
  entryQuality: number;
  scamDefense: number;
  riskAssessment: number;
  persistence: number;
  tradeability: number;
  momentumQuality: number;
  regimeAlignment: number;
  portfolioFit: number;
  socialSentiment: number;
  whaleActivity: number;
}

// Profile-aware dimension weights
const PROFILE_WEIGHTS: Record<string, DimensionWeights> = {
  conservative: {
    compositeScore: 0.09,
    entryQuality: 0.11,
    scamDefense: 0.18,
    riskAssessment: 0.13,
    persistence: 0.16,
    tradeability: 0.07,
    momentumQuality: 0.04,
    regimeAlignment: 0.06,
    portfolioFit: 0.04,
    socialSentiment: 0.05,
    whaleActivity: 0.07,
  },
  balanced: {
    compositeScore: 0.13,
    entryQuality: 0.13,
    scamDefense: 0.13,
    riskAssessment: 0.10,
    persistence: 0.10,
    tradeability: 0.07,
    momentumQuality: 0.07,
    regimeAlignment: 0.07,
    portfolioFit: 0.06,
    socialSentiment: 0.06,
    whaleActivity: 0.08,
  },
  aggressive: {
    compositeScore: 0.17,
    entryQuality: 0.10,
    scamDefense: 0.08,
    riskAssessment: 0.07,
    persistence: 0.07,
    tradeability: 0.08,
    momentumQuality: 0.13,
    regimeAlignment: 0.08,
    portfolioFit: 0.06,
    socialSentiment: 0.06,
    whaleActivity: 0.10,
  },
};

// Active profile (can be changed by agent system)
let activeProfile: "conservative" | "balanced" | "aggressive" = "balanced";

export function setActiveProfile(profile: "conservative" | "balanced" | "aggressive"): void {
  activeProfile = profile;
}

export function getActiveProfile(): string {
  return activeProfile;
}

function buildDimension(
  name: string,
  score: number,
  weight: number,
  detail: string
): ConvictionDimension {
  const clamped = Math.max(0, Math.min(100, score));
  let status: ConvictionDimension["status"];
  if (clamped >= 70) status = "strong";
  else if (clamped >= 40) status = "neutral";
  else if (clamped >= 20) status = "weak";
  else status = "critical";
  return { name, score: clamped, weight, weightedScore: 0, status, detail };
}

function computeConviction(
  coin: NormalizedCoin,
  scoring: ScoringResult,
  entryQuality: EntryQualityResult,
  scamDefense: ScamDefenseResult,
  risk: RiskResult,
  persistence: PersistenceRecord,
  tradeability: TradeabilityResult,
  momentum: MomentumResult,
  portfolioRisk: PortfolioRiskResult,
  socialScore: number,
  socialFactors: string[],
  socialRiskFlags: string[],
  whaleScore: number,
  whaleFactors: string[],
  whaleRiskFlags: string[]
): ConvictionResult {
  const w = PROFILE_WEIGHTS[activeProfile] || PROFILE_WEIGHTS.balanced;
  const warnings: string[] = [];
  const blocks: string[] = [];
  const dimensions: ConvictionDimension[] = [];

  // 1. Composite Score
  dimensions.push(buildDimension(
    "Composite Score", scoring.adjustedScore, w.compositeScore,
    `Score: ${scoring.adjustedScore}/100 (top: ${scoring.topFactors.slice(0, 2).join(", ")})`
  ));

  // 2. Entry Quality
  dimensions.push(buildDimension(
    "Entry Quality", entryQuality.score, w.entryQuality,
    `Entry: ${entryQuality.guidance} (chase: ${entryQuality.chaseRisk}, overext: ${entryQuality.overextensionRisk})`
  ));
  if (entryQuality.guidance === "AVOID") {
    blocks.push(`Entry blocked: ${entryQuality.reasons[0] || "Poor entry quality"}`);
  }
  if (entryQuality.chaseRisk > 60) {
    warnings.push(`High chase risk (${entryQuality.chaseRisk})`);
  }

  // 3. Scam Defense
  dimensions.push(buildDimension(
    "Scam Defense", scamDefense.trustScore, w.scamDefense,
    `Trust: ${scamDefense.trustScore}/100 (${scamDefense.flags.length} flags)`
  ));
  if (scamDefense.blocked) {
    blocks.push(`Scam blocked: ${scamDefense.blockReason}`);
  }
  for (const flag of scamDefense.flags) {
    if (flag.severity === "critical") blocks.push(`Critical: ${flag.detail}`);
    else if (flag.severity === "high") warnings.push(`Scam: ${flag.detail}`);
  }

  // 4. Risk Assessment (inverted: lower risk = higher score)
  const riskDimScore = Math.max(0, 100 - risk.riskScore);
  dimensions.push(buildDimension(
    "Risk Assessment", riskDimScore, w.riskAssessment,
    `Risk: ${risk.riskLevel} (${risk.flags.length} flags)`
  ));
  if (risk.riskLevel === "critical") {
    warnings.push("Critical risk level");
  }

  // 5. Persistence
  dimensions.push(buildDimension(
    "Persistence", persistence.persistenceScore, w.persistence,
    `Scans: ${persistence.scanCount}, trend: ${persistence.persistenceTrend}`
  ));
  if (persistence.scanCount < PERSISTENCE_MIN_SCANS) {
    warnings.push(`Only ${persistence.scanCount} scan(s) — needs confirmation`);
  }

  // 6. Tradeability
  dimensions.push(buildDimension(
    "Tradeability", tradeability.score, w.tradeability,
    `Grade: ${tradeability.grade} (${tradeability.factors.slice(0, 2).join(", ")})`
  ));
  if (tradeability.score < 30) {
    warnings.push("Poor tradeability — hard to exit");
  }

  // 7. Momentum Quality
  const momScore = momentum.score;
  dimensions.push(buildDimension(
    "Momentum", momScore, w.momentumQuality,
    `${momentum.quality} (${momentum.signals[0] || "neutral"})`
  ));
  if (momentum.quality === "exhausted" || momentum.quality === "overextended") {
    warnings.push(`Momentum ${momentum.quality}`);
  }

  // 8. Regime Alignment (use BTC regime from risk manager)
  let regimeScore = 50; // Default neutral
  // Will be updated by the engine with actual BTC regime data
  dimensions.push(buildDimension(
    "Regime Alignment", regimeScore, w.regimeAlignment,
    "Market regime: neutral"
  ));

  // 9. Portfolio Fit
  let portfolioScore = portfolioRisk.allowed ? 70 : 10;
  if (portfolioRisk.sizeAdjustment < 0.5) portfolioScore = 30;
  else if (portfolioRisk.sizeAdjustment < 0.8) portfolioScore = 50;
  dimensions.push(buildDimension(
    "Portfolio Fit", portfolioScore, w.portfolioFit,
    `${portfolioRisk.allowed ? "Allowed" : "Blocked"} (adj: ${portfolioRisk.sizeAdjustment.toFixed(2)})`
  ));
  if (!portfolioRisk.allowed) {
    blocks.push(`Portfolio: ${portfolioRisk.reasons[0]}`);
  }

  // 10. Social Sentiment
  dimensions.push(buildDimension(
    "Social Sentiment", socialScore, w.socialSentiment,
    `Social: ${socialScore}/100 (${socialFactors.length} signals)`
  ));
  if (socialRiskFlags.includes("NO_SOCIALS")) {
    warnings.push("No social links — anonymous token");
  }

  // 11. Whale Activity
  dimensions.push(buildDimension(
    "Whale Activity", whaleScore, w.whaleActivity,
    `Whale: ${whaleScore}/100 (${whaleFactors.length} signals)`
  ));
  if (whaleRiskFlags.includes("DUMP_PATTERN")) {
    blocks.push("Dump pattern detected — whale distribution");
  }
  if (whaleRiskFlags.includes("HEAVY_SELLING")) {
    warnings.push("Heavy whale selling");
  }

  // ── Compute conviction score ──
  let convictionScore = 0;
  for (const dim of dimensions) {
    dim.weightedScore = dim.score * dim.weight;
    convictionScore += dim.weightedScore;
  }
  convictionScore = Math.round(Math.max(0, Math.min(100, convictionScore)));

  // ── Assign tier ──
  let tier: ConvictionTier;
  if (convictionScore >= 75 && blocks.length === 0 && warnings.length <= 1) {
    tier = "A+";
  } else if (convictionScore >= 60 && blocks.length === 0) {
    tier = "A";
  } else if (convictionScore >= 45 && blocks.length === 0) {
    tier = "B";
  } else if (convictionScore >= 30 && blocks.length === 0) {
    tier = "C";
  } else {
    tier = "D";
  }

  // ── Entry guidance ──
  let entryGuidance: string;
  if (blocks.length > 0) {
    entryGuidance = "AVOID";
  } else if (entryQuality.guidance === "AVOID") {
    entryGuidance = "AVOID";
  } else if (tier === "A+" || tier === "A") {
    entryGuidance = entryQuality.guidance === "VALID_NOW" ? "VALID_NOW" : entryQuality.guidance;
  } else if (tier === "B") {
    entryGuidance = entryQuality.guidance === "VALID_NOW" ? "VALID_STARTER" : entryQuality.guidance;
  } else if (tier === "C") {
    entryGuidance = "WATCHLIST_ONLY";
  } else {
    entryGuidance = "AVOID";
  }

  const entryAllowed = blocks.length === 0 &&
    (entryGuidance === "VALID_NOW" || entryGuidance === "VALID_STARTER");

  // ── Position sizing by tier ──
  const tierSizeMap: Record<ConvictionTier, number> = {
    "A+": 4.0,
    A: 3.0,
    B: 2.0,
    C: 1.0,
    D: 0,
  };
  let positionSizePercent = tierSizeMap[tier];
  if (portfolioRisk.sizeAdjustment < 1) {
    positionSizePercent *= portfolioRisk.sizeAdjustment;
  }
  positionSizePercent = Math.max(0, Math.min(5, positionSizePercent));

  // ── Exit plan ──
  const exitPlan = buildExitPlan(coin, momentum, risk, tradeability);

  // ── Summary ──
  const guidanceLabel: Record<string, string> = {
    VALID_NOW: "Ready to enter",
    VALID_STARTER: "Small position OK",
    WATCHLIST_ONLY: "Watch only",
    AVOID: "Do not enter",
  };
  const warningNote = warnings.length > 0 ? ` (${warnings.length} warning${warnings.length > 1 ? "s" : ""})` : "";
  const summary = blocks.length > 0
    ? `${coin.symbol}: BLOCKED — ${blocks[0]}`
    : `${coin.symbol}: Tier ${tier} (${convictionScore}/100) — ${guidanceLabel[entryGuidance] || entryGuidance}${warningNote}`;

  return {
    tier,
    convictionScore,
    dimensions,
    entryAllowed,
    entryGuidance,
    positionSizePercent,
    exitPlan,
    warnings,
    blocks,
    summary,
  };
}

// ─── LAYER 14: EXIT PLANNING ────────────────────────────

function buildExitPlan(
  coin: NormalizedCoin,
  momentum: MomentumResult,
  risk: RiskResult,
  tradeability: TradeabilityResult
): ExitPlan {
  // Base exit parameters
  let stopLossPercent = 7;
  let tpEarlyPercent = 10;
  let tp1Percent = 20;
  let tp2Percent = 35;
  let trailPercent = 8;
  let maxHoldMinutes = 240;
  const reasons: string[] = [];

  // Adjust based on momentum
  if (momentum.quality === "early_acceleration") {
    tp1Percent = 25;
    tp2Percent = 45;
    maxHoldMinutes = 360;
    reasons.push("Extended targets for early acceleration");
  } else if (momentum.quality === "exhausted" || momentum.quality === "overextended") {
    tpEarlyPercent = 7;
    tp1Percent = 12;
    stopLossPercent = 5;
    maxHoldMinutes = 120;
    reasons.push("Tight targets for exhausted momentum");
  }

  // Adjust based on risk
  if (risk.riskLevel === "high") {
    stopLossPercent = Math.min(stopLossPercent, 5);
    maxHoldMinutes = Math.min(maxHoldMinutes, 120);
    reasons.push("Tight SL for high risk");
  }

  // Adjust based on tradeability
  if (tradeability.score < 40) {
    stopLossPercent = Math.min(stopLossPercent, 5);
    trailPercent = Math.max(trailPercent, 10);
    reasons.push("Wider trail for poor tradeability");
  }

  // Adjust based on liquidity
  if (coin.liquidity < 200_000) {
    trailPercent = Math.max(trailPercent, 10);
    reasons.push("Wider trail for low liquidity");
  }

  // Adjust based on volatility
  if (Math.abs(coin.priceChange1h) > 15) {
    trailPercent = Math.max(trailPercent, 10);
    reasons.push("Wider trail for high volatility");
  }

  return {
    stopLossPercent,
    tpEarlyPercent,
    tp1Percent,
    tp2Percent,
    trailPercent,
    maxHoldMinutes,
    reasoning: reasons.join("; ") || "Standard exit plan",
  };
}

// ─── LAYER 13: BEHAVIOR PROTECTION ─────────────────────

interface BehaviorCheck {
  allowed: boolean;
  reason: string;
}

// Track recent entries to detect revenge trading / FOMO
const recentEntries: Array<{ timestamp: number; symbol: string; wasLoss: boolean }> = [];
let consecutiveLossCount = 0;

export function recordEntryOutcome(symbol: string, wasLoss: boolean): void {
  recentEntries.push({ timestamp: Date.now(), symbol, wasLoss });
  if (recentEntries.length > 50) recentEntries.shift();

  if (wasLoss) {
    consecutiveLossCount++;
  } else {
    consecutiveLossCount = 0;
  }
}

function checkBehaviorProtection(
  chaseRisk: number,
  riskLevel: string,
  entryScore: number
): BehaviorCheck {
  const now = Date.now();
  const last30m = recentEntries.filter(e => now - e.timestamp < 30 * 60 * 1000);
  const recentLosses = last30m.filter(e => e.wasLoss);

  // Anti-revenge: if 3+ losses in last 30 minutes, block aggressive entries
  if (recentLosses.length >= 3 && riskLevel !== "low") {
    return { allowed: false, reason: `Revenge trading protection: ${recentLosses.length} losses in 30m` };
  }

  // Anti-FOMO: if chasing + on a loss streak, block
  if (chaseRisk > 50 && consecutiveLossCount >= 2) {
    return { allowed: false, reason: `FOMO protection: chasing (${chaseRisk}) after ${consecutiveLossCount} losses` };
  }

  // Cooldown after rapid entries
  if (last30m.length >= 5) {
    return { allowed: false, reason: `Entry cooldown: ${last30m.length} entries in 30m` };
  }

  return { allowed: true, reason: "" };
}

// ─── MAIN PIPELINE ORCHESTRATOR ─────────────────────────

export function runSignalPipeline(
  pairs: any[],
  learnedAdjustments?: Map<string, number>,
  openSymbols?: string[],
  avoidTokens?: string[],
  portfolioContext?: PortfolioContext
): PipelineResult {
  const now = Date.now();
  const signals: EnrichedSignal[] = [];
  const rejected: PipelineResult["rejected"] = [];
  const stats: PipelineStats = {
    totalScanned: pairs.length,
    hardFiltered: 0,
    scored: 0,
    tierAPlus: 0,
    tierA: 0,
    tierB: 0,
    tierC: 0,
    tierD: 0,
    entryAllowed: 0,
    scamBlocked: 0,
    avgTrustScore: 0,
    avgConvictionScore: 0,
  };

  // Cleanup stale persistence records
  cleanupStaleRecords();

  const defaultPortfolio: PortfolioContext = portfolioContext || {
    openPositionCount: 0,
    maxPositions: 20,
    openChains: [],
    maxSameChain: 5,
    dailyPnlPercent: 0,
    totalEquity: 1000,
    consecutiveLosses: 0,
  };

  for (const pair of pairs) {
    const symbol = pair.baseToken?.symbol?.toUpperCase();
    if (!symbol) continue;

    // Skip if already in position
    if (openSymbols?.includes(symbol)) {
      rejected.push({ symbol, chain: pair.chainId, reasons: ["Already in position"] });
      continue;
    }

    // Skip if on avoid list
    if (avoidTokens?.includes(symbol)) {
      rejected.push({ symbol, chain: pair.chainId, reasons: ["On avoid list"] });
      continue;
    }

    // Check cooldown
    const tokenAddr = pair.baseToken?.address || "";
    const cooldown = isOnCooldown(tokenAddr);
    if (cooldown.cooled) {
      rejected.push({ symbol, chain: pair.chainId, reasons: [`Cooldown: ${cooldown.reason}`] });
      continue;
    }

    // Layer 1: Normalize
    const coin = normalizePair(pair);

    // Layer 2-3: Hard filters + soft penalties
    const filterResult = applyFilters(coin);
    if (!filterResult.passed) {
      stats.hardFiltered++;
      rejected.push({ symbol, chain: pair.chainId, reasons: filterResult.rejectionReasons });
      continue;
    }

    // Layer 4: Persistence tracking
    const persistence = updatePersistence(
      coin.tokenAddress, coin.symbol, coin.chain,
      coin.priceUsd, coin.volumeH1, coin.liquidity, 0
    );
    coin.persistenceScore = persistence.persistenceScore;
    coin.persistenceTrend = persistence.persistenceTrend;
    coin.persistenceScanCount = persistence.scanCount;
    coin.volumeTrend = persistence.volumeTrend;
    coin.liquidityTrend = persistence.liquidityTrend;

    // Layer 5: Tradeability
    const tradeability = computeTradeability(coin);
    coin.tradeabilityScore = tradeability.score;
    coin.tradeabilityGrade = tradeability.grade;

    // Layer 6: Momentum
    const momentum = classifyMomentum(coin);
    coin.momentumQuality = momentum.quality;
    coin.momentumScore = momentum.score;

    // Layer 7: Multi-factor scoring (with penalties + learned adjustments)
    let penalty = filterResult.totalPenalty;
    if (learnedAdjustments && learnedAdjustments.size > 0) {
      const chainAdj = learnedAdjustments.get(`chain:${coin.chain}`) || 0;
      const dexAdj = learnedAdjustments.get(`dex:${coin.dexId}`) || 0;
      let liqKey = "<100K";
      if (coin.liquidity >= 100_000 && coin.liquidity < 500_000) liqKey = "100K-500K";
      else if (coin.liquidity >= 500_000 && coin.liquidity < 1_000_000) liqKey = "500K-1M";
      else if (coin.liquidity >= 1_000_000) liqKey = ">1M";
      const liqAdj = learnedAdjustments.get(`liquidity_range:${liqKey}`) || 0;
      const hour = new Date().getUTCHours();
      let timeKey = "night";
      if (hour >= 6 && hour < 12) timeKey = "morning";
      else if (hour >= 12 && hour < 18) timeKey = "afternoon";
      else if (hour >= 18 && hour < 24) timeKey = "evening";
      const timeAdj = learnedAdjustments.get(`time_of_day:${timeKey}`) || 0;
      const totalAdj = chainAdj + dexAdj + liqAdj + timeAdj;
      if (totalAdj < 0) penalty += Math.abs(totalAdj);
      else penalty = Math.max(0, penalty - totalAdj);
    }

    const scoring = computeScore(coin, penalty);
    coin.compositeScore = scoring.adjustedScore;
    stats.scored++;

    // Update persistence with actual score
    if (persistence.scanHistory.length > 0) {
      persistence.scanHistory[persistence.scanHistory.length - 1].score = scoring.adjustedScore;
    }

    // Layer 8: Entry quality
    const entryQuality = evaluateEntryQuality(coin, tradeability);

    // Layer 9: Scam defense
    const scamDefense = evaluateScamRisk(coin);
    if (scamDefense.blocked) stats.scamBlocked++;

    // Layer 10: Risk assessment
    const risk = assessTokenRisk(coin);

    // Layer 11: Portfolio risk
    const portfolioRisk = evaluatePortfolioRisk(coin, defaultPortfolio);

    // Social & Whale analysis (from existing modules — no extra API calls)
    const socialSignals = extractSocialSignals(pair);
    const { score: socialScore, factors: socialFactors } = calculateSocialScore(socialSignals);
    const socialRiskFlags = getSocialRiskFlags(socialSignals);
    const whaleSignals = analyzeWhaleActivity(pair);
    const { score: whaleScore, factors: whaleFactors } = calculateWhaleScore(whaleSignals);
    const whaleRiskFlags = getWhaleRiskFlags(whaleSignals, pair);

    // Layer 12: Multi-dimensional conviction
    const conviction = computeConviction(
      coin, scoring, entryQuality, scamDefense, risk,
      persistence, tradeability, momentum, portfolioRisk,
      socialScore, socialFactors, socialRiskFlags,
      whaleScore, whaleFactors, whaleRiskFlags
    );

    // Layer 13: Behavior protection
    if (conviction.entryAllowed) {
      const behavior = checkBehaviorProtection(
        entryQuality.chaseRisk,
        risk.riskLevel,
        entryQuality.score
      );
      if (!behavior.allowed) {
        conviction.entryAllowed = false;
        conviction.entryGuidance = "AVOID";
        conviction.blocks.push(behavior.reason);
        conviction.summary = `${coin.symbol}: BLOCKED — ${behavior.reason}`;
      }
    }

    // Track tier stats
    if (conviction.tier === "A+") stats.tierAPlus++;
    else if (conviction.tier === "A") stats.tierA++;
    else if (conviction.tier === "B") stats.tierB++;
    else if (conviction.tier === "C") stats.tierC++;
    else stats.tierD++;
    if (conviction.entryAllowed) stats.entryAllowed++;

    // Build enriched signal
    const signal: EnrichedSignal = {
      ...coin,
      compositeScore: scoring.adjustedScore,
      adjustedScore: scoring.adjustedScore,
      topFactors: scoring.topFactors,
      weakFactors: scoring.weakFactors,
      filterPassed: true,
      filterPenalty: filterResult.totalPenalty,
      filterReasons: filterResult.softPenalties.map(p => p.reason),
      persistenceScore: persistence.persistenceScore,
      persistenceTrend: persistence.persistenceTrend,
      persistenceScanCount: persistence.scanCount,
      tradeabilityScore: tradeability.score,
      tradeabilityGrade: tradeability.grade,
      momentumQuality: momentum.quality,
      momentumScore: momentum.score,
      momentumSignals: momentum.signals,
      riskFlags: risk.flags,
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      entryQuality,
      chaseRisk: entryQuality.chaseRisk,
      overextensionRisk: entryQuality.overextensionRisk,
      scamDefense,
      trustScore: scamDefense.trustScore,
      conviction,
      convictionTier: conviction.tier,
      convictionScore: conviction.convictionScore,
      convictionSummary: conviction.summary,
      entryGuidance: conviction.entryGuidance,
      exitPlan: conviction.exitPlan,
      socialScore,
      socialFactors,
      socialRiskFlags,
      whaleScore,
      whaleFactors,
      whaleRiskFlags,
      portfolioRisk,
      signalTime: now,
    };

    signals.push(signal);
  }

  // Sort by conviction score descending
  signals.sort((a, b) => b.convictionScore - a.convictionScore);

  // Compute averages
  if (signals.length > 0) {
    stats.avgTrustScore = Math.round(
      signals.reduce((s, sig) => s + sig.trustScore, 0) / signals.length
    );
    stats.avgConvictionScore = Math.round(
      signals.reduce((s, sig) => s + sig.convictionScore, 0) / signals.length
    );
  }

  return { signals, rejected, stats };
}

// ─── ENTRY SELECTION ────────────────────────────────────

export function selectForEntry(
  signals: EnrichedSignal[],
  slotsAvailable: number,
  consecutiveLosses?: number
): EnrichedSignal[] {
  // Filter to entry-allowed only
  let candidates = signals.filter(s => s.conviction.entryAllowed);

  // Streak protection: tighten on loss streak
  if (consecutiveLosses && consecutiveLosses >= 3) {
    candidates = candidates.filter(s =>
      s.convictionScore >= 65 &&
      (s.convictionTier === "A+" || s.convictionTier === "A")
    );
  }

  // Already sorted by conviction score
  return candidates.slice(0, slotsAvailable);
}

// ─── POSITION SIZE CALCULATION ──────────────────────────

export function calculatePositionSize(
  signal: EnrichedSignal,
  balance: number,
  kellyMultiplier?: number
): number {
  const sizePercent = signal.conviction.positionSizePercent;
  if (sizePercent <= 0) return 0;

  // Apply Kelly multiplier if available
  let adjustedPercent = sizePercent;
  if (kellyMultiplier !== undefined && kellyMultiplier < 1) {
    adjustedPercent *= kellyMultiplier;
  }

  // Clamp to 1-5% of balance
  const clampedPercent = Math.max(1, Math.min(5, adjustedPercent));
  return balance * (clampedPercent / 100);
}

// ─── PIPELINE STATS EXPORT ──────────────────────────────

let lastPipelineResult: PipelineResult | null = null;

export function getLastPipelineResult(): PipelineResult | null {
  return lastPipelineResult;
}

export function setLastPipelineResult(result: PipelineResult): void {
  lastPipelineResult = result;
}

export function getPersistenceStats(): {
  tracked: number;
  confirmed: number;
  avgScans: number;
} {
  let confirmed = 0;
  let totalScans = 0;
  for (const record of persistenceMap.values()) {
    totalScans += record.scanCount;
    if (record.persistenceTrend === "confirmed") confirmed++;
  }
  return {
    tracked: persistenceMap.size,
    confirmed,
    avgScans: persistenceMap.size > 0 ? Math.round(totalScans / persistenceMap.size * 10) / 10 : 0,
  };
}
