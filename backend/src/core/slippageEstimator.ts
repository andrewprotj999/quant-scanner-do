/**
 * Slippage Estimation — v4
 *
 * Estimates expected slippage for a given trade size based on:
 * 1. Liquidity depth (USD in pool)
 * 2. Position size relative to liquidity
 * 3. Recent volume (higher volume = tighter spreads)
 * 4. Token age (newer tokens have worse liquidity)
 *
 * Uses constant-product AMM formula approximation:
 * slippage ≈ (tradeSize / (2 * liquidity)) * 100
 *
 * This is critical for:
 * - Adjusting entry/exit prices to account for real execution
 * - Avoiding tokens where slippage would eat all profit
 * - Sizing positions appropriately for available liquidity
 * - Preparing for live trading where slippage is real money
 */

// ─── TYPES ──────────────────────────────────────────────────

export interface SlippageEstimate {
  /** Estimated slippage in percentage */
  slippagePercent: number;
  /** Estimated slippage in USD */
  slippageUsd: number;
  /** Whether the trade is executable at this size */
  executable: boolean;
  /** Maximum recommended position size for < 2% slippage */
  maxRecommendedSize: number;
  /** Slippage tier for logging */
  tier: "negligible" | "acceptable" | "high" | "extreme" | "untradeable";
  /** Adjusted entry price accounting for slippage */
  adjustedEntryPrice: number;
  /** Adjusted exit price accounting for slippage (for P&L calculation) */
  adjustedExitPrice: number;
  /** Impact on expected P&L */
  roundTripSlippagePct: number;
}

// ─── CONSTANTS ──────────────────────────────────────────────

const SLIPPAGE_TIERS = {
  negligible: { max: 0.5, multiplier: 1.0 },
  acceptable: { max: 1.5, multiplier: 0.95 },
  high:       { max: 3.0, multiplier: 0.8 },
  extreme:    { max: 5.0, multiplier: 0.5 },
  untradeable: { max: Infinity, multiplier: 0 },
};

const MAX_ACCEPTABLE_SLIPPAGE = 3.0; // Don't enter if slippage > 3%
const TARGET_SLIPPAGE = 1.5;          // Target < 1.5% slippage

// ─── ESTIMATION ─────────────────────────────────────────────

/**
 * Estimate slippage for a given trade on a DEX pair.
 *
 * Uses constant-product AMM approximation:
 * For a trade of size `dx` against a pool of liquidity `L`:
 * slippage ≈ dx / (2 * L) * 100
 *
 * Adjustments:
 * - Low volume penalty: if h1 volume < 2x trade size, add 50% to estimate
 * - New token penalty: if < 1 hour old, add 30% to estimate
 * - Multi-hop penalty: if not direct pair, add 20%
 */
export function estimateSlippage(
  tradeSizeUsd: number,
  pair: {
    priceUsd: string;
    liquidity?: { usd?: number };
    volume?: { h1?: number; h24?: number; m5?: number };
    pairCreatedAt?: number;
    dexId?: string;
  }
): SlippageEstimate {
  const price = parseFloat(pair.priceUsd);
  const liquidity = pair.liquidity?.usd ?? 0;
  const h1Volume = pair.volume?.h1 ?? 0;
  const pairAge = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : Infinity;

  // Base slippage from constant-product formula
  let slippagePct = liquidity > 0 ? (tradeSizeUsd / (2 * liquidity)) * 100 : 50;

  // Low volume penalty
  if (h1Volume > 0 && h1Volume < tradeSizeUsd * 2) {
    slippagePct *= 1.5;
  }

  // New token penalty (< 1 hour old)
  if (pairAge < 3600000) {
    slippagePct *= 1.3;
  }

  // Very low liquidity penalty (< $10k)
  if (liquidity < 10000) {
    slippagePct *= 2.0;
  }

  // Clamp
  slippagePct = Math.max(0, Math.min(50, slippagePct));

  const slippageUsd = tradeSizeUsd * (slippagePct / 100);
  const roundTripSlippage = slippagePct * 2; // Entry + exit

  // Determine tier
  let tier: SlippageEstimate["tier"];
  if (slippagePct <= SLIPPAGE_TIERS.negligible.max) tier = "negligible";
  else if (slippagePct <= SLIPPAGE_TIERS.acceptable.max) tier = "acceptable";
  else if (slippagePct <= SLIPPAGE_TIERS.high.max) tier = "high";
  else if (slippagePct <= SLIPPAGE_TIERS.extreme.max) tier = "extreme";
  else tier = "untradeable";

  // Maximum recommended size for target slippage
  const maxRecommendedSize = liquidity > 0
    ? (TARGET_SLIPPAGE / 100) * 2 * liquidity
    : 0;

  // Adjusted prices
  const adjustedEntryPrice = price * (1 + slippagePct / 100);
  const adjustedExitPrice = price * (1 - slippagePct / 100);

  return {
    slippagePercent: slippagePct,
    slippageUsd,
    executable: slippagePct <= MAX_ACCEPTABLE_SLIPPAGE,
    maxRecommendedSize,
    tier,
    adjustedEntryPrice,
    adjustedExitPrice,
    roundTripSlippagePct: roundTripSlippage,
  };
}

/**
 * Get the maximum position size that keeps slippage under the target.
 */
export function getMaxPositionForSlippage(
  liquidity: number,
  targetSlippagePct: number = TARGET_SLIPPAGE
): number {
  return (targetSlippagePct / 100) * 2 * liquidity;
}

/**
 * Adjust position size down if it would cause excessive slippage.
 * Returns the adjusted size (may be the same if slippage is acceptable).
 */
export function adjustPositionForSlippage(
  proposedSize: number,
  pair: {
    priceUsd: string;
    liquidity?: { usd?: number };
    volume?: { h1?: number; h24?: number; m5?: number };
    pairCreatedAt?: number;
    dexId?: string;
  }
): { adjustedSize: number; wasReduced: boolean; slippage: SlippageEstimate } {
  const slippage = estimateSlippage(proposedSize, pair);

  if (slippage.executable) {
    return { adjustedSize: proposedSize, wasReduced: false, slippage };
  }

  // Reduce to max recommended size
  const adjustedSize = Math.min(proposedSize, slippage.maxRecommendedSize);

  // Re-estimate with adjusted size
  const adjustedSlippage = estimateSlippage(adjustedSize, pair);

  return {
    adjustedSize: Math.max(1, adjustedSize), // Minimum $1
    wasReduced: true,
    slippage: adjustedSlippage,
  };
}
