/**
 * Autonomous Agent System — v5.0
 *
 * Four specialized agents that run continuously to maximize win rate and profit:
 *
 * 1. MONITOR AGENT  — Every 60s: checks field freshness, data staleness, position health
 * 2. OPTIMIZER AGENT — Every 30min: analyzes recent trades, adjusts params for max profit
 * 3. HEALER AGENT   — Every 5min: detects anomalies, fixes issues, restarts stuck components
 * 4. LEARNER AGENT  — Every 2hr: deep analysis of all trade history, pattern discovery, weight tuning
 *
 * All agents write to a shared diagnostic log and can trigger parameter changes.
 * The system learns from every diagnostic cycle.
 */

import * as queries from "../db/queries.js";
import { notifyOwner } from "../services/notify.js";
import { getHealthStatus, getRecentCycles } from "./healthMonitor.js";
import { isEngineRunning, getDynamicParams } from "./paperEngine.js";
import { assessRisk, calculateKelly } from "./riskManager.js";
import { getMAEStats } from "./maeAnalysis.js";
import { getTimeOptimization } from "./timeOptimizer.js";
import { analyzeEquityCurve } from "./equityCurveMA.js";
import { checkSystemHealth, getSystemGuardState, resetKillSwitch } from "./systemGuards.js";

// ─── TYPES ───────────────────────────────────────────────

interface DiagnosticEntry {
  timestamp: number;
  agent: "monitor" | "optimizer" | "healer" | "learner";
  severity: "info" | "warning" | "critical" | "fix_applied";
  category: string;
  message: string;
  data?: any;
  actionTaken?: string;
}

interface AgentState {
  running: boolean;
  lastRun: number;
  runCount: number;
  issuesFound: number;
  fixesApplied: number;
  lastReport: string;
}

interface FieldFreshnessCheck {
  field: string;
  lastUpdated: number | null;
  staleThresholdMs: number;
  isStale: boolean;
  ageMs: number;
}

// ─── SHARED STATE ────────────────────────────────────────

const diagnosticLog: DiagnosticEntry[] = [];
const MAX_LOG_SIZE = 500;

const agentStates: Record<string, AgentState> = {
  monitor: { running: false, lastRun: 0, runCount: 0, issuesFound: 0, fixesApplied: 0, lastReport: "" },
  optimizer: { running: false, lastRun: 0, runCount: 0, issuesFound: 0, fixesApplied: 0, lastReport: "" },
  healer: { running: false, lastRun: 0, runCount: 0, issuesFound: 0, fixesApplied: 0, lastReport: "" },
  learner: { running: false, lastRun: 0, runCount: 0, issuesFound: 0, fixesApplied: 0, lastReport: "" },
};

// Performance tracking for the agent system itself
let totalOptimizationsApplied = 0;
let paramChangesHistory: Array<{ timestamp: number; param: string; oldValue: any; newValue: any; reason: string }> = [];

function log(entry: Omit<DiagnosticEntry, "timestamp">) {
  const full: DiagnosticEntry = { ...entry, timestamp: Date.now() };
  diagnosticLog.push(full);
  if (diagnosticLog.length > MAX_LOG_SIZE) {
    diagnosticLog.splice(0, diagnosticLog.length - MAX_LOG_SIZE);
  }
  const prefix = entry.severity === "critical" ? "🚨" : entry.severity === "warning" ? "⚠️" : entry.severity === "fix_applied" ? "🔧" : "ℹ️";
  console.log(`[Agent:${entry.agent}] ${prefix} ${entry.message}`);
}

// ─── AGENT 1: MONITOR (every 60s) ───────────────────────
// Checks: field freshness, position health, data quality, API responsiveness

async function runMonitorAgent(): Promise<void> {
  const state = agentStates.monitor;
  state.lastRun = Date.now();
  state.runCount++;

  const issues: string[] = [];
  const fixes: string[] = [];

  try {
    const userId = 1;

    // 1. Check engine state freshness
    const engineState = await queries.getEngineState(userId);
    if (engineState) {
      const lastScanAge = engineState.lastScanAt
        ? Date.now() - new Date(engineState.lastScanAt as any).getTime()
        : Infinity;

      if (lastScanAge > 5 * 60 * 1000) { // 5 min without scan
        issues.push(`Engine scan stale: ${(lastScanAge / 60000).toFixed(1)}min since last scan`);
        log({ agent: "monitor", severity: "warning", category: "staleness", message: `Last scan was ${(lastScanAge / 60000).toFixed(1)} minutes ago` });
      }

      // Check daily P&L reset
      if (engineState.dailyPnlResetAt) {
        const resetAge = Date.now() - new Date(engineState.dailyPnlResetAt as any).getTime();
        if (resetAge > 25 * 60 * 60 * 1000) { // Over 25 hours
          issues.push(`Daily P&L not reset in ${(resetAge / 3600000).toFixed(1)}h`);
          log({ agent: "monitor", severity: "warning", category: "staleness", message: "Daily P&L reset overdue" });
        }
      }
    }

    // 2. Check open position freshness
    const positions = await queries.getOpenPositions(userId);
    for (const pos of positions) {
      const entryPrice = parseFloat(pos.entryPrice);
      const currentPrice = parseFloat(pos.currentPrice ?? pos.entryPrice);

      // Check if currentPrice equals entryPrice (never updated)
      if (currentPrice === entryPrice && pos.openedAt) {
        const holdTime = Date.now() - new Date(pos.openedAt as any).getTime();
        if (holdTime > 5 * 60 * 1000) { // Open 5+ min but price never changed
          issues.push(`${pos.tokenSymbol}: price appears static (entry=current=${currentPrice}) after ${(holdTime / 60000).toFixed(0)}min`);
          log({ agent: "monitor", severity: "warning", category: "stale_price", message: `${pos.tokenSymbol} price unchanged since entry`, data: { posId: pos.id, holdMin: holdTime / 60000 } });
        }
      }

      // Check for positions with null/missing fields that should be populated
      if (!pos.originalPositionSize && pos.positionSizeUsd) {
        issues.push(`${pos.tokenSymbol}: originalPositionSize is null (should be ${pos.positionSizeUsd})`);
        // Auto-fix: set originalPositionSize to positionSizeUsd
        try {
          await queries.updatePaperPosition(pos.id, { originalPositionSize: pos.positionSizeUsd } as any);
          fixes.push(`Fixed ${pos.tokenSymbol}: set originalPositionSize = ${pos.positionSizeUsd}`);
          log({ agent: "monitor", severity: "fix_applied", category: "missing_field", message: `Fixed ${pos.tokenSymbol} originalPositionSize`, actionTaken: `Set to ${pos.positionSizeUsd}` });
        } catch { /* non-critical */ }
      }

      // Check for positions with unrealistic P&L (data corruption)
      const pnlPct = parseFloat(pos.pnlPercent ?? "0");
      if (Math.abs(pnlPct) > 10000) {
        issues.push(`${pos.tokenSymbol}: P&L ${pnlPct.toFixed(1)}% seems unrealistic — possible data issue`);
        log({ agent: "monitor", severity: "critical", category: "data_integrity", message: `${pos.tokenSymbol} has ${pnlPct.toFixed(1)}% P&L — possible corruption` });
      }

      // Check stop loss is set
      if (!pos.stopLossPrice || parseFloat(pos.stopLossPrice) <= 0) {
        issues.push(`${pos.tokenSymbol}: missing stop loss price`);
        log({ agent: "monitor", severity: "critical", category: "missing_sl", message: `${pos.tokenSymbol} has no stop loss — high risk` });
      }
    }

    // 3. Check system health components
    const sysHealth = checkSystemHealth();
    if (sysHealth.healthScore < 60) {
      issues.push(`System health degraded: ${sysHealth.healthScore}/100`);
      log({ agent: "monitor", severity: "warning", category: "system_health", message: `Health score ${sysHealth.healthScore}/100`, data: sysHealth.components });
    }

    // 4. Check equity consistency
    if (engineState) {
      const equity = parseFloat(engineState.equity ?? "1000");
      const peak = parseFloat(engineState.peakEquity ?? "1000");
      if (equity > peak * 1.01) { // Equity exceeds peak by more than 1% without peak being updated
        issues.push(`Equity ($${equity.toFixed(2)}) exceeds peak ($${peak.toFixed(2)}) — peak not updated`);
        try {
          await queries.upsertEngineState(userId, { peakEquity: equity.toFixed(2) } as any);
          fixes.push(`Updated peakEquity to $${equity.toFixed(2)}`);
          log({ agent: "monitor", severity: "fix_applied", category: "equity_sync", message: `Synced peakEquity to ${equity.toFixed(2)}` });
        } catch { /* non-critical */ }
      }
    }

    // 5. Check health monitor cycles
    const health = getHealthStatus();
    if (health.consecutiveFailures > 3) {
      issues.push(`${health.consecutiveFailures} consecutive cycle failures`);
      log({ agent: "monitor", severity: "critical", category: "cycle_failures", message: `${health.consecutiveFailures} consecutive failures detected` });
    }

    state.issuesFound += issues.length;
    state.fixesApplied += fixes.length;
    state.lastReport = `Issues: ${issues.length}, Fixes: ${fixes.length}`;

    if (issues.length > 0) {
      log({ agent: "monitor", severity: "info", category: "summary", message: `Monitor scan: ${issues.length} issues, ${fixes.length} auto-fixed`, data: { issues, fixes } });
    }

  } catch (err: any) {
    log({ agent: "monitor", severity: "critical", category: "agent_error", message: `Monitor agent error: ${err.message}` });
  }
}

// ─── AGENT 2: OPTIMIZER (every 30min) ────────────────────
// Analyzes recent trade performance and adjusts parameters to maximize win rate + profit

async function runOptimizerAgent(): Promise<void> {
  const state = agentStates.optimizer;
  state.lastRun = Date.now();
  state.runCount++;

  try {
    const userId = 1;
    const closedPositions = await queries.getClosedPositions(userId, 200);
    if (closedPositions.length < 5) {
      log({ agent: "optimizer", severity: "info", category: "skip", message: `Only ${closedPositions.length} closed trades — need 5+ for optimization` });
      return;
    }

    const currentParams = getDynamicParams();
    const paramChanges: Array<{ param: string; oldValue: any; newValue: any; reason: string }> = [];

    // Calculate recent performance (last 20 trades)
    const recent = closedPositions.slice(0, 20);
    const recentWins = recent.filter(p => parseFloat(p.pnlUsd ?? "0") > 0);
    const recentLosses = recent.filter(p => parseFloat(p.pnlUsd ?? "0") <= 0);
    const recentWinRate = recentWins.length / recent.length;
    const recentAvgWin = recentWins.length > 0 ? recentWins.reduce((s, p) => s + parseFloat(p.pnlPercent ?? "0"), 0) / recentWins.length : 0;
    const recentAvgLoss = recentLosses.length > 0 ? Math.abs(recentLosses.reduce((s, p) => s + parseFloat(p.pnlPercent ?? "0"), 0) / recentLosses.length) : 0;

    // All-time performance
    const allWins = closedPositions.filter(p => parseFloat(p.pnlUsd ?? "0") > 0);
    const allLosses = closedPositions.filter(p => parseFloat(p.pnlUsd ?? "0") <= 0);
    const allWinRate = allWins.length / closedPositions.length;

    log({ agent: "optimizer", severity: "info", category: "analysis", message: `Recent 20: ${(recentWinRate * 100).toFixed(0)}% WR, avg win +${recentAvgWin.toFixed(1)}%, avg loss -${recentAvgLoss.toFixed(1)}% | All-time: ${(allWinRate * 100).toFixed(0)}% WR (${closedPositions.length} trades)` });

    // ── OPTIMIZATION 1: Stop Loss Tuning ──
    // Analyze where losers actually bottom out vs where SL triggers
    const stoppedOut = closedPositions.filter(p => p.status === "stopped_out");
    if (stoppedOut.length >= 5) {
      const slLosses = stoppedOut.map(p => Math.abs(parseFloat(p.pnlPercent ?? "0")));
      const avgSLLoss = slLosses.reduce((a, b) => a + b, 0) / slLosses.length;
      const medianSLLoss = slLosses.sort((a, b) => a - b)[Math.floor(slLosses.length / 2)];

      // Check MAE data for optimal SL
      try {
        const maeStats = await getMAEStats(userId);
        if (maeStats && maeStats.recommendedSL && maeStats.sampleSize >= 10) {
          const maeRecommendedSL = maeStats.recommendedSL;
          if (Math.abs(maeRecommendedSL - currentParams.stopLossPercent) > 1) {
            // Blend: move 30% toward MAE recommendation per cycle (gradual)
            const newSL = currentParams.stopLossPercent + (maeRecommendedSL - currentParams.stopLossPercent) * 0.3;
            const clampedSL = Math.max(5, Math.min(15, Math.round(newSL * 10) / 10));
            if (clampedSL !== currentParams.stopLossPercent) {
              paramChanges.push({
                param: "stopLossPercent",
                oldValue: currentParams.stopLossPercent,
                newValue: clampedSL,
                reason: `MAE analysis recommends ${maeRecommendedSL.toFixed(1)}%, blending toward it (median SL loss: ${medianSLLoss.toFixed(1)}%)`
              });
            }
          }
        }
      } catch { /* non-critical */ }
    }

    // ── OPTIMIZATION 2: Conviction Threshold ──
    // If low-conviction trades are losing, raise the bar
    const lowConviction = closedPositions.filter(p => (p.convictionScore ?? 100) < 80);
    const highConviction = closedPositions.filter(p => (p.convictionScore ?? 100) >= 80);
    if (lowConviction.length >= 5 && highConviction.length >= 5) {
      const lowWR = lowConviction.filter(p => parseFloat(p.pnlUsd ?? "0") > 0).length / lowConviction.length;
      const highWR = highConviction.filter(p => parseFloat(p.pnlUsd ?? "0") > 0).length / highConviction.length;

      // v6: conviction threshold is managed by signal pipeline
      // Log the insight for learning but don't try to modify minConviction
      if (lowWR < 0.25 && highWR > lowWR + 0.1) {
        paramChanges.push({
          param: "stopLossPercent",
          oldValue: currentParams.stopLossPercent,
          newValue: Math.max(5, currentParams.stopLossPercent - 0.5),
          reason: `Low conviction WR ${(lowWR * 100).toFixed(0)}% vs high ${(highWR * 100).toFixed(0)}% — tightening SL to cut losers faster`
        });
      }
    }

    // ── OPTIMIZATION 3: Take Profit Levels ──
    // Analyze where winners actually peak to optimize TP levels
    const winners = closedPositions.filter(p => parseFloat(p.pnlUsd ?? "0") > 0);
    if (winners.length >= 5) {
      const winPeaks = winners.map(p => {
        const entry = parseFloat(p.entryPrice);
        const high = parseFloat(p.highestPrice ?? p.entryPrice);
        return ((high - entry) / entry) * 100;
      }).sort((a, b) => a - b);

      const median_peak = winPeaks[Math.floor(winPeaks.length / 2)];
      const p25_peak = winPeaks[Math.floor(winPeaks.length * 0.25)];

      // TP Early should be achievable by most winners (around 25th percentile of peaks)
      if (p25_peak > 0 && Math.abs(p25_peak - currentParams.tpEarlyPercent) > 3) {
        const newTPEarly = Math.max(5, Math.min(20, Math.round(p25_peak)));
        if (newTPEarly !== currentParams.tpEarlyPercent) {
          paramChanges.push({
            param: "tpEarlyPercent",
            oldValue: currentParams.tpEarlyPercent,
            newValue: newTPEarly,
            reason: `25th percentile winner peak is ${p25_peak.toFixed(1)}%, adjusting early TP to match`
          });
        }
      }

      // TP1 should be achievable by ~50% of winners
      if (median_peak > 0 && Math.abs(median_peak - currentParams.tp1Percent) > 5) {
        const newTP1 = Math.max(10, Math.min(40, Math.round(median_peak)));
        if (newTP1 !== currentParams.tp1Percent) {
          paramChanges.push({
            param: "tp1Percent",
            oldValue: currentParams.tp1Percent,
            newValue: newTP1,
            reason: `Median winner peak is ${median_peak.toFixed(1)}%, adjusting TP1 to match`
          });
        }
      }
    }

    // ── OPTIMIZATION 4: Trail Stop Tuning ──
    // If winners are giving back too much profit, tighten trail
    const trailedOut = closedPositions.filter(p =>
      p.exitReason?.includes("trail") || p.exitReason?.includes("Trail")
    );
    if (trailedOut.length >= 3) {
      const trailGivebacks = trailedOut.map(p => {
        const high = parseFloat(p.highestPrice ?? p.entryPrice);
        const exit = parseFloat(p.exitPrice ?? p.entryPrice);
        return ((high - exit) / high) * 100;
      });
      const avgGiveback = trailGivebacks.reduce((a, b) => a + b, 0) / trailGivebacks.length;

      if (avgGiveback > 15 && currentParams.trailMinPercent > 3) {
        paramChanges.push({
          param: "trailMinPercent",
          oldValue: currentParams.trailMinPercent,
          newValue: Math.max(2, currentParams.trailMinPercent - 1),
          reason: `Avg trail giveback ${avgGiveback.toFixed(1)}% is too high — tightening minimum trail`
        });
      }
    }

    // ── OPTIMIZATION 5: Position Sizing ──
    // If drawdown is high, reduce max risk; if equity is growing, can increase
    const engineState = await queries.getEngineState(userId);
    if (engineState) {
      const equity = parseFloat(engineState.equity ?? "1000");
      const peak = parseFloat(engineState.peakEquity ?? "1000");
      const drawdown = ((peak - equity) / peak) * 100;

      if (drawdown > 20 && currentParams.maxRiskPercent > 1.5) {
        paramChanges.push({
          param: "maxRiskPercent",
          oldValue: currentParams.maxRiskPercent,
          newValue: Math.max(1.0, currentParams.maxRiskPercent - 0.5),
          reason: `Drawdown ${drawdown.toFixed(1)}% — reducing max risk per trade`
        });
      } else if (drawdown < 5 && recentWinRate > 0.5 && currentParams.maxRiskPercent < 3.0) {
        paramChanges.push({
          param: "maxRiskPercent",
          oldValue: currentParams.maxRiskPercent,
          newValue: Math.min(3.0, currentParams.maxRiskPercent + 0.25),
          reason: `Low drawdown ${drawdown.toFixed(1)}% + good WR ${(recentWinRate * 100).toFixed(0)}% — can increase risk`
        });
      }
    }

    // ── OPTIMIZATION 6: Circuit Breaker ──
    // If we've never hit circuit breaker but have big losses, lower it
    const bigLosses = closedPositions.filter(p => parseFloat(p.pnlPercent ?? "0") < -30);
    if (bigLosses.length >= 3 && currentParams.circuitBreakerPct > 30) {
      paramChanges.push({
        param: "circuitBreakerPct",
        oldValue: currentParams.circuitBreakerPct,
        newValue: Math.max(25, currentParams.circuitBreakerPct - 10),
        reason: `${bigLosses.length} trades lost >30% — tightening circuit breaker`
      });
    }

    // ── Apply Changes ──
    if (paramChanges.length > 0) {
      const updateObj: any = {};
      for (const change of paramChanges) {
        updateObj[change.param] = String(change.newValue);
        log({
          agent: "optimizer",
          severity: "fix_applied",
          category: "param_change",
          message: `${change.param}: ${change.oldValue} → ${change.newValue} | ${change.reason}`,
          actionTaken: `Changed ${change.param}`
        });
      }

      try {
        await queries.upsertEngineParams(updateObj);
        totalOptimizationsApplied += paramChanges.length;
        paramChangesHistory.push(...paramChanges.map(c => ({ ...c, timestamp: Date.now() })));

        // Keep history bounded
        if (paramChangesHistory.length > 200) {
          paramChangesHistory = paramChangesHistory.slice(-200);
        }

        // Notify owner of significant changes
        if (paramChanges.length >= 2) {
          await notifyOwner({
            title: `🤖 Optimizer Agent — ${paramChanges.length} param adjustments`,
            content: paramChanges.map(c => `${c.param}: ${c.oldValue} → ${c.newValue} (${c.reason})`).join("\n"),
          }).catch(() => {});
        }
      } catch (err: any) {
        log({ agent: "optimizer", severity: "critical", category: "apply_error", message: `Failed to apply param changes: ${err.message}` });
      }
    }

    state.issuesFound += paramChanges.length;
    state.fixesApplied += paramChanges.length;
    state.lastReport = `Analyzed ${closedPositions.length} trades, ${paramChanges.length} optimizations applied. Recent WR: ${(recentWinRate * 100).toFixed(0)}%`;

  } catch (err: any) {
    log({ agent: "optimizer", severity: "critical", category: "agent_error", message: `Optimizer agent error: ${err.message}` });
  }
}

// ─── AGENT 3: HEALER (every 5min) ───────────────────────
// Detects anomalies, fixes stuck states, restarts components

async function runHealerAgent(): Promise<void> {
  const state = agentStates.healer;
  state.lastRun = Date.now();
  state.runCount++;

  const fixes: string[] = [];

  try {
    const userId = 1;

    // 1. Check if kill switch is stuck on
    const guards = getSystemGuardState();
    if (guards.killSwitchActive) {
      const killAge = guards.killSwitchTriggeredAt
        ? Date.now() - new Date(guards.killSwitchTriggeredAt).getTime()
        : 0;

      // Auto-reset kill switch after 30 minutes if health has recovered
      if (killAge > 30 * 60 * 1000) {
        const health = checkSystemHealth();
        if (health.healthScore >= 60) {
          resetKillSwitch();
          fixes.push("Reset kill switch after 30min cooldown (health recovered)");
          log({ agent: "healer", severity: "fix_applied", category: "kill_switch", message: "Auto-reset kill switch — health recovered to " + health.healthScore, actionTaken: "resetKillSwitch()" });
        }
      }
    }

    // 2. Check for zombie positions (open but very old with no updates)
    const positions = await queries.getOpenPositions(userId);
    for (const pos of positions) {
      if (!pos.openedAt) continue;
      const holdMs = Date.now() - new Date(pos.openedAt as any).getTime();

      // Position open > 8 hours with no price movement at all
      if (holdMs > 8 * 60 * 60 * 1000) {
        const entry = parseFloat(pos.entryPrice);
        const current = parseFloat(pos.currentPrice ?? pos.entryPrice);
        const high = parseFloat(pos.highestPrice ?? pos.entryPrice);
        const low = parseFloat(pos.lowestPrice ?? pos.entryPrice);

        // If high and low are both very close to entry, price was never fetched properly
        if (Math.abs(high - entry) / entry < 0.001 && Math.abs(low - entry) / entry < 0.001) {
          log({ agent: "healer", severity: "warning", category: "zombie_position", message: `${pos.tokenSymbol} open ${(holdMs / 3600000).toFixed(1)}h with no price movement — may be stuck` });
        }
      }
    }

    // 3. Check for inconsistent equity
    const engineState = await queries.getEngineState(userId);
    if (engineState) {
      const equity = parseFloat(engineState.equity ?? "1000");

      // Equity should never be negative
      if (equity < 0) {
        const fixedEquity = Math.max(100, equity); // Floor at $100
        await queries.upsertEngineState(userId, { equity: fixedEquity.toFixed(2) } as any);
        fixes.push(`Fixed negative equity: $${equity.toFixed(2)} → $${fixedEquity.toFixed(2)}`);
        log({ agent: "healer", severity: "fix_applied", category: "equity_fix", message: `Corrected negative equity`, actionTaken: `Set to $${fixedEquity.toFixed(2)}` });
      }

      // Check open position value vs equity (sanity check)
      const openValue = positions.reduce((s, p) => s + parseFloat(p.positionSizeUsd ?? "0"), 0);
      if (openValue > equity * 3) {
        log({ agent: "healer", severity: "warning", category: "equity_mismatch", message: `Open positions ($${openValue.toFixed(2)}) exceed 3x equity ($${equity.toFixed(2)}) — possible accounting error` });
      }
    }

    // 4. Check consecutive losses and auto-reduce if needed
    if (engineState) {
      const consecLosses = engineState.consecutiveLosses ?? 0;
      if (consecLosses >= 5) {
        log({ agent: "healer", severity: "warning", category: "losing_streak", message: `${consecLosses} consecutive losses — optimizer should tighten params` });

        // If 10+ consecutive losses, force a parameter reset to more conservative values
        if (consecLosses >= 10) {
          try {
            await queries.upsertEngineParams({
              minConviction: 80,
              stopLossPercent: "7",
              maxRiskPercent: "1.5",
              maxPosPctHigh: "5",
            } as any);
            fixes.push(`Emergency param reset after ${consecLosses} consecutive losses`);
            log({ agent: "healer", severity: "fix_applied", category: "emergency_reset", message: `Forced conservative params after ${consecLosses} losses`, actionTaken: "minConv=80, SL=7%, maxRisk=1.5%" });

            await notifyOwner({
              title: `🚨 Healer Agent — Emergency Parameter Reset`,
              content: `${consecLosses} consecutive losses detected. Switched to conservative mode: minConviction=80, SL=7%, maxRisk=1.5%. Will auto-relax when win rate recovers.`,
            }).catch(() => {});
          } catch { /* non-critical */ }
        }
      }
    }

    // 5. Memory check
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    if (heapUsedMB > 400) {
      log({ agent: "healer", severity: "warning", category: "memory", message: `High memory usage: ${heapUsedMB.toFixed(0)}MB heap` });
    }

    state.fixesApplied += fixes.length;
    state.lastReport = `Checks complete. ${fixes.length} fixes applied.`;

  } catch (err: any) {
    log({ agent: "healer", severity: "critical", category: "agent_error", message: `Healer agent error: ${err.message}` });
  }
}

// ─── AGENT 4: LEARNER (every 2hr) ───────────────────────
// Deep analysis of all trade history, pattern discovery, weight tuning

async function runLearnerAgent(): Promise<void> {
  const state = agentStates.learner;
  state.lastRun = Date.now();
  state.runCount++;

  try {
    const userId = 1;
    const allPositions = await queries.getClosedPositions(userId, 500);
    if (allPositions.length < 10) {
      log({ agent: "learner", severity: "info", category: "skip", message: `Only ${allPositions.length} trades — need 10+ for deep learning` });
      return;
    }

    const insights: string[] = [];

    // ── PATTERN 1: Chain Performance ──
    const chainStats = new Map<string, { wins: number; losses: number; totalPnl: number; count: number }>();
    for (const pos of allPositions) {
      const chain = pos.chain ?? "unknown";
      const stats = chainStats.get(chain) ?? { wins: 0, losses: 0, totalPnl: 0, count: 0 };
      const pnl = parseFloat(pos.pnlUsd ?? "0");
      stats.count++;
      stats.totalPnl += pnl;
      if (pnl > 0) stats.wins++; else stats.losses++;
      chainStats.set(chain, stats);
    }

    for (const [chain, stats] of chainStats) {
      const wr = stats.count > 0 ? stats.wins / stats.count : 0;
      if (stats.count >= 5 && wr < 0.2 && stats.totalPnl < -50) {
        insights.push(`Chain ${chain}: ${(wr * 100).toFixed(0)}% WR, $${stats.totalPnl.toFixed(2)} total — consider reducing exposure`);

        // Update pattern weight to penalize this chain
        try {
          await queries.upsertTradePattern(userId, "chain", chain, {
            totalTrades: stats.count,
            wins: stats.wins,
            losses: stats.losses,
            totalPnlUsd: stats.totalPnl.toFixed(2),
            weightAdjustment: String(Math.max(-15, Math.floor(stats.totalPnl / 10))),
          });
        } catch { /* non-critical */ }
      } else if (stats.count >= 5 && wr > 0.5 && stats.totalPnl > 50) {
        insights.push(`Chain ${chain}: ${(wr * 100).toFixed(0)}% WR, +$${stats.totalPnl.toFixed(2)} — strong performer`);
        try {
          await queries.upsertTradePattern(userId, "chain", chain, {
            totalTrades: stats.count,
            wins: stats.wins,
            losses: stats.losses,
            totalPnlUsd: stats.totalPnl.toFixed(2),
            weightAdjustment: String(Math.min(15, Math.ceil(stats.totalPnl / 10))),
          });
        } catch { /* non-critical */ }
      }
    }

    // ── PATTERN 2: Hold Duration Analysis ──
    const holdBuckets = new Map<string, { wins: number; losses: number; totalPnl: number; count: number }>();
    for (const pos of allPositions) {
      if (!pos.openedAt || !pos.closedAt) continue;
      const holdMs = new Date(pos.closedAt as any).getTime() - new Date(pos.openedAt as any).getTime();
      const holdMin = holdMs / 60000;

      let bucket: string;
      if (holdMin < 5) bucket = "<5m";
      else if (holdMin < 15) bucket = "5-15m";
      else if (holdMin < 60) bucket = "15-60m";
      else if (holdMin < 240) bucket = "1-4h";
      else bucket = "4h+";

      const stats = holdBuckets.get(bucket) ?? { wins: 0, losses: 0, totalPnl: 0, count: 0 };
      const pnl = parseFloat(pos.pnlUsd ?? "0");
      stats.count++;
      stats.totalPnl += pnl;
      if (pnl > 0) stats.wins++; else stats.losses++;
      holdBuckets.set(bucket, stats);
    }

    for (const [bucket, stats] of holdBuckets) {
      const wr = stats.count > 0 ? stats.wins / stats.count : 0;
      if (stats.count >= 3) {
        insights.push(`Hold ${bucket}: ${(wr * 100).toFixed(0)}% WR (${stats.count} trades), $${stats.totalPnl.toFixed(2)}`);

        // Update hold time pattern weights
        const weight = stats.totalPnl > 0 ? Math.min(10, Math.ceil(stats.totalPnl / 20)) : Math.max(-15, Math.floor(stats.totalPnl / 20));
        try {
          await queries.upsertTradePattern(userId, "hold_time", bucket, {
            totalTrades: stats.count,
            wins: stats.wins,
            losses: stats.losses,
            totalPnlUsd: stats.totalPnl.toFixed(2),
            weightAdjustment: String(weight),
          });
        } catch { /* non-critical */ }
      }
    }

    // ── PATTERN 3: Time-of-Day Performance ──
    const hourStats = new Map<number, { wins: number; losses: number; totalPnl: number; count: number }>();
    for (const pos of allPositions) {
      if (!pos.openedAt) continue;
      const hour = new Date(pos.openedAt as any).getUTCHours();
      const stats = hourStats.get(hour) ?? { wins: 0, losses: 0, totalPnl: 0, count: 0 };
      const pnl = parseFloat(pos.pnlUsd ?? "0");
      stats.count++;
      stats.totalPnl += pnl;
      if (pnl > 0) stats.wins++; else stats.losses++;
      hourStats.set(hour, stats);
    }

    const bestHours: number[] = [];
    const worstHours: number[] = [];
    for (const [hour, stats] of hourStats) {
      if (stats.count >= 3) {
        const wr = stats.wins / stats.count;
        if (wr >= 0.5 && stats.totalPnl > 0) bestHours.push(hour);
        if (wr < 0.2 && stats.totalPnl < -20) worstHours.push(hour);
      }
    }
    if (bestHours.length > 0) insights.push(`Best hours (UTC): ${bestHours.join(", ")}`);
    if (worstHours.length > 0) insights.push(`Worst hours (UTC): ${worstHours.join(", ")}`);

    // ── PATTERN 4: Conviction Score Calibration ──
    const convBuckets = new Map<string, { wins: number; losses: number; count: number; totalPnl: number }>();
    for (const pos of allPositions) {
      const conv = pos.convictionScore ?? 70;
      const bucket = `${Math.floor(conv / 10) * 10}-${Math.floor(conv / 10) * 10 + 9}`;
      const stats = convBuckets.get(bucket) ?? { wins: 0, losses: 0, count: 0, totalPnl: 0 };
      const pnl = parseFloat(pos.pnlUsd ?? "0");
      stats.count++;
      stats.totalPnl += pnl;
      if (pnl > 0) stats.wins++; else stats.losses++;
      convBuckets.set(bucket, stats);
    }

    for (const [bucket, stats] of convBuckets) {
      if (stats.count >= 3) {
        const wr = stats.wins / stats.count;
        insights.push(`Conviction ${bucket}: ${(wr * 100).toFixed(0)}% WR (${stats.count} trades), $${stats.totalPnl.toFixed(2)}`);

        const weight = stats.totalPnl > 0 ? Math.min(10, Math.ceil(wr * 10)) : Math.max(-15, Math.floor(stats.totalPnl / 20));
        try {
          await queries.upsertTradePattern(userId, "conviction_range", bucket, {
            totalTrades: stats.count,
            wins: stats.wins,
            losses: stats.losses,
            totalPnlUsd: stats.totalPnl.toFixed(2),
            weightAdjustment: String(weight),
          });
        } catch { /* non-critical */ }
      }
    }

    // ── PATTERN 5: Exit Reason Effectiveness ──
    const exitStats = new Map<string, { count: number; totalPnl: number; avgPnl: number }>();
    for (const pos of allPositions) {
      const reason = pos.status === "stopped_out" ? "stop_loss" : pos.status === "tp_hit" ? "take_profit" : "other";
      const stats = exitStats.get(reason) ?? { count: 0, totalPnl: 0, avgPnl: 0 };
      stats.count++;
      stats.totalPnl += parseFloat(pos.pnlUsd ?? "0");
      stats.avgPnl = stats.totalPnl / stats.count;
      exitStats.set(reason, stats);
    }

    for (const [reason, stats] of exitStats) {
      insights.push(`Exit ${reason}: ${stats.count} trades, avg $${stats.avgPnl.toFixed(2)}, total $${stats.totalPnl.toFixed(2)}`);
    }

    // ── Generate Learning Report ──
    const report = {
      timestamp: Date.now(),
      totalTradesAnalyzed: allPositions.length,
      overallWinRate: (allPositions.filter(p => parseFloat(p.pnlUsd ?? "0") > 0).length / allPositions.length * 100).toFixed(1) + "%",
      insights,
      chainPerformance: Object.fromEntries(chainStats),
      holdDurationPerformance: Object.fromEntries(holdBuckets),
      bestHoursUTC: bestHours,
      worstHoursUTC: worstHours,
    };

    log({
      agent: "learner",
      severity: "info",
      category: "deep_analysis",
      message: `Deep analysis complete: ${insights.length} insights from ${allPositions.length} trades`,
      data: report,
    });

    state.lastReport = `${insights.length} insights from ${allPositions.length} trades. WR: ${report.overallWinRate}`;

    // Notify owner with key insights every cycle
    if (insights.length > 0) {
      await notifyOwner({
        title: `🧠 Learner Agent — ${insights.length} insights`,
        content: insights.slice(0, 10).join("\n"),
      }).catch(() => {});
    }

  } catch (err: any) {
    log({ agent: "learner", severity: "critical", category: "agent_error", message: `Learner agent error: ${err.message}` });
  }
}

// ─── AGENT SCHEDULER ─────────────────────────────────────

let monitorInterval: NodeJS.Timeout | null = null;
let optimizerInterval: NodeJS.Timeout | null = null;
let healerInterval: NodeJS.Timeout | null = null;
let learnerInterval: NodeJS.Timeout | null = null;

const MONITOR_INTERVAL = 60 * 1000;       // 60 seconds
const OPTIMIZER_INTERVAL = 30 * 60 * 1000; // 30 minutes
const HEALER_INTERVAL = 5 * 60 * 1000;    // 5 minutes
const LEARNER_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours

export function startAgentSystem(): void {
  console.log("═══════════════════════════════════════════════");
  console.log("  Autonomous Agent System v5.0 — Starting");
  console.log("  Monitor: 60s | Optimizer: 30min | Healer: 5min | Learner: 2hr");
  console.log("═══════════════════════════════════════════════");

  // Run all agents once immediately
  runMonitorAgent().catch(e => console.error("[Agent:monitor] Init error:", e));
  setTimeout(() => runHealerAgent().catch(e => console.error("[Agent:healer] Init error:", e)), 5000);
  setTimeout(() => runOptimizerAgent().catch(e => console.error("[Agent:optimizer] Init error:", e)), 15000);
  setTimeout(() => runLearnerAgent().catch(e => console.error("[Agent:learner] Init error:", e)), 30000);

  // Schedule recurring runs
  monitorInterval = setInterval(() => {
    runMonitorAgent().catch(e => console.error("[Agent:monitor] Error:", e));
  }, MONITOR_INTERVAL);

  optimizerInterval = setInterval(() => {
    runOptimizerAgent().catch(e => console.error("[Agent:optimizer] Error:", e));
  }, OPTIMIZER_INTERVAL);

  healerInterval = setInterval(() => {
    runHealerAgent().catch(e => console.error("[Agent:healer] Error:", e));
  }, HEALER_INTERVAL);

  learnerInterval = setInterval(() => {
    runLearnerAgent().catch(e => console.error("[Agent:learner] Error:", e));
  }, LEARNER_INTERVAL);

  for (const key of Object.keys(agentStates)) {
    agentStates[key].running = true;
  }
}

export function stopAgentSystem(): void {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
  if (optimizerInterval) { clearInterval(optimizerInterval); optimizerInterval = null; }
  if (healerInterval) { clearInterval(healerInterval); healerInterval = null; }
  if (learnerInterval) { clearInterval(learnerInterval); learnerInterval = null; }

  for (const key of Object.keys(agentStates)) {
    agentStates[key].running = false;
  }
  console.log("[AgentSystem] All agents stopped");
}

// ─── API EXPORTS ─────────────────────────────────────────

export function getAgentSystemStatus() {
  return {
    agents: agentStates,
    totalOptimizationsApplied,
    recentParamChanges: paramChangesHistory.slice(-20),
    diagnosticLogSize: diagnosticLog.length,
    uptime: agentStates.monitor.runCount > 0
      ? `${agentStates.monitor.runCount} monitor cycles`
      : "not started",
  };
}

export function getAgentDiagnosticLog(limit = 50) {
  return diagnosticLog.slice(-limit);
}

export function getAgentReport() {
  const recent = diagnosticLog.slice(-100);
  const criticals = recent.filter(e => e.severity === "critical");
  const warnings = recent.filter(e => e.severity === "warning");
  const fixes = recent.filter(e => e.severity === "fix_applied");

  return {
    summary: {
      totalDiagnostics: diagnosticLog.length,
      recentCriticals: criticals.length,
      recentWarnings: warnings.length,
      recentFixes: fixes.length,
      totalOptimizations: totalOptimizationsApplied,
    },
    agents: Object.entries(agentStates).map(([name, state]) => ({
      name,
      running: state.running,
      lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : "never",
      runCount: state.runCount,
      issuesFound: state.issuesFound,
      fixesApplied: state.fixesApplied,
      lastReport: state.lastReport,
    })),
    recentCriticals: criticals.slice(-5),
    recentFixes: fixes.slice(-10),
    paramChanges: paramChangesHistory.slice(-10),
  };
}

// Manual trigger for any agent
export async function triggerAgent(agentName: string): Promise<string> {
  switch (agentName) {
    case "monitor":
      await runMonitorAgent();
      return "Monitor agent completed";
    case "optimizer":
      await runOptimizerAgent();
      return "Optimizer agent completed";
    case "healer":
      await runHealerAgent();
      return "Healer agent completed";
    case "learner":
      await runLearnerAgent();
      return "Learner agent completed";
    default:
      return `Unknown agent: ${agentName}`;
  }
}
