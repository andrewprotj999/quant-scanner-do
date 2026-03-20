/**
 * On-Chain Holder Analysis — v4
 *
 * Analyzes token holder distribution patterns to detect:
 * 1. Concentration risk (top holders own too much)
 * 2. Insider accumulation patterns
 * 3. Healthy distribution (many small holders = organic)
 * 4. Rug pull risk indicators
 *
 * Uses DexScreener pair data + transaction patterns as proxy
 * for holder analysis (since on-chain queries are expensive).
 *
 * Proxy signals:
 * - Buy/sell ratio asymmetry → accumulation or distribution
 * - Volume vs liquidity ratio → organic vs manipulated
 * - FDV vs liquidity ratio → fair value assessment
 * - Transaction count distribution → whale vs retail activity
 */

// ─── TYPES ──────────────────────────────────────────────────

export interface HolderAnalysis {
  /** Overall holder health score (0-100, higher = healthier) */
  healthScore: number;
  /** Risk level */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** Position size multiplier based on holder risk */
  sizeMultiplier: number;
  /** Whether to proceed with the trade */
  proceed: boolean;
  /** Detected patterns */
  patterns: string[];
  /** Individual risk components */
  components: {
    concentrationRisk: number;    // 0-100
    distributionHealth: number;   // 0-100
    organicActivity: number;      // 0-100
    rugPullRisk: number;          // 0-100
    insiderActivity: number;      // 0-100
  };
}

// ─── CONSTANTS ──────────────────────────────────────────────

const CRITICAL_RISK_THRESHOLD = 25;   // Below this = don't trade
const HIGH_RISK_THRESHOLD = 40;
const MEDIUM_RISK_THRESHOLD = 60;

// ─── ANALYSIS ───────────────────────────────────────────────

/**
 * Analyze holder distribution patterns from DEX pair data.
 * Uses transaction patterns as proxy for holder analysis.
 */
export function analyzeHolderPatterns(pair: {
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number; h6?: number; m5?: number };
  txns?: {
    h1?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    m5?: { buys?: number; sells?: number };
  };
  fdv?: number;
  pairCreatedAt?: number;
  priceChange?: { h1?: number; h6?: number; h24?: number; m5?: number };
}): HolderAnalysis {
  const patterns: string[] = [];
  const liquidity = pair.liquidity?.usd ?? 0;
  const fdv = pair.fdv ?? 0;
  const h24Volume = pair.volume?.h24 ?? 0;
  const h1Volume = pair.volume?.h1 ?? 0;
  const h6Volume = pair.volume?.h6 ?? 0;
  const pairAge = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : Infinity;

  // ── Component 1: Concentration Risk ──
  // High FDV with low liquidity = concentrated ownership
  let concentrationRisk = 50; // Default medium
  if (fdv > 0 && liquidity > 0) {
    const liqFdvRatio = (liquidity / fdv) * 100;
    if (liqFdvRatio < 0.5) {
      concentrationRisk = 85;
      patterns.push("Very low liquidity/FDV ratio — concentrated ownership likely");
    } else if (liqFdvRatio < 1) {
      concentrationRisk = 70;
      patterns.push("Low liquidity/FDV ratio — moderate concentration");
    } else if (liqFdvRatio < 3) {
      concentrationRisk = 40;
    } else {
      concentrationRisk = 20;
      patterns.push("Good liquidity/FDV ratio — distributed ownership");
    }
  }

  // ── Component 2: Distribution Health ──
  // Healthy = many small transactions; Unhealthy = few large ones
  let distributionHealth = 50;
  const h1Buys = pair.txns?.h1?.buys ?? 0;
  const h1Sells = pair.txns?.h1?.sells ?? 0;
  const totalH1Txns = h1Buys + h1Sells;

  if (totalH1Txns > 0 && h1Volume > 0) {
    const avgTxnSize = h1Volume / totalH1Txns;

    if (avgTxnSize > 5000) {
      distributionHealth = 25;
      patterns.push("Large average transaction size — whale-dominated");
    } else if (avgTxnSize > 1000) {
      distributionHealth = 50;
    } else if (avgTxnSize > 100) {
      distributionHealth = 75;
      patterns.push("Moderate transaction sizes — healthy retail activity");
    } else {
      distributionHealth = 85;
      patterns.push("Small transaction sizes — organic retail distribution");
    }
  }

  // ── Component 3: Organic Activity ──
  // Organic = consistent volume across timeframes; Manipulated = spiky
  let organicActivity = 50;
  if (h24Volume > 0 && h1Volume > 0) {
    const expectedH1 = h24Volume / 24;
    const h1Ratio = h1Volume / expectedH1;

    if (h1Ratio > 5) {
      organicActivity = 30;
      patterns.push("Volume spike — possible manipulation or news event");
    } else if (h1Ratio > 2) {
      organicActivity = 50;
    } else if (h1Ratio >= 0.3) {
      organicActivity = 80;
      patterns.push("Consistent volume — organic trading activity");
    } else {
      organicActivity = 40;
      patterns.push("Volume declining — interest fading");
    }
  }

  // ── Component 4: Rug Pull Risk ──
  let rugPullRisk = 30; // Default low-medium

  // New token + high FDV + low liquidity = rug risk
  if (pairAge < 3600000 && fdv > 1000000 && liquidity < 50000) {
    rugPullRisk = 90;
    patterns.push("DANGER: New token with high FDV and low liquidity — rug risk");
  } else if (pairAge < 86400000 && liquidity < 20000) {
    rugPullRisk = 70;
    patterns.push("New token with very low liquidity — elevated rug risk");
  }

  // Sell pressure dominance
  if (totalH1Txns > 10) {
    const sellRatio = h1Sells / totalH1Txns;
    if (sellRatio > 0.7) {
      rugPullRisk = Math.max(rugPullRisk, 75);
      patterns.push("Heavy sell pressure — possible insider dumping");
    }
  }

  // Price crash with volume
  const h1Change = pair.priceChange?.h1 ?? 0;
  if (h1Change < -20 && h1Volume > liquidity * 0.5) {
    rugPullRisk = Math.max(rugPullRisk, 80);
    patterns.push("Price crash with high volume — possible rug in progress");
  }

  // ── Component 5: Insider Activity ──
  let insiderActivity = 30;

  // Large buys followed by price pump = insider
  const m5Buys = pair.txns?.m5?.buys ?? 0;
  const m5Sells = pair.txns?.m5?.sells ?? 0;
  const m5Change = pair.priceChange?.m5 ?? 0;

  if (m5Buys > 0 && m5Sells === 0 && m5Change > 5) {
    insiderActivity = 70;
    patterns.push("One-sided buying with price pump — possible insider");
  }

  // Very few transactions but high volume = whale activity
  if (totalH1Txns < 10 && h1Volume > 50000) {
    insiderActivity = Math.max(insiderActivity, 65);
    patterns.push("Few transactions but high volume — whale-driven");
  }

  // ── Calculate Overall Health Score ──
  // Invert risk scores to health scores, then weight
  const healthScore = Math.round(
    (100 - concentrationRisk) * 0.25 +
    distributionHealth * 0.25 +
    organicActivity * 0.20 +
    (100 - rugPullRisk) * 0.20 +
    (100 - insiderActivity) * 0.10
  );

  // Determine risk level
  let riskLevel: HolderAnalysis["riskLevel"];
  let sizeMultiplier: number;
  let proceed: boolean;

  if (healthScore < CRITICAL_RISK_THRESHOLD) {
    riskLevel = "critical";
    sizeMultiplier = 0;
    proceed = false;
  } else if (healthScore < HIGH_RISK_THRESHOLD) {
    riskLevel = "high";
    sizeMultiplier = 0.4;
    proceed = true;
  } else if (healthScore < MEDIUM_RISK_THRESHOLD) {
    riskLevel = "medium";
    sizeMultiplier = 0.7;
    proceed = true;
  } else {
    riskLevel = "low";
    sizeMultiplier = 1.0;
    proceed = true;
  }

  return {
    healthScore,
    riskLevel,
    sizeMultiplier,
    proceed,
    patterns,
    components: {
      concentrationRisk,
      distributionHealth,
      organicActivity,
      rugPullRisk,
      insiderActivity,
    },
  };
}

/**
 * Quick holder risk check — returns multiplier and proceed flag.
 */
export function quickHolderCheck(pair: any): { multiplier: number; proceed: boolean; risk: string } {
  const analysis = analyzeHolderPatterns(pair);
  return {
    multiplier: analysis.sizeMultiplier,
    proceed: analysis.proceed,
    risk: analysis.riskLevel,
  };
}
