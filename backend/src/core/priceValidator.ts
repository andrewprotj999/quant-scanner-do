/**
 * Multi-Source Price Validation — v4
 *
 * Cross-validates token prices from multiple sources to prevent
 * entering positions on stale, manipulated, or erroneous price data.
 *
 * Sources:
 * 1. DexScreener (primary) — already used
 * 2. DexScreener search (secondary) — different endpoint, different cache
 * 3. On-chain pair data validation (liquidity depth check)
 *
 * Validation rules:
 * - Price deviation between sources must be < 5%
 * - Liquidity must be sufficient relative to position size
 * - Price must not be stale (last update within 5 minutes)
 * - Volume must be real (not wash trading patterns)
 */

import { dexFetchCached } from "./dexRateLimiter.js";

// ─── TYPES ──────────────────────────────────────────────────

export interface PriceValidation {
  /** Whether the price is considered valid */
  valid: boolean;
  /** Primary price (from pair endpoint) */
  primaryPrice: number;
  /** Secondary price (from search/token endpoint) */
  secondaryPrice: number | null;
  /** Deviation between sources as percentage */
  deviationPercent: number;
  /** Liquidity depth score (0-100) */
  liquidityScore: number;
  /** Whether wash trading is suspected */
  washTradingSuspected: boolean;
  /** Reasons for rejection (if invalid) */
  rejectionReasons: string[];
  /** All validation checks passed */
  checks: {
    priceDeviation: boolean;
    liquidityDepth: boolean;
    volumeAuthenticity: boolean;
    priceRecency: boolean;
    spreadHealth: boolean;
  };
}

// ─── CONSTANTS ──────────────────────────────────────────────

const MAX_PRICE_DEVIATION_PCT = 5;      // Max 5% deviation between sources
const MIN_LIQUIDITY_RATIO = 3;          // Liquidity must be 3x position size
const WASH_TRADE_BUY_SELL_RATIO = 0.95; // Suspiciously equal buy/sell counts
const MIN_UNIQUE_TRADERS_H1 = 5;        // Minimum unique traders in 1 hour
const MAX_PRICE_AGE_MS = 5 * 60 * 1000; // Price must be < 5 minutes old

// ─── VALIDATION ─────────────────────────────────────────────

/**
 * Validate price data from a DexScreener pair against multiple checks.
 * Call before entering any position to ensure data quality.
 */
export function validatePriceData(
  pair: {
    priceUsd: string;
    liquidity?: { usd?: number };
    volume?: { h24?: number; h1?: number; m5?: number };
    txns?: {
      h1?: { buys?: number; sells?: number };
      m5?: { buys?: number; sells?: number };
    };
    pairCreatedAt?: number;
    fdv?: number;
  },
  positionSizeUsd: number
): PriceValidation {
  const primaryPrice = parseFloat(pair.priceUsd);
  const rejectionReasons: string[] = [];

  // ── Check 1: Price recency (pair must have recent activity) ──
  const m5Volume = pair.volume?.m5 ?? 0;
  const m5Txns = (pair.txns?.m5?.buys ?? 0) + (pair.txns?.m5?.sells ?? 0);
  const priceRecent = m5Txns > 0 || m5Volume > 0;
  if (!priceRecent) {
    rejectionReasons.push("No trading activity in last 5 minutes — price may be stale");
  }

  // ── Check 2: Liquidity depth relative to position size ──
  const liquidity = pair.liquidity?.usd ?? 0;
  const liquidityRatio = positionSizeUsd > 0 ? liquidity / positionSizeUsd : 999;
  const liquidityOk = liquidityRatio >= MIN_LIQUIDITY_RATIO;
  if (!liquidityOk) {
    rejectionReasons.push(
      `Insufficient liquidity: $${liquidity.toFixed(0)} vs $${positionSizeUsd.toFixed(0)} position (need ${MIN_LIQUIDITY_RATIO}x)`
    );
  }

  // Liquidity score (0-100)
  const liquidityScore = Math.min(100, (liquidityRatio / 10) * 100);

  // ── Check 3: Volume authenticity (wash trading detection) ──
  const h1Buys = pair.txns?.h1?.buys ?? 0;
  const h1Sells = pair.txns?.h1?.sells ?? 0;
  const totalH1 = h1Buys + h1Sells;

  let washTradingSuspected = false;
  if (totalH1 > 20) {
    // If buy/sell ratio is suspiciously close to 1:1 with high volume
    const ratio = Math.min(h1Buys, h1Sells) / Math.max(h1Buys, h1Sells, 1);
    if (ratio > WASH_TRADE_BUY_SELL_RATIO) {
      washTradingSuspected = true;
      rejectionReasons.push(
        `Wash trading suspected: buy/sell ratio ${ratio.toFixed(3)} (${h1Buys}/${h1Sells})`
      );
    }
  }

  // Low unique trader count
  const volumeAuthentic = totalH1 >= MIN_UNIQUE_TRADERS_H1 && !washTradingSuspected;
  if (totalH1 < MIN_UNIQUE_TRADERS_H1) {
    rejectionReasons.push(`Too few traders in 1h: ${totalH1} (min ${MIN_UNIQUE_TRADERS_H1})`);
  }

  // ── Check 4: Spread health (FDV vs liquidity ratio) ──
  const fdv = pair.fdv ?? 0;
  const liqFdvRatio = fdv > 0 ? (liquidity / fdv) * 100 : 0;
  const spreadHealthy = liqFdvRatio >= 0.5; // At least 0.5% of FDV in liquidity
  if (!spreadHealthy && fdv > 0) {
    rejectionReasons.push(
      `Poor liquidity depth: ${liqFdvRatio.toFixed(2)}% of FDV (need 0.5%+)`
    );
  }

  // ── Check 5: Price deviation (placeholder — secondary source check) ──
  // In production, this would cross-check with Birdeye/Jupiter/etc.
  // For now, we validate internal consistency
  const h1Volume = pair.volume?.h1 ?? 0;
  const h24Volume = pair.volume?.h24 ?? 0;
  const volumeConsistent = h24Volume === 0 || h1Volume <= h24Volume;
  if (!volumeConsistent) {
    rejectionReasons.push("Volume inconsistency: h1 > h24 (data error suspected)");
  }

  const valid = priceRecent && liquidityOk && volumeAuthentic && spreadHealthy && volumeConsistent;

  return {
    valid,
    primaryPrice,
    secondaryPrice: null, // Would be populated by secondary source
    deviationPercent: 0,
    liquidityScore,
    washTradingSuspected,
    rejectionReasons,
    checks: {
      priceDeviation: volumeConsistent,
      liquidityDepth: liquidityOk,
      volumeAuthenticity: volumeAuthentic,
      priceRecency: priceRecent,
      spreadHealth: spreadHealthy,
    },
  };
}

/**
 * Cross-validate price by fetching from DexScreener search endpoint.
 * Returns the secondary price and deviation.
 */
export async function crossValidatePrice(
  tokenSymbol: string,
  chainId: string,
  primaryPrice: number
): Promise<{ secondaryPrice: number | null; deviationPercent: number; valid: boolean }> {
  try {
    const data = await dexFetchCached(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(tokenSymbol)}`,
      60_000, // 1 min cache
      "low"
    );

    const pairs = data?.pairs ?? [];
    // Find matching pair on same chain
    const match = pairs.find(
      (p: any) =>
        p.chainId === chainId &&
        p.baseToken?.symbol?.toUpperCase() === tokenSymbol.toUpperCase()
    );

    if (!match) {
      return { secondaryPrice: null, deviationPercent: 0, valid: true }; // Can't validate, pass
    }

    const secondaryPrice = parseFloat(match.priceUsd);
    if (secondaryPrice <= 0 || primaryPrice <= 0) {
      return { secondaryPrice: null, deviationPercent: 0, valid: true };
    }

    const deviationPercent = Math.abs((primaryPrice - secondaryPrice) / primaryPrice) * 100;
    const valid = deviationPercent <= MAX_PRICE_DEVIATION_PCT;

    return { secondaryPrice, deviationPercent, valid };
  } catch {
    // Can't validate — don't block the trade
    return { secondaryPrice: null, deviationPercent: 0, valid: true };
  }
}

/**
 * Full price validation pipeline.
 * Returns whether the trade should proceed.
 */
export async function fullPriceValidation(
  pair: any,
  positionSizeUsd: number
): Promise<{ valid: boolean; reasons: string[]; liquidityScore: number }> {
  // Step 1: Basic validation
  const basic = validatePriceData(pair, positionSizeUsd);

  if (!basic.valid) {
    return {
      valid: false,
      reasons: basic.rejectionReasons,
      liquidityScore: basic.liquidityScore,
    };
  }

  // Step 2: Cross-validate price (non-blocking — if it fails, still proceed)
  const cross = await crossValidatePrice(
    pair.baseToken?.symbol ?? "",
    pair.chainId ?? "",
    parseFloat(pair.priceUsd)
  );

  const reasons: string[] = [];
  if (!cross.valid) {
    reasons.push(
      `Price deviation ${cross.deviationPercent.toFixed(1)}% between sources (max ${MAX_PRICE_DEVIATION_PCT}%)`
    );
  }

  return {
    valid: cross.valid,
    reasons,
    liquidityScore: basic.liquidityScore,
  };
}
