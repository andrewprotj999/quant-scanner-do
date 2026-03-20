/**
 * Database Query Helpers
 *
 * All database operations in one place. Drizzle with better-sqlite3
 * is synchronous, so we wrap in async for API compatibility.
 */

import { eq, and, desc, ne } from "drizzle-orm";
import { getDb } from "./index.js";
import * as s from "./schema.js";

// ─── USER QUERIES ────────────────────────────────────────────

export async function createUser(data: s.InsertUser) {
  const db = getDb();
  const result = db.insert(s.users).values(data).returning().all();
  return result[0];
}

export async function getUserByUsername(username: string) {
  const db = getDb();
  const rows = db.select().from(s.users).where(eq(s.users.username, username)).limit(1).all();
  return rows[0] ?? null;
}

export async function getUserById(id: number) {
  const db = getDb();
  const rows = db.select().from(s.users).where(eq(s.users.id, id)).limit(1).all();
  return rows[0] ?? null;
}

// ─── TRADE QUERIES ───────────────────────────────────────────

export async function createTrade(data: s.InsertTrade) {
  const db = getDb();
  const result = db.insert(s.trades).values(data).returning().all();
  return result[0];
}

export async function getTradesByUser(userId: number) {
  const db = getDb();
  return db.select().from(s.trades).where(eq(s.trades.userId, userId)).orderBy(desc(s.trades.createdAt)).all();
}

export async function updateTrade(id: number, data: Partial<s.InsertTrade>) {
  const db = getDb();
  db.update(s.trades).set(data).where(eq(s.trades.id, id)).run();
}

// ─── EQUITY SNAPSHOT QUERIES ─────────────────────────────────

export async function createEquitySnapshot(data: s.InsertEquitySnapshot) {
  const db = getDb();
  db.insert(s.equitySnapshots).values(data).run();
}

export async function getEquitySnapshots(userId: number, limit = 100) {
  const db = getDb();
  return db.select().from(s.equitySnapshots)
    .where(eq(s.equitySnapshots.userId, userId))
    .orderBy(desc(s.equitySnapshots.timestamp))
    .limit(limit).all();
}

// ─── PRICE ALERT QUERIES ─────────────────────────────────────

export async function createPriceAlert(data: any) {
  const db = getDb();
  const result = db.insert(s.priceAlerts).values(data).returning().all();
  return result[0];
}

export async function getActiveAlerts(userId: number) {
  const db = getDb();
  return db.select().from(s.priceAlerts)
    .where(and(eq(s.priceAlerts.userId, userId), eq(s.priceAlerts.status, "active"))).all();
}

export async function updateAlert(id: number, data: any) {
  const db = getDb();
  db.update(s.priceAlerts).set(data).where(eq(s.priceAlerts.id, id)).run();
}

// ─── PAPER POSITION QUERIES ──────────────────────────────────

export async function createPaperPosition(data: s.InsertPaperPosition) {
  const db = getDb();
  const result = db.insert(s.paperPositions).values(data).returning().all();
  return result[0];
}

export async function getOpenPositions(userId: number) {
  const db = getDb();
  return db.select().from(s.paperPositions)
    .where(and(eq(s.paperPositions.userId, userId), eq(s.paperPositions.status, "open"))).all();
}

export async function getClosedPositions(userId: number, limit = 50) {
  const db = getDb();
  return db.select().from(s.paperPositions)
    .where(and(eq(s.paperPositions.userId, userId), ne(s.paperPositions.status, "open")))
    .orderBy(desc(s.paperPositions.closedAt))
    .limit(limit).all();
}

// Alias for server.ts compatibility
export const getClosedTrades = getClosedPositions;

export async function updatePaperPosition(id: number, data: Partial<s.InsertPaperPosition>) {
  const db = getDb();
  db.update(s.paperPositions).set(data).where(eq(s.paperPositions.id, id)).run();
}

export async function getAllPositions(userId: number) {
  const db = getDb();
  return db.select().from(s.paperPositions)
    .where(eq(s.paperPositions.userId, userId))
    .orderBy(desc(s.paperPositions.openedAt)).all();
}

// ─── ENGINE STATE QUERIES ────────────────────────────────────

export async function getEngineState(userId: number) {
  const db = getDb();
  const rows = db.select().from(s.engineState).where(eq(s.engineState.userId, userId)).limit(1).all();
  return rows[0] ?? null;
}

export async function upsertEngineState(userId: number, data: Partial<s.EngineStateRow>) {
  const db = getDb();
  const existing = await getEngineState(userId);
  if (existing) {
    db.update(s.engineState).set(data).where(eq(s.engineState.userId, userId)).run();
  } else {
    db.insert(s.engineState).values({ userId, ...data } as any).run();
  }
}

// ─── SCAN LOG QUERIES ────────────────────────────────────────

export async function createScanLog(data: any) {
  const db = getDb();
  db.insert(s.scanLogs).values(data).run();
}

export async function getRecentScanLogs(userId: number, limit = 20) {
  const db = getDb();
  return db.select().from(s.scanLogs)
    .where(eq(s.scanLogs.userId, userId))
    .orderBy(desc(s.scanLogs.scannedAt))
    .limit(limit).all();
}

// ─── TRADE PATTERN QUERIES ───────────────────────────────────

export async function upsertTradePattern(userId: number, patternType: string, patternValue: string, data: any) {
  const db = getDb();
  const existing = db.select().from(s.tradePatterns)
    .where(and(
      eq(s.tradePatterns.userId, userId),
      eq(s.tradePatterns.patternType, patternType),
      eq(s.tradePatterns.patternValue, patternValue)
    )).limit(1).all();

  if (existing[0]) {
    db.update(s.tradePatterns).set({ ...data, lastUpdated: new Date() })
      .where(eq(s.tradePatterns.id, existing[0].id)).run();
  } else {
    db.insert(s.tradePatterns).values({
      userId, patternType, patternValue, ...data,
    }).run();
  }
}

export async function getTradePatterns(userId: number) {
  const db = getDb();
  return db.select().from(s.tradePatterns)
    .where(eq(s.tradePatterns.userId, userId)).all();
}

// ─── LEARNING LOG QUERIES ────────────────────────────────────

export async function createLearningLog(data: any) {
  const db = getDb();
  db.insert(s.learningLogs).values(data).run();
}

// ─── BACKTEST RESULT QUERIES ─────────────────────────────────

export async function createBacktestResult(data: any): Promise<number> {
  const db = getDb();
  const result = db.insert(s.backtestResults).values(data).returning({ id: s.backtestResults.id }).all();
  return result[0].id;
}

export async function getRecentBacktestResults(limit = 10) {
  const db = getDb();
  return db.select().from(s.backtestResults)
    .orderBy(desc(s.backtestResults.runTime))
    .limit(limit).all();
}

// ─── ENGINE PARAMS QUERIES ───────────────────────────────────

export async function getEngineParams() {
  const db = getDb();
  const rows = db.select().from(s.engineParams).limit(1).all();
  return rows[0] ?? null;
}

export async function upsertEngineParams(data: Partial<s.EngineParamsRow>) {
  const db = getDb();
  const existing = db.select().from(s.engineParams).limit(1).all();
  if (existing[0]) {
    db.update(s.engineParams).set({ ...data, lastTuned: new Date() })
      .where(eq(s.engineParams.id, existing[0].id)).run();
  } else {
    db.insert(s.engineParams).values(data as any).run();
  }
}

// ─── TUNING HISTORY QUERIES ──────────────────────────────────

export async function createTuningHistoryEntry(data: any) {
  const db = getDb();
  db.insert(s.tuningHistory).values(data).run();
}

export async function getRecentTuningHistory(limit = 20) {
  const db = getDb();
  return db.select().from(s.tuningHistory)
    .orderBy(desc(s.tuningHistory.tunedAt))
    .limit(limit).all();
}

// ─── AUTO-TUNE RUN QUERIES ──────────────────────────────────

export async function createAutoTuneRun(data: any) {
  const db = getDb();
  db.insert(s.autoTuneRuns).values({
    runType: data.runType,
    outcomeCount: data.outcomeCount,
    winRate: data.winRate,
    avgPnl: data.avgPnl,
    adjustmentsMade: data.adjustmentsMade,
    weightsBefore: data.weightsBefore,
    weightsAfter: data.weightsAfter,
    analysisSummary: data.analysisSummary,
  }).run();
}

export async function getAutoTuneRuns(limit = 20) {
  const db = getDb();
  return db.select().from(s.autoTuneRuns)
    .orderBy(desc(s.autoTuneRuns.runAt))
    .limit(limit).all();
}
