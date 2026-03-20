/**
 * Database Schema — SQLite via Drizzle ORM
 *
 * Migrated from MySQL (Manus TiDB) to SQLite for zero-config self-hosting.
 * All tables preserved with SQLite-compatible types.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─── USERS ────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).default("admin").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── TRADES ───────────────────────────────────────────────

export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  pair: text("pair").notNull(),
  chain: text("chain").default("solana"),
  direction: text("direction").default("long"),
  entryPrice: text("entry_price"),
  exitPrice: text("exit_price"),
  status: text("status", { enum: ["open", "closed", "cancelled"] }).default("open").notNull(),
  positionSize: text("position_size"),
  pnl: text("pnl"),
  pnlPercent: text("pnl_percent"),
  entryDate: integer("entry_date", { mode: "timestamp_ms" }),
  exitDate: integer("exit_date", { mode: "timestamp_ms" }),
  notes: text("notes"),
  tags: text("tags"),
  source: text("source").default("manual"),
  conviction: integer("conviction"),
  entryReason: text("entry_reason"),
  exitReason: text("exit_reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── EQUITY SNAPSHOTS ─────────────────────────────────────

export const equitySnapshots = sqliteTable("equity_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  equity: text("equity").notNull(),
  dailyPnl: text("daily_pnl"),
  drawdown: text("drawdown"),
  openPositions: integer("open_positions"),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── PRICE ALERTS ─────────────────────────────────────────

export const priceAlerts = sqliteTable("price_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  pair: text("pair").notNull(),
  chain: text("chain").default("solana"),
  targetPrice: text("target_price").notNull(),
  alertType: text("alert_type", {
    enum: ["entry", "tp1", "tp2", "stop_loss", "custom"],
  }).default("custom").notNull(),
  direction: text("direction", { enum: ["above", "below"] }).default("above").notNull(),
  currentPrice: text("current_price"),
  status: text("status", { enum: ["active", "triggered", "cancelled"] }).default("active").notNull(),
  triggeredAt: integer("triggered_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── PAPER POSITIONS ──────────────────────────────────────

export const paperPositions = sqliteTable("paper_positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  tokenAddress: text("token_address").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  chain: text("chain").notNull(),
  pairAddress: text("pair_address"),
  entryPrice: text("entry_price").notNull(),
  currentPrice: text("current_price"),
  exitPrice: text("exit_price"),
  positionSizeUsd: text("position_size_usd").notNull(),
  tokenAmount: text("token_amount").notNull(),
  status: text("status", {
    enum: ["open", "closed", "stopped_out", "tp_hit"],
  }).default("open").notNull(),
  pnlUsd: text("pnl_usd"),
  pnlPercent: text("pnl_percent"),
  highestPrice: text("highest_price"),
  lowestPrice: text("lowest_price"),
  stopLossPrice: text("stop_loss_price"),
  tp1Price: text("tp1_price"),
  tp1Hit: integer("tp1_hit", { mode: "boolean" }).default(false),
  tp1Partial: integer("tp1_partial", { mode: "boolean" }).default(false),
  tpEarlyHit: integer("tp_early_hit", { mode: "boolean" }).default(false),
  tp2Hit: integer("tp2_hit", { mode: "boolean" }).default(false),
  originalPositionSize: text("original_position_size"),
  sizeSoldPercent: text("size_sold_percent").default("0"),
  entryVolume: text("entry_volume"),
  entryLiquidity: text("entry_liquidity"),
  entryFdv: text("entry_fdv"),
  convictionScore: integer("conviction_score"),
  entryReason: text("entry_reason"),
  exitReason: text("exit_reason"),
  openedAt: integer("opened_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
});

// ─── SCAN LOGS ────────────────────────────────────────────

export const scanLogs = sqliteTable("scan_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  tokensScanned: integer("tokens_scanned").default(0),
  tokensQualified: integer("tokens_qualified").default(0),
  tradesExecuted: integer("trades_executed").default(0),
  positionsUpdated: integer("positions_updated").default(0),
  topCandidate: text("top_candidate"),
  topCandidateScore: integer("top_candidate_score"),
  topCandidateChain: text("top_candidate_chain"),
  topCandidatePrice: text("top_candidate_price"),
  topCandidateVolume: text("top_candidate_volume"),
  topCandidateLiquidity: text("top_candidate_liquidity"),
  topCandidateChange: text("top_candidate_change"),
  scanDurationMs: integer("scan_duration_ms"),
  errors: text("errors"),
  scannedAt: integer("scanned_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── ENGINE STATE ─────────────────────────────────────────

export const engineState = sqliteTable("engine_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique(),
  status: text("status", {
    enum: ["running", "paused", "stopped", "loss_pause", "daily_halt"],
  }).default("stopped").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  lastScanAt: integer("last_scan_at", { mode: "timestamp_ms" }),
  totalScans: integer("total_scans").default(0),
  totalTrades: integer("total_trades").default(0),
  totalPnlUsd: text("total_pnl_usd").default("0"),
  dailyPnlUsd: text("daily_pnl_usd").default("0"),
  dailyPnlResetAt: integer("daily_pnl_reset_at", { mode: "timestamp_ms" }),
  consecutiveLosses: integer("consecutive_losses").default(0),
  equity: text("equity").default("1000"),
  peakEquity: text("peak_equity").default("1000"),
  lastScanTokensScanned: integer("last_scan_tokens_scanned"),
  lastScanTokensQualified: integer("last_scan_tokens_qualified"),
  lastScanTopCandidate: text("last_scan_top_candidate"),
  lastScanTopScore: integer("last_scan_top_score"),
  lastScanTopChain: text("last_scan_top_chain"),
});

// ─── TRADE PATTERNS (Learning System) ─────────────────────

export const tradePatterns = sqliteTable("trade_patterns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  patternType: text("pattern_type").notNull(),
  patternValue: text("pattern_value").notNull(),
  totalTrades: integer("total_trades").default(0),
  wins: integer("wins").default(0),
  losses: integer("losses").default(0),
  avgPnlPercent: text("avg_pnl_percent").default("0"),
  totalPnlUsd: text("total_pnl_usd").default("0"),
  weightAdjustment: text("weight_adjustment").default("0"),
  lastUpdated: integer("last_updated", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── LEARNING LOGS ────────────────────────────────────────

export const learningLogs = sqliteTable("learning_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  tradeId: integer("trade_id"),
  tokenSymbol: text("token_symbol"),
  chain: text("chain"),
  outcome: text("outcome"),
  pnlPercent: text("pnl_percent"),
  convictionScore: integer("conviction_score"),
  holdDurationMs: integer("hold_duration_ms"),
  entryVolume: text("entry_volume"),
  entryLiquidity: text("entry_liquidity"),
  exitReason: text("exit_reason"),
  lessonsLearned: text("lessons_learned"),
  loggedAt: integer("logged_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── BACKTEST RESULTS ─────────────────────────────────────

export const backtestResults = sqliteTable("backtest_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trigger: text("trigger", { enum: ["scheduled", "manual"] }).default("manual").notNull(),
  tokensScanned: integer("tokens_scanned").default(0),
  oldQualified: integer("old_qualified").default(0),
  oldWins: integer("old_wins").default(0),
  oldLosses: integer("old_losses").default(0),
  oldWinRate: text("old_win_rate"),
  oldPnlUsd: text("old_pnl_usd"),
  oldRugsCaught: integer("old_rugs_caught").default(0),
  newQualified: integer("new_qualified").default(0),
  newWins: integer("new_wins").default(0),
  newLosses: integer("new_losses").default(0),
  newWinRate: text("new_win_rate"),
  newPnlUsd: text("new_pnl_usd"),
  newRugsCaught: integer("new_rugs_caught").default(0),
  rugsBlocked: integer("rugs_blocked").default(0),
  pnlDifference: text("pnl_difference"),
  winRateDifference: text("win_rate_difference"),
  summaryFindings: text("summary_findings"),
  tokenBreakdown: text("token_breakdown"),
  autoTuned: integer("auto_tuned", { mode: "boolean" }).default(false),
  durationMs: integer("duration_ms"),
  runTime: integer("run_time", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── ENGINE PARAMS (Dynamic Tuning) ───────────────────────

export const engineParams = sqliteTable("engine_params", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  minConviction: integer("min_conviction").default(70),
  trailPreTp1: text("trail_pre_tp1").default("12"),
  trailPostTp1: text("trail_post_tp1").default("8"),
  trailBigWin: text("trail_big_win").default("6"),
  stopLossPercent: text("stop_loss_percent").default("10"),
  tp1Percent: text("tp1_percent").default("25"),
  tp2Percent: text("tp2_percent").default("40"),
  tpEarlyPercent: text("tp_early_percent").default("12"),
  tpEarlySellRatio: text("tp_early_sell_ratio").default("0.20"),
  tp1SellRatio: text("tp1_sell_ratio").default("0.25"),
  tp2SellRatio: text("tp2_sell_ratio").default("0.25"),
  trailInitial: text("trail_initial").default("10"),
  trailGainIncrement: text("trail_gain_increment").default("5"),
  trailMinPercent: text("trail_min_percent").default("4"),
  earlyProfitLockPercent: text("early_profit_lock_percent").default("2"),
  breakEvenThreshold: text("break_even_threshold").default("15"),
  minRiskPercent: text("min_risk_percent").default("1.0"),
  maxRiskPercent: text("max_risk_percent").default("2.5"),
  maxPosPctLow: text("max_pos_pct_low").default("3"),
  maxPosPctHigh: text("max_pos_pct_high").default("7"),
  circuitBreakerPct: text("circuit_breaker_pct").default("50"),
  rugLiqFdvMax: text("rug_liq_fdv_max").default("5"),
  volDryUpThreshold: text("vol_dry_up_threshold").default("0.02"),
  version: integer("version").default(1),
  lastTuned: integer("last_tuned", { mode: "timestamp_ms" }),
});

// ─── TUNING HISTORY ───────────────────────────────────────

export const tuningHistory = sqliteTable("tuning_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  backtestId: integer("backtest_id"),
  paramName: text("param_name").notNull(),
  oldValue: text("old_value").notNull(),
  newValue: text("new_value").notNull(),
  reason: text("reason"),
  confidence: text("confidence", { enum: ["high", "medium", "low"] }).default("medium").notNull(),
  tunedAt: integer("tuned_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// ─── TYPE EXPORTS ─────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;
export type PaperPosition = typeof paperPositions.$inferSelect;
export type InsertPaperPosition = typeof paperPositions.$inferInsert;
export type EngineStateRow = typeof engineState.$inferSelect;
export type BacktestResultRow = typeof backtestResults.$inferSelect;
export type EngineParamsRow = typeof engineParams.$inferSelect;
export type TuningHistoryRow = typeof tuningHistory.$inferSelect;
export type EquitySnapshot = typeof equitySnapshots.$inferSelect;
export type InsertEquitySnapshot = typeof equitySnapshots.$inferInsert;

// ─── AUTO-TUNE RUNS (Outcome Auto-Tuner) ─────────────────

export const autoTuneRuns = sqliteTable("auto_tune_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runType: text("run_type", { enum: ["scheduled", "manual", "revert"] }).default("manual").notNull(),
  outcomeCount: integer("outcome_count").default(0),
  winRate: real("win_rate"),
  avgPnl: real("avg_pnl"),
  adjustmentsMade: integer("adjustments_made").default(0),
  weightsBefore: text("weights_before"),
  weightsAfter: text("weights_after"),
  analysisSummary: text("analysis_summary"),
  runAt: integer("run_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

export type AutoTuneRunRow = typeof autoTuneRuns.$inferSelect;
export type InsertAutoTuneRun = typeof autoTuneRuns.$inferInsert;
