/**
 * System Guards — v4
 *
 * Three defensive systems that protect the engine from systemic failures:
 *
 * 1. ANTI-FRAGILITY KILL SWITCH
 *    Monitors system health metrics and automatically halts trading
 *    when anomalies are detected (API failures, data corruption, etc.)
 *
 * 2. DATA FEED VALIDATION
 *    Validates incoming data quality before it reaches the engine.
 *    Detects stale data, impossible values, and feed outages.
 *
 * 3. ADAPTIVE SCAN FREQUENCY
 *    Adjusts scan interval based on market conditions:
 *    - High volatility → faster scans (15s)
 *    - Low volatility → slower scans (60s) to save API quota
 *    - API rate limits → back off automatically
 */

import { getDexRateLimiterMetrics } from "./dexRateLimiter.js";

// ─── TYPES ──────────────────────────────────────────────────

export interface SystemHealth {
  /** Overall system health (0-100) */
  healthScore: number;
  /** Whether trading should be allowed */
  tradingAllowed: boolean;
  /** Kill switch triggered */
  killSwitchActive: boolean;
  /** Reasons for any restrictions */
  issues: string[];
  /** Component health */
  components: {
    apiHealth: number;        // 0-100
    dataQuality: number;      // 0-100
    executionHealth: number;   // 0-100
    memoryHealth: number;      // 0-100
  };
  /** Recommended scan interval in ms */
  recommendedScanInterval: number;
}

export interface DataFeedCheck {
  /** Whether the data feed is healthy */
  healthy: boolean;
  /** Issues detected */
  issues: string[];
  /** Data quality score (0-100) */
  qualityScore: number;
}

// ─── STATE ──────────────────────────────────────────────────

let consecutiveApiFailures = 0;
let consecutiveEmptyScans = 0;
let lastSuccessfulScan = Date.now();
let killSwitchTriggeredAt: number | null = null;
let recentScanDurations: number[] = [];
let recentPairCounts: number[] = [];

const MAX_API_FAILURES = 5;        // Kill switch after 5 consecutive API failures
const MAX_EMPTY_SCANS = 10;        // Alert after 10 empty scans
const KILL_SWITCH_COOLDOWN = 300_000; // 5 minute cooldown after kill switch
const MAX_SCAN_DURATION_MS = 120_000; // Alert if scan takes > 2 minutes

// ─── ANTI-FRAGILITY KILL SWITCH ─────────────────────────────

/**
 * Record a successful API call / scan cycle.
 */
export function recordSuccess(pairCount: number, durationMs: number): void {
  consecutiveApiFailures = 0;
  lastSuccessfulScan = Date.now();

  if (pairCount > 0) {
    consecutiveEmptyScans = 0;
  } else {
    consecutiveEmptyScans++;
  }

  // Track recent metrics (keep last 20)
  recentScanDurations.push(durationMs);
  if (recentScanDurations.length > 20) recentScanDurations.shift();

  recentPairCounts.push(pairCount);
  if (recentPairCounts.length > 20) recentPairCounts.shift();
}

/**
 * Record an API failure.
 */
export function recordFailure(): void {
  consecutiveApiFailures++;

  if (consecutiveApiFailures >= MAX_API_FAILURES && !killSwitchTriggeredAt) {
    killSwitchTriggeredAt = Date.now();
    console.error(`[KillSwitch] ACTIVATED — ${consecutiveApiFailures} consecutive API failures`);
  }
}

/**
 * Check if the kill switch should be deactivated (cooldown expired).
 */
function checkKillSwitchCooldown(): boolean {
  if (!killSwitchTriggeredAt) return false;

  if (Date.now() - killSwitchTriggeredAt > KILL_SWITCH_COOLDOWN) {
    console.log("[KillSwitch] Cooldown expired — resuming trading");
    killSwitchTriggeredAt = null;
    consecutiveApiFailures = 0;
    return false;
  }

  return true; // Still in cooldown
}

/**
 * Manually reset the kill switch.
 */
export function resetKillSwitch(): void {
  killSwitchTriggeredAt = null;
  consecutiveApiFailures = 0;
  consecutiveEmptyScans = 0;
  console.log("[KillSwitch] Manually reset");
}

// ─── DATA FEED VALIDATION ───────────────────────────────────

/**
 * Validate a batch of pair data for quality issues.
 */
export function validateDataFeed(pairs: any[]): DataFeedCheck {
  const issues: string[] = [];
  let qualityScore = 100;

  if (pairs.length === 0) {
    return { healthy: false, issues: ["No pairs received"], qualityScore: 0 };
  }

  // Check for impossible values
  let invalidPrices = 0;
  let missingLiquidity = 0;
  let stalePairs = 0;

  for (const pair of pairs) {
    const price = parseFloat(pair.priceUsd ?? "0");
    if (price <= 0 || price > 1e12) invalidPrices++;

    if (!pair.liquidity?.usd || pair.liquidity.usd <= 0) missingLiquidity++;

    // Check if pair has any recent activity
    const m5Txns = (pair.txns?.m5?.buys ?? 0) + (pair.txns?.m5?.sells ?? 0);
    const h1Txns = (pair.txns?.h1?.buys ?? 0) + (pair.txns?.h1?.sells ?? 0);
    if (m5Txns === 0 && h1Txns === 0) stalePairs++;
  }

  const invalidPricePct = (invalidPrices / pairs.length) * 100;
  const missingLiqPct = (missingLiquidity / pairs.length) * 100;
  const stalePct = (stalePairs / pairs.length) * 100;

  if (invalidPricePct > 20) {
    issues.push(`${invalidPricePct.toFixed(0)}% of pairs have invalid prices`);
    qualityScore -= 30;
  }

  if (missingLiqPct > 50) {
    issues.push(`${missingLiqPct.toFixed(0)}% of pairs missing liquidity data`);
    qualityScore -= 20;
  }

  if (stalePct > 70) {
    issues.push(`${stalePct.toFixed(0)}% of pairs appear stale (no recent activity)`);
    qualityScore -= 25;
  }

  // Check for duplicate data (all same price = data feed frozen)
  const uniquePrices = new Set(pairs.map(p => p.priceUsd).filter(Boolean));
  if (uniquePrices.size < Math.min(5, pairs.length * 0.1)) {
    issues.push("Suspiciously few unique prices — data feed may be frozen");
    qualityScore -= 40;
  }

  qualityScore = Math.max(0, qualityScore);

  return {
    healthy: qualityScore >= 50,
    issues,
    qualityScore,
  };
}

// ─── ADAPTIVE SCAN FREQUENCY ────────────────────────────────

/**
 * Calculate optimal scan interval based on current conditions.
 * Returns interval in milliseconds.
 */
export function getAdaptiveScanInterval(
  baseInterval: number = 30_000,
  currentVolatility: "low" | "normal" | "high" | "extreme" = "normal"
): number {
  const rlMetrics = getDexRateLimiterMetrics();

  // Start with base interval
  let interval = baseInterval;

  // Volatility adjustment
  switch (currentVolatility) {
    case "extreme":
      interval = Math.max(15_000, baseInterval * 0.5); // Faster during high vol
      break;
    case "high":
      interval = Math.max(20_000, baseInterval * 0.7);
      break;
    case "normal":
      break; // Use base
    case "low":
      interval = Math.min(90_000, baseInterval * 2); // Slower during low vol
      break;
  }

  // Rate limit backoff
  if (rlMetrics.rateLimitHits > 0) {
    interval = Math.min(120_000, interval * 2); // Double interval if hitting rate limits
  }

  // API failure backoff
  if (consecutiveApiFailures > 0) {
    interval = Math.min(180_000, interval * (1 + consecutiveApiFailures * 0.5));
  }

  // Scan duration adjustment (if scans are slow, space them out)
  if (recentScanDurations.length > 3) {
    const avgDuration = recentScanDurations.reduce((a, b) => a + b, 0) / recentScanDurations.length;
    if (avgDuration > interval * 0.8) {
      interval = Math.max(interval, avgDuration * 1.5); // Don't overlap scans
    }
  }

  return Math.round(interval);
}

/**
 * Determine current market volatility from recent scan data.
 */
export function detectVolatilityLevel(pairs: any[]): "low" | "normal" | "high" | "extreme" {
  if (pairs.length === 0) return "normal";

  // Calculate average absolute price change across all pairs
  let totalAbsChange = 0;
  let count = 0;

  for (const pair of pairs) {
    const h1Change = Math.abs(pair.priceChange?.h1 ?? 0);
    if (h1Change > 0) {
      totalAbsChange += h1Change;
      count++;
    }
  }

  if (count === 0) return "normal";
  const avgAbsChange = totalAbsChange / count;

  if (avgAbsChange > 20) return "extreme";
  if (avgAbsChange > 10) return "high";
  if (avgAbsChange > 3) return "normal";
  return "low";
}

// ─── MASTER HEALTH CHECK ────────────────────────────────────

/**
 * Comprehensive system health check.
 * Call at the start of each engine cycle.
 */
export function checkSystemHealth(): SystemHealth {
  const issues: string[] = [];
  const rlMetrics = getDexRateLimiterMetrics();

  // API health
  let apiHealth = 100;
  if (consecutiveApiFailures > 0) {
    apiHealth -= consecutiveApiFailures * 20;
    issues.push(`${consecutiveApiFailures} consecutive API failures`);
  }
  if (rlMetrics.rateLimitHits > 5) {
    apiHealth -= 20;
    issues.push(`${rlMetrics.rateLimitHits} rate limit hits`);
  }
  apiHealth = Math.max(0, apiHealth);

  // Data quality
  let dataQuality = 100;
  if (consecutiveEmptyScans > 3) {
    dataQuality -= consecutiveEmptyScans * 10;
    issues.push(`${consecutiveEmptyScans} consecutive empty scans`);
  }
  const timeSinceSuccess = Date.now() - lastSuccessfulScan;
  if (timeSinceSuccess > 300_000) { // 5 minutes
    dataQuality -= 30;
    issues.push(`No successful scan in ${(timeSinceSuccess / 60000).toFixed(0)} minutes`);
  }
  dataQuality = Math.max(0, dataQuality);

  // Execution health
  let executionHealth = 100;
  if (recentScanDurations.length > 0) {
    const avgDuration = recentScanDurations.reduce((a, b) => a + b, 0) / recentScanDurations.length;
    if (avgDuration > MAX_SCAN_DURATION_MS) {
      executionHealth -= 30;
      issues.push(`Average scan duration ${(avgDuration / 1000).toFixed(1)}s (max ${MAX_SCAN_DURATION_MS / 1000}s)`);
    }
  }

  // Memory health (basic check)
  let memoryHealth = 100;
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  if (heapUsedMB > 500) {
    memoryHealth = 50;
    issues.push(`High memory usage: ${heapUsedMB.toFixed(0)}MB`);
  } else if (heapUsedMB > 300) {
    memoryHealth = 75;
  }

  // Kill switch check
  const killSwitchActive = checkKillSwitchCooldown() || (killSwitchTriggeredAt !== null);

  if (killSwitchActive) {
    issues.push("Kill switch is active");
  }

  // Overall health
  const healthScore = Math.round(
    apiHealth * 0.35 +
    dataQuality * 0.30 +
    executionHealth * 0.20 +
    memoryHealth * 0.15
  );

  const tradingAllowed = !killSwitchActive && healthScore >= 30;

  return {
    healthScore,
    tradingAllowed,
    killSwitchActive,
    issues,
    components: {
      apiHealth,
      dataQuality,
      executionHealth,
      memoryHealth,
    },
    recommendedScanInterval: getAdaptiveScanInterval(),
  };
}

/**
 * Get current system guard state for API exposure.
 */
export function getSystemGuardState() {
  return {
    consecutiveApiFailures,
    consecutiveEmptyScans,
    lastSuccessfulScan: new Date(lastSuccessfulScan).toISOString(),
    killSwitchActive: killSwitchTriggeredAt !== null,
    killSwitchTriggeredAt: killSwitchTriggeredAt ? new Date(killSwitchTriggeredAt).toISOString() : null,
    recentScanDurations: recentScanDurations.slice(-5),
    recentPairCounts: recentPairCounts.slice(-5),
  };
}
