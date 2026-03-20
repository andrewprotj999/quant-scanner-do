/**
 * Health Monitor — Standalone Version
 *
 * Tracks cycle metrics, API latency, error rates, and provides
 * self-healing capabilities. No Manus dependencies.
 */

import { notifyOwner } from "../services/notify.js";

// ─── TYPES ────────────────────────────────────────────────

interface CycleMetric {
  cycleNumber: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  tokensScanned: number;
  tokensQualified: number;
  tradesExecuted: number;
  positionsUpdated: number;
  errors: string[];
  success: boolean;
}

interface HealthMetrics {
  totalCycles: number;
  successfulCycles: number;
  failedCycles: number;
  consecutiveFailures: number;
  avgCycleDurationMs: number;
  maxCycleDurationMs: number;
  apiCallCount: number;
  apiErrorCount: number;
  avgApiLatencyMs: number;
  dbQueryCount: number;
  dbErrorCount: number;
  lastCycleTime: number;
  upSince: number;
}

// ─── SINGLETON STATE ──────────────────────────────────────

const recentCycles: CycleMetric[] = [];
const MAX_CYCLE_HISTORY = 100;

let metrics: HealthMetrics = {
  totalCycles: 0,
  successfulCycles: 0,
  failedCycles: 0,
  consecutiveFailures: 0,
  avgCycleDurationMs: 0,
  maxCycleDurationMs: 0,
  apiCallCount: 0,
  apiErrorCount: 0,
  avgApiLatencyMs: 0,
  dbQueryCount: 0,
  dbErrorCount: 0,
  lastCycleTime: 0,
  upSince: Date.now(),
};

let cycleLocked = false;

// ─── CYCLE LOCK ───────────────────────────────────────────

export function acquireCycleLock(): boolean {
  if (cycleLocked) return false;
  cycleLocked = true;
  return true;
}

export function releaseCycleLock(): void {
  cycleLocked = false;
}

export function isCycleLocked(): boolean {
  return cycleLocked;
}

// ─── CYCLE TRACKING ───────────────────────────────────────

export function recordCycle(cycle: Omit<CycleMetric, "cycleNumber">): void {
  metrics.totalCycles++;
  const cycleMetric: CycleMetric = { ...cycle, cycleNumber: metrics.totalCycles };

  if (cycle.success) {
    metrics.successfulCycles++;
    metrics.consecutiveFailures = 0;
  } else {
    metrics.failedCycles++;
    metrics.consecutiveFailures++;
  }

  metrics.lastCycleTime = cycle.endTime;
  metrics.maxCycleDurationMs = Math.max(metrics.maxCycleDurationMs, cycle.durationMs);

  // Rolling average
  const recentDurations = recentCycles.slice(-20).map((c) => c.durationMs);
  recentDurations.push(cycle.durationMs);
  metrics.avgCycleDurationMs = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;

  recentCycles.push(cycleMetric);
  if (recentCycles.length > MAX_CYCLE_HISTORY) recentCycles.shift();

  // Self-healing checks
  checkSelfHeal();
}

export function recordApiCall(latencyMs: number, success: boolean): void {
  metrics.apiCallCount++;
  if (!success) metrics.apiErrorCount++;

  // Rolling average latency
  metrics.avgApiLatencyMs = (metrics.avgApiLatencyMs * (metrics.apiCallCount - 1) + latencyMs) / metrics.apiCallCount;
}

export function recordDbQuery(success: boolean): void {
  metrics.dbQueryCount++;
  if (!success) metrics.dbErrorCount++;
}

// ─── SELF-HEALING ─────────────────────────────────────────

let selfHealCallback: (() => Promise<void>) | null = null;

export function setSelfHealCallback(cb: () => Promise<void>): void {
  selfHealCallback = cb;
}

async function checkSelfHeal(): Promise<void> {
  // Auto-restart after 5 consecutive failures
  if (metrics.consecutiveFailures >= 5 && selfHealCallback) {
    console.error("[Health] 5 consecutive failures — triggering self-heal restart");
    await notifyOwner({
      title: "ENGINE SELF-HEAL: Auto-restarting",
      content: `Engine had ${metrics.consecutiveFailures} consecutive failures. Attempting auto-restart.`,
    }).catch(() => {});

    try {
      await selfHealCallback();
      metrics.consecutiveFailures = 0;
    } catch (err) {
      console.error("[Health] Self-heal failed:", err);
    }
  }

  // Warn on slow cycles
  if (metrics.avgCycleDurationMs > 25000) {
    await notifyOwner({
      title: "WARNING: Slow scan cycles",
      content: `Average cycle duration is ${(metrics.avgCycleDurationMs / 1000).toFixed(1)}s (target: <10s).`,
    }).catch(() => {});
  }
}

// ─── GETTERS ──────────────────────────────────────────────

export function getHealthMetrics(): HealthMetrics {
  return { ...metrics };
}

export function getRecentCycles(count = 20): CycleMetric[] {
  return recentCycles.slice(-count);
}

export function getHealthGrade(): "EXCELLENT" | "GOOD" | "DEGRADED" | "CRITICAL" {
  if (metrics.consecutiveFailures >= 3) return "CRITICAL";
  if (metrics.consecutiveFailures >= 1 || metrics.avgCycleDurationMs > 20000) return "DEGRADED";
  if (metrics.failedCycles / Math.max(metrics.totalCycles, 1) > 0.1) return "DEGRADED";
  if (metrics.avgCycleDurationMs < 5000 && metrics.consecutiveFailures === 0) return "EXCELLENT";
  return "GOOD";
}

export function resetMetrics(): void {
  metrics = {
    totalCycles: 0,
    successfulCycles: 0,
    failedCycles: 0,
    consecutiveFailures: 0,
    avgCycleDurationMs: 0,
    maxCycleDurationMs: 0,
    apiCallCount: 0,
    apiErrorCount: 0,
    avgApiLatencyMs: 0,
    dbQueryCount: 0,
    dbErrorCount: 0,
    lastCycleTime: 0,
    upSince: Date.now(),
  };
  recentCycles.length = 0;
}

// ─── HEALTH STATUS (server.ts compatible) ────────────────

export function getHealthStatus() {
  const m = getHealthMetrics();
  return {
    grade: getHealthGrade(),
    totalCycles: m.totalCycles,
    successRate: m.totalCycles > 0 ? m.successfulCycles / m.totalCycles : 1,
    avgCycleMs: m.avgCycleDurationMs,
    apiErrorRate: m.apiCallCount > 0 ? m.apiErrorCount / m.apiCallCount : 0,
    consecutiveFailures: m.consecutiveFailures,
    upSince: m.upSince,
  };
}

export function getRecentErrors(count = 10): Array<{ message: string; category: string; timestamp: number }> {
  return recentCycles
    .filter((c) => !c.success && c.errors.length > 0)
    .slice(-count)
    .flatMap((c) =>
      c.errors.map((e) => ({
        message: e,
        category: "cycle",
        timestamp: c.endTime,
      }))
    );
}

// ─── PERIODIC HEALTH CHECKS ──────────────────────────────

let healthInterval: ReturnType<typeof setInterval> | null = null;

export function startHealthChecks(intervalMs = 60000): void {
  if (healthInterval) clearInterval(healthInterval);
  healthInterval = setInterval(() => {
    const status = getHealthStatus();
    if (status.grade === "CRITICAL" || status.grade === "DEGRADED") {
      console.warn(`[Health] Grade: ${status.grade} | Failures: ${status.consecutiveFailures}`);
    }
  }, intervalMs);
}

export function stopHealthChecks(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

// ─── DB RETRY WRAPPER ─────────────────────────────────────

export async function withDbRetry<T>(
  operation: () => T | Promise<T>,
  label: string,
  maxRetries = 2
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      recordDbQuery(true);
      return result;
    } catch (err: any) {
      recordDbQuery(false);
      if (attempt === maxRetries) {
        console.error(`[Health] DB operation "${label}" failed after ${maxRetries + 1} attempts:`, err.message);
        throw err;
      }
      const wait = 1000 * Math.pow(2, attempt);
      console.warn(`[Health] DB retry ${attempt + 1}/${maxRetries} for "${label}": ${err.message} (waiting ${wait}ms)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("Unreachable");
}
