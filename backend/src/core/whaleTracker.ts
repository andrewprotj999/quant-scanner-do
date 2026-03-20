/**
 * Whale Tracking & On-Chain Activity Analysis — Standalone Version
 *
 * Analyzes real-time transaction data from DexScreener to detect
 * patterns of whale activity, institutional buying, and potential
 * coordinated token accumulation or distribution.
 * No external API calls needed — works from DexScreener pair data.
 */

// ─── TYPES ────────────────────────────────────────────────────

export interface WhaleSignals {
  buyRatio: number;
  txnVelocitySpike: boolean;
  avgTxnSize: number;
  volumeAcceleration: boolean;
  largeTradeDetected: boolean;
}

// ─── ANALYSIS FUNCTIONS ──────────────────────────────────────

export function analyzeWhaleActivity(pair: any): WhaleSignals {
  const txns = pair.txns;
  const volume = pair.volume;

  const h1Buys = txns?.h1?.buys ?? 0;
  const h1Sells = txns?.h1?.sells ?? 0;
  const h1TotalTxns = h1Buys + h1Sells;
  const buyRatio = h1TotalTxns > 0 ? h1Buys / h1TotalTxns : 0;

  const m5Txns = (txns?.m5?.buys ?? 0) + (txns?.m5?.sells ?? 0);
  const h1AvgTxnsPer5Min = h1TotalTxns / 12;
  const txnVelocitySpike = m5Txns > h1AvgTxnsPer5Min * 2 && h1AvgTxnsPer5Min > 5;

  const volH1 = volume?.h1 ?? 0;
  const avgTxnSize = h1TotalTxns > 0 ? volH1 / h1TotalTxns : 0;

  const volH6 = volume?.h6 ?? 0;
  const h6AvgVolumePerHour = volH6 / 6;
  const volumeAcceleration = volH1 > h6AvgVolumePerHour * 3 && h6AvgVolumePerHour > 1000;

  const largeTradeDetected = avgTxnSize > 20000;

  return { buyRatio, txnVelocitySpike, avgTxnSize, volumeAcceleration, largeTradeDetected };
}

export function calculateWhaleScore(signals: WhaleSignals): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  if (signals.buyRatio > 0.6) {
    score += 20;
    factors.push("Accumulation (Buy>60%)");
    if (signals.buyRatio > 0.7) { score += 10; factors.push("Strong Accumulation (>70%)"); }
  }

  if (signals.txnVelocitySpike) { score += 15; factors.push("Velocity Spike"); }

  if (signals.avgTxnSize > 5000) {
    score += 15;
    factors.push("Whale Txns (>$5k avg)");
    if (signals.avgTxnSize > 20000) { score += 10; factors.push("Mega-Whale (>$20k)"); }
  }

  if (signals.volumeAcceleration) {
    score += 15;
    factors.push("Volume Acceleration");
    if (signals.avgTxnSize > 10000) { score += 10; factors.push("High-Value Acceleration"); }
  }

  return { score: Math.min(100, score), factors };
}

export function getWhaleRiskFlags(signals: WhaleSignals, pair: any): string[] {
  const flags: string[] = [];
  const txns = pair.txns;

  if (signals.buyRatio < 0.35 && ((txns?.h1?.sells ?? 0) > 20)) flags.push("HEAVY_SELLING");

  const m5Buys = txns?.m5?.buys ?? 0;
  const m5Sells = txns?.m5?.sells ?? 0;
  if (m5Sells > m5Buys * 3 && m5Sells > 10) flags.push("DUMP_PATTERN");

  const h1TotalTxns = (txns?.h1?.buys ?? 0) + (txns?.h1?.sells ?? 0);
  if (h1TotalTxns < 10) flags.push("LOW_ACTIVITY");

  return flags;
}
