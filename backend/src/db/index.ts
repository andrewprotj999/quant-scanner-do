/**
 * Database Connection — SQLite via better-sqlite3 + Drizzle ORM
 *
 * Zero-config, file-based database. No external services needed.
 * Data persists in ./data/scanner.db by default.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { CONFIG } from "../config.js";
import { mkdirSync } from "fs";
import { dirname } from "path";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (!_db) {
    // Ensure data directory exists
    mkdirSync(dirname(CONFIG.dbPath), { recursive: true });

    _sqlite = new Database(CONFIG.dbPath);

    // Enable WAL mode for better concurrent read performance
    _sqlite.pragma("journal_mode = WAL");
    _sqlite.pragma("busy_timeout = 5000");
    _sqlite.pragma("synchronous = NORMAL");
    _sqlite.pragma("foreign_keys = ON");

    _db = drizzle(_sqlite, { schema });

    console.log(`[DB] Connected to SQLite at ${CONFIG.dbPath}`);
  }
  return _db;
}

export function closeDb() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
    console.log("[DB] Connection closed");
  }
}

export async function initDb() {
  const db = getDb();
  // Run migrations / create tables
  const { runMigrations } = await import("./migrate.js");
  runMigrations(db);
  console.log("[DB] Migrations complete");
}

export { schema };
