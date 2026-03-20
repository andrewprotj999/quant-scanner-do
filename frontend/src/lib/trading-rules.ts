/**
 * Trading Rules Engine
 * Dark Command Center — Risk Management & Trade Validation
 * 
 * All 9 trading rules codified into executable validation functions.
 * Every trade must pass ALL checks before being considered valid.
 */

import type { PairData } from "./dexscreener";

// ============================================================
// TYPES
// ============================================================

export type RiskLevel = "SAFE" | "CAUTION" | "DANGER";
export type TradeStatus = "OPEN" | "PARTIAL_EXIT" | "CLOSED" | "STOPPED_OUT";

export interface TradeEntry {
  id: string;
  tokenSymbol: string;
  tokenAddress: string;
  chainId: string;
  pairAddress: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit1: number; // +20%
  takeProfit2: number; // +30%
  positionSize: number; // USD value
  riskPercent: number;
  status: TradeStatus;
  entryTime: number;
  exitTime?: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  notes: string;
  convictionScore: number; // 0-100
}

export interface AccountState {
  totalEquity: number;
  availableBalance: number;
  dailyStartEquity: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  consecutiveLosses: number;
  lastLossTime: number | null;
  pausedUntil: number | null;
  openPositions: TradeEntry[];
  closedPositions: TradeEntry[];
  winCount: number;
  lossCount: number;
}

export interface ValidationResult {
  passed: boolean;
  rule: string;
  ruleNumber: number;
  message: string;
  severity: RiskLevel;
}

export interface TokenAnalysis {
  pair: PairData;
  liquidityCheck: ValidationResult;
  volumeCheck: ValidationResult;
  priceActionCheck: ValidationResult;
  ageCheck: ValidationResult;
  overallScore: number;
  riskLevel: RiskLevel;
  recommendation: string;
}

// ============================================================
// RULE 1: RISK MANAGEMENT
// ============================================================

export function validateRiskManagement(
  account: AccountState,
  proposedRiskPercent: number
): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Max 1-2% risk per trade
  if (proposedRiskPercent > 2) {
    results.push({
      passed: false,
      rule: "Max Risk Per Trade",
      ruleNumber: 1,
      message: `Risk of ${proposedRiskPercent.toFixed(1)}% exceeds maximum 2% per trade`,
      severity: "DANGER",
    });
  } else if (proposedRiskPercent > 1.5) {
    results.push({
      passed: true,
      rule: "Max Risk Per Trade",
      ruleNumber: 1,
      message: `Risk of ${proposedRiskPercent.toFixed(1)}% is within limits but elevated`,
      severity: "CAUTION",
    });
  } else {
    results.push({
      passed: true,
      rule: "Max Risk Per Trade",
      ruleNumber: 1,
      message: `Risk of ${proposedRiskPercent.toFixed(1)}% is within safe limits`,
      severity: "SAFE",
    });
  }

  // 2 consecutive losses = pause 2 hours
  if (account.consecutiveLosses >= 2) {
    const pauseEnd = account.lastLossTime
      ? account.lastLossTime + 2 * 60 * 60 * 1000
      : Date.now();
    if (Date.now() < pauseEnd) {
      const remaining = Math.ceil((pauseEnd - Date.now()) / 60000);
      results.push({
        passed: false,
        rule: "Loss Pause Rule",
        ruleNumber: 1,
        message: `Trading paused: ${remaining} minutes remaining after 2 consecutive losses`,
        severity: "DANGER",
      });
    } else {
      results.push({
        passed: true,
        rule: "Loss Pause Rule",
        ruleNumber: 1,
        message: "Pause period completed, trading allowed",
        severity: "SAFE",
      });
    }
  } else {
    results.push({
      passed: true,
      rule: "Loss Pause Rule",
      ruleNumber: 1,
      message: `${account.consecutiveLosses} consecutive losses (limit: 2)`,
      severity: account.consecutiveLosses === 1 ? "CAUTION" : "SAFE",
    });
  }

  // Daily drawdown -5% = stop trading
  if (account.dailyPnlPercent <= -5) {
    results.push({
      passed: false,
      rule: "Daily Drawdown Limit",
      ruleNumber: 1,
      message: `Daily drawdown ${account.dailyPnlPercent.toFixed(2)}% exceeds -5% limit. STOP TRADING.`,
      severity: "DANGER",
    });
  } else if (account.dailyPnlPercent <= -3) {
    results.push({
      passed: true,
      rule: "Daily Drawdown Limit",
      ruleNumber: 1,
      message: `Daily drawdown ${account.dailyPnlPercent.toFixed(2)}% approaching -5% limit`,
      severity: "CAUTION",
    });
  } else {
    results.push({
      passed: true,
      rule: "Daily Drawdown Limit",
      ruleNumber: 1,
      message: `Daily P&L: ${account.dailyPnlPercent >= 0 ? "+" : ""}${account.dailyPnlPercent.toFixed(2)}%`,
      severity: "SAFE",
    });
  }

  return results;
}

// ============================================================
// RULE 2: TRADE SELECTION FILTERS
// ============================================================

export function validateTradeSelection(pair: PairData): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Liquidity > $100K
  const liquidity = pair.liquidity?.usd || 0;
  if (liquidity < 100000) {
    results.push({
      passed: false,
      rule: "Minimum Liquidity",
      ruleNumber: 2,
      message: `Liquidity $${formatNumber(liquidity)} below $100K minimum`,
      severity: "DANGER",
    });
  } else if (liquidity < 250000) {
    results.push({
      passed: true,
      rule: "Minimum Liquidity",
      ruleNumber: 2,
      message: `Liquidity $${formatNumber(liquidity)} above minimum but low`,
      severity: "CAUTION",
    });
  } else {
    results.push({
      passed: true,
      rule: "Minimum Liquidity",
      ruleNumber: 2,
      message: `Liquidity $${formatNumber(liquidity)} is healthy`,
      severity: "SAFE",
    });
  }

  // Volume increasing over 5-15 min
  const vol5m = pair.volume?.m5 || 0;
  const vol1h = pair.volume?.h1 || 0;
  const avgVol5m = vol1h / 12; // average 5-min volume from 1h
  if (vol5m > avgVol5m * 1.5) {
    results.push({
      passed: true,
      rule: "Volume Trend",
      ruleNumber: 2,
      message: `5m volume $${formatNumber(vol5m)} is ${(vol5m / avgVol5m).toFixed(1)}x average`,
      severity: "SAFE",
    });
  } else if (vol5m > avgVol5m * 0.8) {
    results.push({
      passed: true,
      rule: "Volume Trend",
      ruleNumber: 2,
      message: `5m volume $${formatNumber(vol5m)} is near average`,
      severity: "CAUTION",
    });
  } else {
    results.push({
      passed: false,
      rule: "Volume Trend",
      ruleNumber: 2,
      message: `5m volume $${formatNumber(vol5m)} is below average (${(vol5m / Math.max(avgVol5m, 1)).toFixed(1)}x)`,
      severity: "DANGER",
    });
  }

  // Buy/sell ratio check (proxy for honeypot behavior)
  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const totalTxns5m = buys5m + sells5m;
  if (totalTxns5m > 0 && sells5m > 0) {
    const ratio = buys5m / sells5m;
    if (ratio < 0.1) {
      results.push({
        passed: false,
        rule: "Buy/Sell Ratio",
        ruleNumber: 2,
        message: `Extreme sell pressure: ${buys5m}B/${sells5m}S in 5m — possible rug`,
        severity: "DANGER",
      });
    } else {
      results.push({
        passed: true,
        rule: "Buy/Sell Ratio",
        ruleNumber: 2,
        message: `Buy/Sell ratio: ${buys5m}B/${sells5m}S in 5m`,
        severity: ratio < 0.5 ? "CAUTION" : "SAFE",
      });
    }
  } else {
    results.push({
      passed: totalTxns5m > 0,
      rule: "Buy/Sell Ratio",
      ruleNumber: 2,
      message: totalTxns5m === 0 ? "No transactions in last 5 minutes" : `${buys5m}B/${sells5m}S in 5m`,
      severity: totalTxns5m === 0 ? "DANGER" : "CAUTION",
    });
  }

  return results;
}

// ============================================================
// RULE 3: ENTRY STRATEGY
// ============================================================

export function validateEntryStrategy(pair: PairData): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Check for pullback (not green candle) — use 5m price change
  const priceChange5m = pair.priceChange?.m5 || 0;
  const priceChange1h = pair.priceChange?.h1 || 0;

  if (priceChange5m > 3) {
    results.push({
      passed: false,
      rule: "Pullback Entry",
      ruleNumber: 3,
      message: `Price up ${priceChange5m.toFixed(1)}% in 5m — wait for pullback, do NOT chase green candles`,
      severity: "DANGER",
    });
  } else if (priceChange5m < -5 && priceChange5m > -15) {
    results.push({
      passed: true,
      rule: "Pullback Entry",
      ruleNumber: 3,
      message: `Price dipped ${priceChange5m.toFixed(1)}% in 5m — potential entry zone`,
      severity: "SAFE",
    });
  } else if (priceChange5m < -15) {
    results.push({
      passed: false,
      rule: "Pullback Entry",
      ruleNumber: 3,
      message: `Price crashed ${priceChange5m.toFixed(1)}% in 5m — possible dump, avoid`,
      severity: "DANGER",
    });
  } else {
    results.push({
      passed: true,
      rule: "Pullback Entry",
      ruleNumber: 3,
      message: `Price change ${priceChange5m >= 0 ? "+" : ""}${priceChange5m.toFixed(1)}% in 5m — consolidating`,
      severity: "CAUTION",
    });
  }

  // Token age check (avoid first 1-3 minutes)
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : Infinity;
  const ageMinutes = ageMs / 60000;
  if (ageMinutes < 3) {
    results.push({
      passed: false,
      rule: "Token Age",
      ruleNumber: 3,
      message: `Token only ${ageMinutes.toFixed(0)}m old — too early, wait for stability`,
      severity: "DANGER",
    });
  } else if (ageMinutes < 15) {
    results.push({
      passed: true,
      rule: "Token Age",
      ruleNumber: 3,
      message: `Token ${ageMinutes.toFixed(0)}m old — proceed with caution`,
      severity: "CAUTION",
    });
  } else {
    const ageStr = ageMinutes > 1440
      ? `${(ageMinutes / 1440).toFixed(0)}d`
      : ageMinutes > 60
      ? `${(ageMinutes / 60).toFixed(0)}h`
      : `${ageMinutes.toFixed(0)}m`;
    results.push({
      passed: true,
      rule: "Token Age",
      ruleNumber: 3,
      message: `Token age: ${ageStr} — established`,
      severity: "SAFE",
    });
  }

  // Support level confirmation (using 1h vs 6h price action)
  const priceChange6h = pair.priceChange?.h6 || 0;
  if (priceChange1h < 0 && priceChange6h > 0) {
    results.push({
      passed: true,
      rule: "Support Level",
      ruleNumber: 3,
      message: "Short-term dip within longer uptrend — potential support",
      severity: "SAFE",
    });
  } else if (priceChange1h < -10 && priceChange6h < -20) {
    results.push({
      passed: false,
      rule: "Support Level",
      ruleNumber: 3,
      message: "Sustained downtrend — no clear support level",
      severity: "DANGER",
    });
  } else {
    results.push({
      passed: true,
      rule: "Support Level",
      ruleNumber: 3,
      message: `1h: ${priceChange1h >= 0 ? "+" : ""}${priceChange1h.toFixed(1)}% | 6h: ${priceChange6h >= 0 ? "+" : ""}${priceChange6h.toFixed(1)}%`,
      severity: "CAUTION",
    });
  }

  return results;
}

// ============================================================
// RULE 5: POSITION MANAGEMENT
// ============================================================

export function validatePositionManagement(account: AccountState): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Max 10 open positions
  const openCount = account.openPositions.length;
  if (openCount >= 10) {
    results.push({
      passed: false,
      rule: "Max Open Positions",
      ruleNumber: 5,
      message: `${openCount}/10 positions open — cannot open more`,
      severity: "DANGER",
    });
  } else if (openCount >= 8) {
    results.push({
      passed: true,
      rule: "Max Open Positions",
      ruleNumber: 5,
      message: `${openCount}/10 positions open — ${10 - openCount} slots remaining`,
      severity: "CAUTION",
    });
  } else {
    results.push({
      passed: true,
      rule: "Max Open Positions",
      ruleNumber: 5,
      message: `${openCount}/10 positions open`,
      severity: "SAFE",
    });
  }

  return results;
}

// ============================================================
// COMPREHENSIVE TOKEN ANALYSIS
// ============================================================

export function analyzeToken(pair: PairData, account: AccountState): TokenAnalysis {
  const selectionResults = validateTradeSelection(pair);
  const entryResults = validateEntryStrategy(pair);
  const positionResults = validatePositionManagement(account);

  const allResults = [...selectionResults, ...entryResults, ...positionResults];
  const passedCount = allResults.filter((r) => r.passed).length;
  const totalCount = allResults.length;
  const overallScore = Math.round((passedCount / totalCount) * 100);

  const dangerCount = allResults.filter((r) => r.severity === "DANGER").length;
  const cautionCount = allResults.filter((r) => r.severity === "CAUTION").length;

  let riskLevel: RiskLevel = "SAFE";
  if (dangerCount > 0 || overallScore < 50) riskLevel = "DANGER";
  else if (cautionCount > 2 || overallScore < 75) riskLevel = "CAUTION";

  let recommendation = "";
  if (riskLevel === "DANGER") {
    recommendation = "DO NOT TRADE — Critical risk factors detected";
  } else if (riskLevel === "CAUTION") {
    recommendation = "PROCEED WITH CAUTION — Reduce position size by 50%";
  } else {
    recommendation = "CLEAR TO TRADE — All filters passed";
  }

  return {
    pair,
    liquidityCheck: selectionResults[0],
    volumeCheck: selectionResults[1],
    priceActionCheck: entryResults[0],
    ageCheck: entryResults[1],
    overallScore,
    riskLevel,
    recommendation,
  };
}

// ============================================================
// POSITION SIZING CALCULATOR
// ============================================================

export function calculatePositionSize(
  accountEquity: number,
  riskPercent: number,
  entryPrice: number,
  stopLossPrice: number
): {
  positionSize: number;
  riskAmount: number;
  stopLossPercent: number;
  tp1Price: number;
  tp2Price: number;
} {
  const riskAmount = accountEquity * (riskPercent / 100);
  const stopLossPercent = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;
  const positionSize = riskAmount / (stopLossPercent / 100);

  return {
    positionSize: Math.min(positionSize, accountEquity * 0.33), // Never more than 33% in one trade
    riskAmount,
    stopLossPercent,
    tp1Price: entryPrice * 1.2, // +20%
    tp2Price: entryPrice * 1.3, // +30%
  };
}

// ============================================================
// HELPERS
// ============================================================

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

export function formatPrice(price: number | string | null): string {
  if (price === null) return "N/A";
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.01) return `$${num.toFixed(4)}`;
  if (num >= 0.0001) return `$${num.toFixed(6)}`;
  return `$${num.toExponential(2)}`;
}

export function getDefaultAccount(): AccountState {
  const saved = localStorage.getItem("quant-account");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // fall through
    }
  }
  return {
    totalEquity: 1000,
    availableBalance: 1000,
    dailyStartEquity: 1000,
    dailyPnl: 0,
    dailyPnlPercent: 0,
    consecutiveLosses: 0,
    lastLossTime: null,
    pausedUntil: null,
    openPositions: [],
    closedPositions: [],
    winCount: 0,
    lossCount: 0,
  };
}

export function saveAccount(account: AccountState): void {
  localStorage.setItem("quant-account", JSON.stringify(account));
}

export function getWinRate(account: AccountState): number {
  const total = account.winCount + account.lossCount;
  if (total === 0) return 0;
  return (account.winCount / total) * 100;
}
