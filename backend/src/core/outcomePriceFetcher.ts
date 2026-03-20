/**
 * Outcome Price Fetcher — Standalone Version
 *
 * Dedicated price feed for outcome tracking. The signal pipeline's
 * updateOutcomes() only passes prices for tokens in current scan results.
 * But outcome tracking needs prices for ALL tracked tokens (including ones
 * that dropped out of the scan) to complete their checkpoints.
 *
 * This module fetches current prices for all actively tracked outcome
 * tokens using the DexScreener batch API, grouped by chain.
 *
 * Called once per engine cycle, after the signal pipeline runs.
 */

import { dexFetchCached } from "./dexRateLimiter.js";

// ─── CONFIG ─────────────────────────────────────────────────

const DEX_API = "https://api.dexscreener.com";
const BATCH_SIZE = 30;

// ─── TYPES ──────────────────────────────────────────────────

export interface OutcomeRecord {
  tokenAddress: string;
  chain: string;
  signalPrice: number;
  signalTime: number;
  checkpoints: OutcomeCheckpoint[];
  completed: boolean;
}

export interface OutcomeCheckpoint {
  label: string;
  delayMs: number;
  price?: number;
  pnlPercent?: number;
  hitAt?: number;
}

export interface OutcomePriceFetchResult {
  activeOutcomes: number;
  pricesFetched: number;
  pricesNotFound: number;
  checkpointsHit: number;
  outcomesCompleted: number;
  apiCalls: number;
  durationMs: number;
  errors: string[];
}

// ─── IN-MEMORY OUTCOME STORE ────────────────────────────────

const outcomeStore = new Map<string, OutcomeRecord>();

const DEFAULT_CHECKPOINTS: Array<{ label: string; delayMs: number }> = [
  { label: "+5m", delayMs: 5 * 60 * 1000 },
  { label: "+15m", delayMs: 15 * 60 * 1000 },
  { label: "+1h", delayMs: 60 * 60 * 1000 },
  { label: "+4h", delayMs: 4 * 60 * 60 * 1000 },
];

export function trackOutcome(tokenAddress: string, chain: string, signalPrice: number): void {
  const key = tokenAddress.toLowerCase();
  if (outcomeStore.has(key)) return; // Already tracking

  outcomeStore.set(key, {
    tokenAddress,
    chain,
    signalPrice,
    signalTime: Date.now(),
    checkpoints: DEFAULT_CHECKPOINTS.map((cp) => ({
      label: cp.label,
      delayMs: cp.delayMs,
    })),
    completed: false,
  });
}

export function getActiveOutcomes(): OutcomeRecord[] {
  return Array.from(outcomeStore.values()).filter((o) => !o.completed);
}

export function getCompletedOutcomes(): OutcomeRecord[] {
  return Array.from(outcomeStore.values()).filter((o) => o.completed);
}

export function getAllOutcomes(): OutcomeRecord[] {
  return Array.from(outcomeStore.values());
}

export function clearCompletedOutcomes(): number {
  let cleared = 0;
  for (const [key, outcome] of outcomeStore.entries()) {
    if (outcome.completed) {
      outcomeStore.delete(key);
      cleared++;
    }
  }
  return cleared;
}

// ─── UPDATE OUTCOMES WITH PRICES ────────────────────────────

export function updateOutcomes(
  priceUpdates: Array<{ tokenAddress: string; currentPrice: number }>
): { checkpointsHit: number; completed: number } {
  let checkpointsHit = 0;
  let completed = 0;
  const now = Date.now();

  for (const update of priceUpdates) {
    const key = update.tokenAddress.toLowerCase();
    const outcome = outcomeStore.get(key);
    if (!outcome || outcome.completed) continue;

    const elapsed = now - outcome.signalTime;

    for (const cp of outcome.checkpoints) {
      if (cp.price !== undefined) continue; // Already filled
      if (elapsed >= cp.delayMs) {
        cp.price = update.currentPrice;
        cp.pnlPercent = ((update.currentPrice - outcome.signalPrice) / outcome.signalPrice) * 100;
        cp.hitAt = now;
        checkpointsHit++;
      }
    }

    // Check if all checkpoints are filled
    if (outcome.checkpoints.every((cp) => cp.price !== undefined)) {
      outcome.completed = true;
      completed++;
    }
  }

  return { checkpointsHit, completed };
}

// ─── CORE FETCH FUNCTION ────────────────────────────────────

export async function fetchOutcomePrices(): Promise<OutcomePriceFetchResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const activeOutcomes = getActiveOutcomes();

  if (activeOutcomes.length === 0) {
    return {
      activeOutcomes: 0,
      pricesFetched: 0,
      pricesNotFound: 0,
      checkpointsHit: 0,
      outcomesCompleted: 0,
      apiCalls: 0,
      durationMs: Date.now() - startTime,
      errors: [],
    };
  }

  // Group tokens by chain
  const byChain = new Map<string, Set<string>>();
  for (const outcome of activeOutcomes) {
    const chain = outcome.chain || "solana";
    if (!byChain.has(chain)) byChain.set(chain, new Set());
    byChain.get(chain)!.add(outcome.tokenAddress);
  }

  // Build all fetch promises for parallel execution
  const fetchPromises: Array<{
    chainId: string;
    promise: Promise<{ pairs: any[]; chainId: string } | { error: string }>;
  }> = [];

  for (const [chainId, addressSet] of Array.from(byChain.entries())) {
    const addresses = Array.from(addressSet);

    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE).join(",");

      fetchPromises.push({
        chainId,
        promise: dexFetchCached(
          `${DEX_API}/tokens/v1/${chainId}/${batch}`,
          30_000,
          "low"
        )
          .then((data: any) => {
            const pairs = Array.isArray(data) ? data : [];
            return { pairs, chainId };
          })
          .catch((err: any) => {
            return { error: `DexScreener ${chainId} batch error: ${err?.message || "unknown"}` };
          }),
      });
    }
  }

  const apiCalls = fetchPromises.length;

  // Execute all fetches in parallel
  const results = await Promise.allSettled(fetchPromises.map((f) => f.promise));

  // Extract prices
  const priceMap = new Map<string, number>();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const value = result.value;

    if ("error" in value) {
      errors.push(value.error);
      continue;
    }

    for (const pair of value.pairs) {
      if (pair?.baseToken?.address && pair?.priceUsd) {
        const addr = pair.baseToken.address.toLowerCase();
        const price = parseFloat(pair.priceUsd);
        if (price > 0) {
          const existing = priceMap.get(addr);
          if (!existing || price > existing) {
            priceMap.set(addr, price);
          }
        }
      }
    }
  }

  // Build price updates
  const priceUpdates: Array<{ tokenAddress: string; currentPrice: number }> = [];
  let pricesNotFound = 0;

  for (const outcome of activeOutcomes) {
    const addrLower = outcome.tokenAddress.toLowerCase();
    const price = priceMap.get(addrLower);

    if (price && price > 0) {
      priceUpdates.push({ tokenAddress: outcome.tokenAddress, currentPrice: price });
    } else {
      pricesNotFound++;
    }
  }

  // Feed prices into outcome tracking
  let checkpointsHit = 0;
  let outcomesCompleted = 0;

  if (priceUpdates.length > 0) {
    const result = updateOutcomes(priceUpdates);
    checkpointsHit = result.checkpointsHit;
    outcomesCompleted = result.completed;
  }

  const durationMs = Date.now() - startTime;

  if (activeOutcomes.length > 0) {
    const parts = [
      `[OutcomePriceFetcher] ${activeOutcomes.length} active`,
      `${priceUpdates.length} fetched`,
      `${pricesNotFound} not found`,
      `${checkpointsHit} checkpoints`,
      `${outcomesCompleted} completed`,
      `${apiCalls} API calls`,
      `${durationMs}ms`,
    ];
    if (errors.length > 0) parts.push(`${errors.length} errors`);
    console.log(parts.join(" | "));
  }

  return {
    activeOutcomes: activeOutcomes.length,
    pricesFetched: priceUpdates.length,
    pricesNotFound,
    checkpointsHit,
    outcomesCompleted,
    apiCalls,
    durationMs,
    errors,
  };
}
