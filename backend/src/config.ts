import dotenv from "dotenv";
import path from "path";
// Load .env from project root (one level up from backend/)
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
// Also try local .env
dotenv.config();
export const CONFIG = {
  // Server
  port: parseInt(process.env.PORT ?? "3001", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Auth
  apiKey: process.env.API_KEY ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin123",
  // Scanner
  scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS ?? "30000", 10),
  maxPositions: parseInt(process.env.MAX_POSITIONS ?? "20", 10),
  autoStart: (process.env.AUTO_START ?? "true") === "true",
  // Stale position management
  stalePositionTimeoutMs: parseInt(process.env.STALE_POSITION_TIMEOUT_MS ?? String(4 * 60 * 60 * 1000), 10), // 4 hours default
  stalePositionMinMovePct: parseFloat(process.env.STALE_POSITION_MIN_MOVE_PCT ?? "5"), // Must move at least 5% from entry
  unfetchableMaxRetries: parseInt(process.env.UNFETCHABLE_MAX_RETRIES ?? "10", 10), // Close after 10 failed price fetches (~5 min)
  // Notifications (Telegram)
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  // Discord
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? "",
  // Database
  dbPath: process.env.DATABASE_PATH ?? "./data/scanner.db",
  // API Keys (optional, for future Birdeye etc.)
  birdeyeApiKey: process.env.BIRDEYE_API_KEY ?? "",
  // CORS
  corsOrigins: process.env.FRONTEND_URL ?? "http://localhost:5173",
};
