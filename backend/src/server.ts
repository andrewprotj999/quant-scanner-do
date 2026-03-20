/**
 * Express API Server — Standalone Memecoin Scanner
 *
 * Endpoints:
 * GET  /api/health         → system health status
 * GET  /api/coins          → ranked coins from latest scan
 * GET  /api/positions      → open paper positions
 * GET  /api/history        → closed trades
 * GET  /api/engine         → engine state
 * POST /api/engine/start   → start engine
 * POST /api/engine/stop    → stop engine
 * GET  /api/backtest       → backtest history
 * POST /api/backtest/run   → trigger manual backtest
 * GET  /api/params         → current engine params
 * GET  /api/health/metrics → detailed health metrics
 *
 * Auth: Simple API key via X-API-KEY header or ?key= query param
 */

import express from "express";
import cors from "cors";
import { CONFIG } from "./config.js";
import { initDb } from "./db/index.js";
import * as queries from "./db/queries.js";
import {
  startEngine,
  stopEngine,
  isEngineRunning,
  getDynamicParams,
} from "./core/paperEngine.js";
import {
  getHealthStatus,
  getRecentCycles,
  getRecentErrors,
  startHealthChecks,
  stopHealthChecks,
} from "./core/healthMonitor.js";
import {
  runAutoTune,
  revertToBaseline,
  getABComparison,
  getAutoTunerStatus,
  getAutoTuneHistory,
  startAutoTuneSchedule,
  stopAutoTuneSchedule,
  getCurrentWeights,
} from "./core/outcomeAutoTuner.js";
import {
  assessRisk,
  calculateKelly,
  detectMarketRegime,
  getRiskConstants,
} from "./core/riskManager.js";

const app = express();
app.use(cors());
app.use(express.json());

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────

function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!CONFIG.apiKey) return next(); // No key configured = open access

  const key =
    req.headers["x-api-key"] ||
    req.query.key;

  if (key === CONFIG.apiKey) return next();

  res.status(401).json({ error: "Unauthorized — provide X-API-KEY header" });
}

// Public health check (no auth)
app.get("/api/health", (_req, res) => {
  const health = getHealthStatus();
  res.json({
    status: "ok",
    engine: isEngineRunning() ? "running" : "stopped",
    uptime: process.uptime(),
    grade: health.grade,
    totalCycles: health.totalCycles,
    successRate: health.successRate,
    avgCycleMs: health.avgCycleMs,
    timestamp: new Date().toISOString(),
  });
});

// All other routes require auth
app.use("/api", authMiddleware);

// ─── COINS (latest scan results) ────────────────────────────

app.get("/api/coins", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const logs = await queries.getRecentScanLogs(1, 1);
    const positions = await queries.getOpenPositions(1);

    // Return open positions as "top coins" since they passed qualification
    const coins = positions.map((p) => ({
      symbol: p.tokenSymbol,
      chain: p.chain,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      pnlPercent: p.pnlPercent,
      pnlUsd: p.pnlUsd,
      conviction: p.convictionScore,
      status: p.status,
    }));

    res.json({
      coins,
      lastScan: logs[0] ?? null,
      totalOpen: positions.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POSITIONS ──────────────────────────────────────────────

app.get("/api/positions", async (_req, res) => {
  try {
    const positions = await queries.getOpenPositions(1);
    res.json({ positions, count: positions.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TRADE HISTORY ──────────────────────────────────────────

app.get("/api/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const trades = await queries.getClosedTrades(1, limit);
    res.json({ trades, count: trades.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ENGINE STATE ───────────────────────────────────────────

app.get("/api/engine", async (_req, res) => {
  try {
    const state = await queries.getEngineState(1);
    res.json({
      state,
      running: isEngineRunning(),
      params: getDynamicParams(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/engine/start", async (_req, res) => {
  try {
    if (isEngineRunning()) {
      return res.json({ message: "Engine already running" });
    }
    startEngine(1);
    startHealthChecks(60_000);
    res.json({ message: "Engine started", running: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/engine/stop", async (_req, res) => {
  try {
    stopEngine();
    stopHealthChecks();
    res.json({ message: "Engine stopped", running: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HEALTH METRICS ─────────────────────────────────────────

app.get("/api/health/metrics", (_req, res) => {
  const health = getHealthStatus();
  const cycles = getRecentCycles(20);
  const errors = getRecentErrors(10);

  res.json({
    health,
    recentCycles: cycles,
    recentErrors: errors,
  });
});

// ─── SCAN LOGS ──────────────────────────────────────────────

app.get("/api/scans", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const logs = await queries.getRecentScanLogs(1, limit);
    res.json({ logs, count: logs.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PARAMS ─────────────────────────────────────────────────

app.get("/api/params", async (_req, res) => {
  try {
    const params = await queries.getEngineParams();
    res.json({ params: params ?? getDynamicParams() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LEARNING / PATTERNS ────────────────────────────────────

app.get("/api/patterns", async (_req, res) => {
  try {
    const patterns = await queries.getTradePatterns(1);
    res.json({ patterns, count: patterns.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AUTO-TUNER ────────────────────────────────────────────

app.get("/api/autotuner/status", async (_req, res) => {
  try {
    const status = getAutoTunerStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/autotuner/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const history = await getAutoTuneHistory(limit);
    res.json({ runs: history, count: history.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/autotuner/run", async (_req, res) => {
  try {
    const result = await runAutoTune("manual");
    res.json({ success: true, run: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/autotuner/revert", async (_req, res) => {
  try {
    const result = await revertToBaseline();
    res.json({ success: true, run: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/autotuner/comparison", async (_req, res) => {
  try {
    const comparison = getABComparison();
    res.json(comparison);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/autotuner/weights", async (_req, res) => {
  try {
    const weights = getCurrentWeights();
    res.json({ weights });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RISK MANAGER ──────────────────────────────────────────

app.get("/api/risk", async (_req, res) => {
  try {
    const assessment = await assessRisk(1);
    res.json({
      ...assessment,
      chainExposure: Object.fromEntries(assessment.chainExposure),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/risk/kelly", async (_req, res) => {
  try {
    const kelly = await calculateKelly(1);
    res.json(kelly);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/risk/regime", async (_req, res) => {
  try {
    const regime = await detectMarketRegime();
    res.json(regime);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/risk/constants", (_req, res) => {
  res.json(getRiskConstants());
});

// ─── STARTUP ────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  Memecoin Scanner — Standalone Engine v3.0");
  console.log("  Risk Manager + Kelly + Regime Detection");
  console.log("═══════════════════════════════════════════════");

  // Initialize database
  console.log("[DB] Initializing SQLite database...");
  await initDb();
  console.log("[DB] Ready");

  // Start API server
  const port = CONFIG.port;
  app.listen(port, "0.0.0.0", () => {
    console.log(`[API] Server running on http://0.0.0.0:${port}`);
    console.log(`[API] Health: http://localhost:${port}/api/health`);
    console.log(`[API] Coins:  http://localhost:${port}/api/coins`);
  });

  // Auto-start engine if configured
  if (CONFIG.autoStart) {
    console.log("[Engine] Auto-starting scanner...");
    startEngine(1);
    startHealthChecks(60_000);
  } else {
    console.log("[Engine] Auto-start disabled. POST /api/engine/start to begin.");
  }

  // Start auto-tuner schedule
  startAutoTuneSchedule();
  console.log("[AutoTuner] Outcome auto-tuner schedule started");
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

export { app };
