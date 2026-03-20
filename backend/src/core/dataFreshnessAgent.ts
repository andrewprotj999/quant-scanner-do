/**
 * Data Freshness Agent — v5.0
 *
 * Dedicated agent that ensures ALL fields that should be live are actually
 * updating in real-time. Runs every 45 seconds (offset from engine cycle)
 * to catch any positions that the main engine cycle missed.
 *
 * What it updates:
 * - Position currentPrice, pnlUsd, pnlPercent, highestPrice, lowestPrice
 * - Engine state equity, totalPnlUsd, dailyPnlUsd, peakEquity
 * - Stop loss ratcheting (SL only moves up, never down)
 * - Detects and flags stale/static fields
 * - Recalculates derived fields (P&L, drawdown) from fresh prices
 *
 * This agent is the guarantee that what you see in the API is real-time.
 */

import * as queries from "../db/queries.js";
import { fetchPairPrice } from "./paperEngine.js";
import { dexFetchCached } from "./dexRateLimiter.js";

// ─── TYPES ───────────────────────────────────────────────

interface FreshnessReport {
  timestamp: number;
  positionsChecked: number;
  positionsUpdated: number;
  pricesFetched: number;
  pricesFailed: number;
  equityRecalculated: boolean;
  staleFieldsFixed: number;
  issues: string[];
}

interface FieldStatus {
  field: string;
  positionId: number;
  symbol: string;
  wasStale: boolean;
  oldValue: string | null;
  newValue: string | null;
}

// ─── STATE ───────────────────────────────────────────────

let running = false;
let interval: NodeJS.Timeout | null = null;
let lastReport: FreshnessReport | null = null;
let totalUpdates = 0;
let totalCycles = 0;
let consecutiveFailures = 0;
const recentReports: FreshnessReport[] = [];
const MAX_REPORTS = 50;

// Track last known prices to detect truly static fields
const lastKnownPrices = new Map<number, { price: number; updatedAt: number }>();

// ─── CORE REFRESH LOGIC ──────────────────────────────────

async function refreshAllPositions(): Promise<FreshnessReport> {
  const report: FreshnessReport = {
    timestamp: Date.now(),
    positionsChecked: 0,
    positionsUpdated: 0,
    pricesFetched: 0,
    pricesFailed: 0,
    equityRecalculated: false,
    staleFieldsFixed: 0,
    issues: [],
  };

  try {
    const userId = 1;
    const positions = await queries.getOpenPositions(userId);
    report.positionsChecked = positions.length;

    if (positions.length === 0) {
      return report;
    }

    // ── 1. Fetch fresh prices for ALL open positions ──
    for (const pos of positions) {
      try {
        const pair = await fetchPairPrice(pos.pairAddress ?? "", pos.chain);

        if (!pair || !pair.priceUsd) {
          report.pricesFailed++;
          report.issues.push(`${pos.tokenSymbol}: price fetch failed`);
          continue;
        }

        report.pricesFetched++;

        const freshPrice = parseFloat(pair.priceUsd);
        const entryPrice = parseFloat(pos.entryPrice);
        const currentDbPrice = parseFloat(pos.currentPrice ?? pos.entryPrice);
        const highWater = parseFloat(pos.highestPrice ?? pos.entryPrice);
        const lowWater = parseFloat(pos.lowestPrice ?? pos.entryPrice);
        const posSize = parseFloat(pos.positionSizeUsd);

        // Check if price actually changed
        const priceChanged = Math.abs(freshPrice - currentDbPrice) / currentDbPrice > 0.0001; // 0.01% threshold

        // Track price staleness
        const lastKnown = lastKnownPrices.get(pos.id);
        if (lastKnown && Math.abs(freshPrice - lastKnown.price) / lastKnown.price < 0.0001) {
          const staleMs = Date.now() - lastKnown.updatedAt;
          if (staleMs > 5 * 60 * 1000) {
            report.issues.push(`${pos.tokenSymbol}: price unchanged for ${(staleMs / 60000).toFixed(1)}min (${freshPrice})`);
          }
        } else {
          lastKnownPrices.set(pos.id, { price: freshPrice, updatedAt: Date.now() });
        }

        // Calculate fresh P&L
        const pnlPercent = ((freshPrice - entryPrice) / entryPrice) * 100;
        const pnlUsd = (pnlPercent / 100) * posSize;
        const newHigh = Math.max(highWater, freshPrice);
        const newLow = Math.min(lowWater, freshPrice);

        // Build update object — always update to ensure freshness
        const updateData: any = {
          currentPrice: freshPrice.toFixed(10),
          pnlUsd: pnlUsd.toFixed(2),
          pnlPercent: pnlPercent.toFixed(2),
          highestPrice: newHigh.toFixed(10),
          lowestPrice: newLow.toFixed(10),
        };

        // Fix null originalPositionSize
        if (!pos.originalPositionSize) {
          updateData.originalPositionSize = pos.positionSizeUsd;
          report.staleFieldsFixed++;
        }

        // Ratchet stop loss UP (never down) based on profit
        if (pos.stopLossPrice) {
          const currentSL = parseFloat(pos.stopLossPrice);

          // If in profit, consider moving SL up
          if (pnlPercent > 5) {
            // Break-even SL: move to entry + 1% if we're up 5%+
            const breakEvenSL = entryPrice * 1.01;
            if (breakEvenSL > currentSL) {
              updateData.stopLossPrice = breakEvenSL.toFixed(10);
              report.staleFieldsFixed++;
            }
          }

          // If up 15%+, trail SL to lock in at least 5% profit
          if (pnlPercent > 15) {
            const profitLockSL = entryPrice * 1.05;
            if (profitLockSL > parseFloat(updateData.stopLossPrice ?? pos.stopLossPrice)) {
              updateData.stopLossPrice = profitLockSL.toFixed(10);
            }
          }

          // Dynamic trail from high water mark
          if (newHigh > entryPrice * 1.1) { // Only trail if we've been up 10%+
            const trailPercent = pnlPercent > 30 ? 0.08 : pnlPercent > 20 ? 0.10 : 0.12;
            const trailSL = newHigh * (1 - trailPercent);
            const currentBestSL = parseFloat(updateData.stopLossPrice ?? pos.stopLossPrice);
            if (trailSL > currentBestSL) {
              updateData.stopLossPrice = trailSL.toFixed(10);
            }
          }
        }

        // Update additional pair data if available
        if (pair.volume?.h24) {
          // Check for volume dry-up on open positions
          const entryVol = parseFloat(pos.entryVolume ?? "0");
          const currentVol = pair.volume.h24;
          if (entryVol > 0 && currentVol < entryVol * 0.02) {
            report.issues.push(`${pos.tokenSymbol}: volume dried up (entry: $${entryVol.toFixed(0)}, now: $${currentVol.toFixed(0)})`);
          }
        }

        await queries.updatePaperPosition(pos.id, updateData);
        if (priceChanged) {
          report.positionsUpdated++;
        }

      } catch (err: any) {
        report.pricesFailed++;
        report.issues.push(`${pos.tokenSymbol}: update error — ${err.message}`);
      }
    }

    // ── 2. Recalculate engine equity from positions ──
    try {
      const engineState = await queries.getEngineState(userId);
      if (engineState) {
        const closedPositions = await queries.getClosedPositions(userId, 500);
        const openPositions = await queries.getOpenPositions(userId);

        // Total realized P&L from closed positions
        const realizedPnl = closedPositions.reduce((sum, p) => sum + parseFloat(p.pnlUsd ?? "0"), 0);

        // Total unrealized P&L from open positions
        const unrealizedPnl = openPositions.reduce((sum, p) => sum + parseFloat(p.pnlUsd ?? "0"), 0);

        // Starting equity
        const startingEquity = 1000;
        const currentEquity = startingEquity + realizedPnl + unrealizedPnl;

        const oldEquity = parseFloat(engineState.equity ?? "1000");
        const peak = parseFloat(engineState.peakEquity ?? "1000");

        // Only update if there's a meaningful change (>$0.01)
        if (Math.abs(currentEquity - oldEquity) > 0.01) {
          const newPeak = Math.max(peak, currentEquity);

          await queries.upsertEngineState(userId, {
            equity: currentEquity.toFixed(2),
            peakEquity: newPeak.toFixed(2),
            totalPnlUsd: (realizedPnl + unrealizedPnl).toFixed(2),
          } as any);

          report.equityRecalculated = true;
        }

        // Check daily P&L reset
        const resetAt = engineState.dailyPnlResetAt
          ? new Date(engineState.dailyPnlResetAt as any).getTime()
          : 0;
        const now = Date.now();
        const hoursSinceReset = (now - resetAt) / (1000 * 60 * 60);

        if (hoursSinceReset > 24) {
          await queries.upsertEngineState(userId, {
            dailyPnlUsd: "0",
            dailyPnlResetAt: new Date() as any,
          } as any);
          report.staleFieldsFixed++;
        }
      }
    } catch (err: any) {
      report.issues.push(`Equity recalc error: ${err.message}`);
    }

    // ── 3. Clean up stale tracking for closed positions ──
    for (const [posId] of lastKnownPrices) {
      const stillOpen = positions.find(p => p.id === posId);
      if (!stillOpen) {
        lastKnownPrices.delete(posId);
      }
    }

    consecutiveFailures = 0;

  } catch (err: any) {
    consecutiveFailures++;
    report.issues.push(`Agent error: ${err.message}`);
  }

  return report;
}

// ─── AGENT LIFECYCLE ─────────────────────────────────────

const REFRESH_INTERVAL = 45_000; // 45 seconds (offset from 30s engine cycle)

export function startDataFreshnessAgent(): void {
  if (running) return;
  running = true;

  console.log("[DataFreshness] Agent started — refreshing all positions every 45s");

  // Run immediately
  runCycle();

  // Schedule recurring
  interval = setInterval(runCycle, REFRESH_INTERVAL);
}

async function runCycle(): Promise<void> {
  try {
    totalCycles++;
    const report = await refreshAllPositions();
    lastReport = report;

    recentReports.push(report);
    if (recentReports.length > MAX_REPORTS) {
      recentReports.splice(0, recentReports.length - MAX_REPORTS);
    }

    totalUpdates += report.positionsUpdated + report.staleFieldsFixed;

    if (report.positionsUpdated > 0 || report.staleFieldsFixed > 0 || report.issues.length > 0) {
      console.log(
        `[DataFreshness] Cycle #${totalCycles}: ${report.positionsChecked} checked, ` +
        `${report.positionsUpdated} updated, ${report.staleFieldsFixed} stale fixed` +
        (report.issues.length > 0 ? ` | ${report.issues.length} issues` : "") +
        (report.equityRecalculated ? " | equity recalculated" : "")
      );
    }
  } catch (err: any) {
    console.error(`[DataFreshness] Cycle error: ${err.message}`);
  }
}

export function stopDataFreshnessAgent(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  running = false;
  console.log("[DataFreshness] Agent stopped");
}

// ─── API EXPORTS ─────────────────────────────────────────

export function getDataFreshnessStatus() {
  return {
    running,
    totalCycles,
    totalUpdates,
    consecutiveFailures,
    lastReport,
    trackedPositions: lastKnownPrices.size,
    stalePositions: Array.from(lastKnownPrices.entries())
      .filter(([_, v]) => Date.now() - v.updatedAt > 5 * 60 * 1000)
      .map(([id, v]) => ({
        positionId: id,
        lastPriceUpdate: new Date(v.updatedAt).toISOString(),
        staleDurationMin: ((Date.now() - v.updatedAt) / 60000).toFixed(1),
        lastPrice: v.price,
      })),
    recentReports: recentReports.slice(-5).map(r => ({
      timestamp: new Date(r.timestamp).toISOString(),
      checked: r.positionsChecked,
      updated: r.positionsUpdated,
      failed: r.pricesFailed,
      staleFixed: r.staleFieldsFixed,
      equityRecalc: r.equityRecalculated,
      issues: r.issues,
    })),
  };
}
