/**
 * Time-of-Day Optimization — v4
 *
 * Tracks trading performance by hour of day and day of week.
 * Automatically adjusts position sizing and entry thresholds
 * based on when the system historically performs best/worst.
 *
 * Key insights for memecoin trading:
 * - US market hours (14:00-22:00 UTC) typically have highest volume
 * - Asian hours (00:00-08:00 UTC) can have different dynamics
 * - Weekend patterns differ from weekdays
 * - New token launches cluster at certain times
 *
 * The system learns from its own trade history to identify
 * optimal and suboptimal trading windows.
 */

import * as queries from "../db/queries.js";

// ─── TYPES ──────────────────────────────────────────────────

export interface TimeSlotPerformance {
  hour: number;          // 0-23 UTC
  dayOfWeek: number;     // 0-6 (Sunday=0)
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlPercent: number;
  totalPnlUsd: number;
}

export interface TimeOptimization {
  /** Position size multiplier for current time (0.3 to 1.5) */
  sizeMultiplier: number;
  /** Conviction threshold adjustment (-10 to +10) */
  convictionAdjustment: number;
  /** Current time slot performance */
  currentSlot: TimeSlotPerformance | null;
  /** Best performing time slots */
  bestSlots: { hour: number; winRate: number; avgPnl: number }[];
  /** Worst performing time slots */
  worstSlots: { hour: number; winRate: number; avgPnl: number }[];
  /** Whether we have enough data for optimization */
  hasData: boolean;
  /** Current hour (UTC) */
  currentHourUTC: number;
  /** Current day of week */
  currentDayOfWeek: number;
}

// ─── CONSTANTS ──────────────────────────────────────────────

const MIN_TRADES_PER_SLOT = 3;     // Minimum trades to consider a slot meaningful
const MIN_TOTAL_TRADES = 20;       // Minimum total trades before time optimization kicks in
const BEST_SLOT_BONUS = 1.3;       // 30% larger positions during best hours
const WORST_SLOT_PENALTY = 0.5;    // 50% smaller positions during worst hours
const CONVICTION_BOOST = 5;        // Lower conviction threshold during best hours
const CONVICTION_PENALTY = 8;      // Higher conviction threshold during worst hours

// ─── ANALYSIS ───────────────────────────────────────────────

/**
 * Analyze trade performance by time slot (hour of day).
 * Returns performance metrics for each hour.
 */
export async function analyzeTimePerformance(userId: number): Promise<Map<number, TimeSlotPerformance>> {
  const positions = await queries.getClosedPositions(userId, 500);
  const slotMap = new Map<number, TimeSlotPerformance>();

  // Initialize all 24 hours
  for (let h = 0; h < 24; h++) {
    slotMap.set(h, {
      hour: h,
      dayOfWeek: -1,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgPnlPercent: 0,
      totalPnlUsd: 0,
    });
  }

  for (const pos of positions) {
    const openedAt = pos.openedAt ? new Date(pos.openedAt) : null;
    if (!openedAt) continue;

    const hour = openedAt.getUTCHours();
    const pnl = parseFloat(pos.pnlPercent ?? "0");
    const pnlUsd = parseFloat(pos.pnlUsd ?? "0");
    const isWin = pnl >= 0;

    const slot = slotMap.get(hour)!;
    slot.totalTrades++;
    if (isWin) slot.wins++;
    else slot.losses++;
    slot.totalPnlUsd += pnlUsd;
  }

  // Calculate derived metrics
  for (const [, slot] of slotMap) {
    if (slot.totalTrades > 0) {
      slot.winRate = slot.wins / slot.totalTrades;
      slot.avgPnlPercent = slot.totalPnlUsd / slot.totalTrades;
    }
  }

  return slotMap;
}

/**
 * Get time-based optimization for the current moment.
 * Returns multipliers and adjustments to apply to position sizing and conviction.
 */
export async function getTimeOptimization(userId: number): Promise<TimeOptimization> {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentDay = now.getUTCDay();

  const slotMap = await analyzeTimePerformance(userId);

  // Check if we have enough data
  let totalTrades = 0;
  for (const [, slot] of slotMap) {
    totalTrades += slot.totalTrades;
  }

  if (totalTrades < MIN_TOTAL_TRADES) {
    return {
      sizeMultiplier: 1.0,
      convictionAdjustment: 0,
      currentSlot: null,
      bestSlots: [],
      worstSlots: [],
      hasData: false,
      currentHourUTC: currentHour,
      currentDayOfWeek: currentDay,
    };
  }

  // Find best and worst slots (with minimum sample)
  const meaningfulSlots = Array.from(slotMap.values())
    .filter(s => s.totalTrades >= MIN_TRADES_PER_SLOT);

  const sorted = [...meaningfulSlots].sort((a, b) => {
    // Sort by win rate first, then by avg PnL
    const wrDiff = b.winRate - a.winRate;
    return wrDiff !== 0 ? wrDiff : b.avgPnlPercent - a.avgPnlPercent;
  });

  const bestSlots = sorted.slice(0, 4).map(s => ({
    hour: s.hour,
    winRate: s.winRate,
    avgPnl: s.avgPnlPercent,
  }));

  const worstSlots = sorted.slice(-4).reverse().map(s => ({
    hour: s.hour,
    winRate: s.winRate,
    avgPnl: s.avgPnlPercent,
  }));

  // Get current slot
  const currentSlot = slotMap.get(currentHour) ?? null;

  // Calculate multiplier for current hour
  let sizeMultiplier = 1.0;
  let convictionAdjustment = 0;

  if (currentSlot && currentSlot.totalTrades >= MIN_TRADES_PER_SLOT) {
    // Compare current slot's win rate to overall average
    const overallWinRate = totalTrades > 0
      ? Array.from(slotMap.values()).reduce((sum, s) => sum + s.wins, 0) / totalTrades
      : 0.5;

    const winRateDiff = currentSlot.winRate - overallWinRate;

    if (winRateDiff > 0.15) {
      // Significantly better than average
      sizeMultiplier = BEST_SLOT_BONUS;
      convictionAdjustment = -CONVICTION_BOOST; // Lower threshold (easier to enter)
    } else if (winRateDiff > 0.05) {
      // Slightly better
      sizeMultiplier = 1.1;
      convictionAdjustment = -2;
    } else if (winRateDiff < -0.15) {
      // Significantly worse than average
      sizeMultiplier = WORST_SLOT_PENALTY;
      convictionAdjustment = CONVICTION_PENALTY; // Higher threshold (harder to enter)
    } else if (winRateDiff < -0.05) {
      // Slightly worse
      sizeMultiplier = 0.8;
      convictionAdjustment = 3;
    }
  }

  return {
    sizeMultiplier,
    convictionAdjustment,
    currentSlot,
    bestSlots,
    worstSlots,
    hasData: true,
    currentHourUTC: currentHour,
    currentDayOfWeek: currentDay,
  };
}

/**
 * Quick time multiplier for position sizing.
 */
export async function getTimeMultiplier(userId: number): Promise<number> {
  const opt = await getTimeOptimization(userId);
  return opt.sizeMultiplier;
}

/**
 * Get conviction score adjustment for current time.
 */
export async function getTimeConvictionAdjustment(userId: number): Promise<number> {
  const opt = await getTimeOptimization(userId);
  return opt.convictionAdjustment;
}
