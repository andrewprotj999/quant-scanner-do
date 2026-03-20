/**
 * Database Migration Script
 *
 * Creates all tables in the SQLite database.
 * Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
 *
 * Can be used as:
 * - Imported: runMigrations(db)
 * - CLI: npx tsx src/db/migrate.ts
 */

const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pair TEXT NOT NULL,
    chain TEXT DEFAULT 'solana',
    direction TEXT DEFAULT 'long',
    entry_price TEXT,
    exit_price TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    position_size TEXT,
    pnl TEXT,
    pnl_percent TEXT,
    entry_date INTEGER,
    exit_date INTEGER,
    notes TEXT,
    tags TEXT,
    source TEXT DEFAULT 'manual',
    conviction INTEGER,
    entry_reason TEXT,
    exit_reason TEXT,
    created_at INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    equity TEXT NOT NULL,
    daily_pnl TEXT,
    drawdown TEXT,
    open_positions INTEGER,
    timestamp INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pair TEXT NOT NULL,
    chain TEXT DEFAULT 'solana',
    target_price TEXT NOT NULL,
    alert_type TEXT NOT NULL DEFAULT 'custom',
    direction TEXT NOT NULL DEFAULT 'above',
    current_price TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    triggered_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS paper_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_address TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    chain TEXT NOT NULL,
    pair_address TEXT,
    entry_price TEXT NOT NULL,
    current_price TEXT,
    exit_price TEXT,
    position_size_usd TEXT NOT NULL,
    token_amount TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    pnl_usd TEXT,
    pnl_percent TEXT,
    highest_price TEXT,
    lowest_price TEXT,
    stop_loss_price TEXT,
    tp1_price TEXT,
    tp1_hit INTEGER DEFAULT 0,
    tp1_partial INTEGER DEFAULT 0,
    entry_volume TEXT,
    entry_liquidity TEXT,
    entry_fdv TEXT,
    conviction_score INTEGER,
    entry_reason TEXT,
    exit_reason TEXT,
    opened_at INTEGER DEFAULT (unixepoch() * 1000),
    closed_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS scan_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tokens_scanned INTEGER DEFAULT 0,
    tokens_qualified INTEGER DEFAULT 0,
    trades_executed INTEGER DEFAULT 0,
    positions_updated INTEGER DEFAULT 0,
    top_candidate TEXT,
    top_candidate_score INTEGER,
    top_candidate_chain TEXT,
    top_candidate_price TEXT,
    top_candidate_volume TEXT,
    top_candidate_liquidity TEXT,
    top_candidate_change TEXT,
    scan_duration_ms INTEGER,
    errors TEXT,
    scanned_at INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS engine_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'stopped',
    started_at INTEGER,
    last_scan_at INTEGER,
    total_scans INTEGER DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    total_pnl_usd TEXT DEFAULT '0',
    daily_pnl_usd TEXT DEFAULT '0',
    daily_pnl_reset_at INTEGER,
    consecutive_losses INTEGER DEFAULT 0,
    equity TEXT DEFAULT '1000',
    peak_equity TEXT DEFAULT '1000',
    last_scan_tokens_scanned INTEGER,
    last_scan_tokens_qualified INTEGER,
    last_scan_top_candidate TEXT,
    last_scan_top_score INTEGER,
    last_scan_top_chain TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS trade_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pattern_type TEXT NOT NULL,
    pattern_value TEXT NOT NULL,
    total_trades INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    avg_pnl_percent TEXT DEFAULT '0',
    total_pnl_usd TEXT DEFAULT '0',
    weight_adjustment TEXT DEFAULT '0',
    last_updated INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS learning_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    trade_id INTEGER,
    token_symbol TEXT,
    chain TEXT,
    outcome TEXT,
    pnl_percent TEXT,
    conviction_score INTEGER,
    hold_duration_ms INTEGER,
    entry_volume TEXT,
    entry_liquidity TEXT,
    exit_reason TEXT,
    lessons_learned TEXT,
    logged_at INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS backtest_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    tokens_scanned INTEGER DEFAULT 0,
    old_qualified INTEGER DEFAULT 0,
    old_wins INTEGER DEFAULT 0,
    old_losses INTEGER DEFAULT 0,
    old_win_rate TEXT,
    old_pnl_usd TEXT,
    old_rugs_caught INTEGER DEFAULT 0,
    new_qualified INTEGER DEFAULT 0,
    new_wins INTEGER DEFAULT 0,
    new_losses INTEGER DEFAULT 0,
    new_win_rate TEXT,
    new_pnl_usd TEXT,
    new_rugs_caught INTEGER DEFAULT 0,
    rugs_blocked INTEGER DEFAULT 0,
    pnl_difference TEXT,
    win_rate_difference TEXT,
    summary_findings TEXT,
    token_breakdown TEXT,
    auto_tuned INTEGER DEFAULT 0,
    duration_ms INTEGER,
    run_time INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS engine_params (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    min_conviction INTEGER DEFAULT 70,
    trail_pre_tp1 TEXT DEFAULT '12',
    trail_post_tp1 TEXT DEFAULT '8',
    trail_big_win TEXT DEFAULT '6',
    stop_loss_percent TEXT DEFAULT '10',
    tp1_percent TEXT DEFAULT '25',
    break_even_threshold TEXT DEFAULT '15',
    min_risk_percent TEXT DEFAULT '1.0',
    max_risk_percent TEXT DEFAULT '2.5',
    max_pos_pct_low TEXT DEFAULT '3',
    max_pos_pct_high TEXT DEFAULT '7',
    circuit_breaker_pct TEXT DEFAULT '50',
    rug_liq_fdv_max TEXT DEFAULT '5',
    vol_dry_up_threshold TEXT DEFAULT '0.02',
    version INTEGER DEFAULT 1,
    last_tuned INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS tuning_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backtest_id INTEGER,
    param_name TEXT NOT NULL,
    old_value TEXT NOT NULL,
    new_value TEXT NOT NULL,
    reason TEXT,
    confidence TEXT NOT NULL DEFAULT 'medium',
    tuned_at INTEGER DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS auto_tune_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT NOT NULL DEFAULT 'manual',
    outcome_count INTEGER DEFAULT 0,
    win_rate REAL,
    avg_pnl REAL,
    adjustments_made INTEGER DEFAULT 0,
    weights_before TEXT,
    weights_after TEXT,
    analysis_summary TEXT,
    run_at INTEGER DEFAULT (unixepoch() * 1000)
  )`,
];

/**
 * Run all migrations on the given database instance.
 * Can accept either a Drizzle db or a raw better-sqlite3 instance.
 */
export function runMigrations(db: any): void {
  // If it's a Drizzle instance, get the underlying driver
  const rawDb = db._.session?.client ?? db;

  console.log("[Migration] Running database migrations...");

  for (const sql of migrations) {
    try {
      if (typeof rawDb.exec === "function") {
        rawDb.exec(sql);
      } else {
        // Drizzle execute
        db.run(sql);
      }
      const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
      console.log(`  + ${tableName}`);
    } catch (err: any) {
      console.error(`  x Failed:`, err.message);
    }
  }

  console.log("[Migration] Complete!");
}

// CLI mode: run directly
if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  const Database = (await import("better-sqlite3")).default;
  const { CONFIG } = await import("../config.js");
  const { mkdirSync } = await import("fs");
  const { dirname } = await import("path");

  mkdirSync(dirname(CONFIG.dbPath), { recursive: true });
  const sqliteDb = new Database(CONFIG.dbPath);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");

  runMigrations(sqliteDb);
  sqliteDb.close();
}
