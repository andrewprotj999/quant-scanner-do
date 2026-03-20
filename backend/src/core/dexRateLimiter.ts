/**
 * Global DexScreener Rate Limiter — Standalone Version
 *
 * Token-bucket rate limiter that caps DexScreener API requests to stay
 * within free-tier limits (~30 req/min). All DexScreener calls should
 * go through `dexFetch()` instead of raw `trackedFetch()`.
 *
 * Features:
 * - Token bucket with configurable rate (default 25/min with burst of 8)
 * - Request queue with priority (position monitoring > scanning > outcome tracking)
 * - Automatic retry on 429 with exponential backoff
 * - Response caching with configurable TTL
 * - Metrics tracking for monitoring
 */

import { recordApiCall } from "./healthMonitor.js";

// ─── CONFIG ──────────────────────────────────────────────────

const MAX_REQUESTS_PER_MINUTE = 25;
const BURST_ALLOWANCE = 8;
const REFILL_INTERVAL_MS = (60 * 1000) / MAX_REQUESTS_PER_MINUTE; // ~2.4s per token
const MAX_RETRIES_ON_429 = 3;
const BASE_BACKOFF_MS = 2000;

// ─── TOKEN BUCKET ────────────────────────────────────────────

let tokens = BURST_ALLOWANCE;
let lastRefillTime = Date.now();

function refillTokens(): void {
  const now = Date.now();
  const elapsed = now - lastRefillTime;
  const newTokens = Math.floor(elapsed / REFILL_INTERVAL_MS);
  if (newTokens > 0) {
    tokens = Math.min(tokens + newTokens, BURST_ALLOWANCE);
    lastRefillTime = now;
  }
}

// ─── REQUEST QUEUE ───────────────────────────────────────────

type Priority = "high" | "normal" | "low";

interface QueuedRequest {
  url: string;
  timeoutMs: number;
  priority: Priority;
  resolve: (value: Response) => void;
  reject: (reason: any) => void;
  enqueuedAt: number;
}

const queue: QueuedRequest[] = [];
let processing = false;

function enqueue(
  url: string,
  timeoutMs: number,
  priority: Priority
): Promise<Response> {
  return new Promise((resolve, reject) => {
    queue.push({ url, timeoutMs, priority, resolve, reject, enqueuedAt: Date.now() });
    const priorityOrder: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
    queue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    processQueue();
  });
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    refillTokens();

    if (tokens <= 0) {
      const waitMs = REFILL_INTERVAL_MS - (Date.now() - lastRefillTime);
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 100)));
      refillTokens();
      if (tokens <= 0) continue;
    }

    const req = queue.shift()!;
    tokens--;
    metrics.totalRequests++;

    executeWithRetry(req.url, req.timeoutMs)
      .then(req.resolve)
      .catch(req.reject);
  }

  processing = false;
}

async function executeWithRetry(
  url: string,
  timeoutMs: number,
  attempt = 0
): Promise<Response> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    recordApiCall(Date.now() - start, res.ok);

    if (res.status === 429 && attempt < MAX_RETRIES_ON_429) {
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
      metrics.rateLimitHits++;
      console.warn(
        `[DexRateLimiter] 429 rate-limited on ${url.substring(0, 80)}... Retry ${attempt + 1}/${MAX_RETRIES_ON_429} in ${backoff}ms`
      );
      await new Promise((r) => setTimeout(r, backoff));
      return executeWithRetry(url, timeoutMs, attempt + 1);
    }

    if (!res.ok) {
      metrics.failedRequests++;
    }

    return res;
  } catch (err) {
    clearTimeout(timeout);
    recordApiCall(Date.now() - start, false);
    metrics.failedRequests++;
    throw err;
  }
}

// ─── METRICS ─────────────────────────────────────────────────

const metrics = {
  totalRequests: 0,
  failedRequests: 0,
  rateLimitHits: 0,
  queueHighWaterMark: 0,
  lastResetTime: Date.now(),
};

export function getDexRateLimiterMetrics() {
  return {
    ...metrics,
    currentQueueSize: queue.length,
    availableTokens: tokens,
    uptimeMs: Date.now() - metrics.lastResetTime,
  };
}

export function resetDexRateLimiterMetrics() {
  metrics.totalRequests = 0;
  metrics.failedRequests = 0;
  metrics.rateLimitHits = 0;
  metrics.queueHighWaterMark = 0;
  metrics.lastResetTime = Date.now();
}

// ─── PUBLIC API ──────────────────────────────────────────────

/**
 * Rate-limited fetch for DexScreener API calls.
 * @param url - DexScreener API URL
 * @param timeoutMs - Fetch timeout in ms (default 10s)
 * @param priority - "high" for position monitoring, "normal" for scanning, "low" for outcome tracking
 */
export async function dexFetch(
  url: string,
  timeoutMs = 10_000,
  priority: Priority = "normal"
): Promise<Response> {
  if (queue.length > metrics.queueHighWaterMark) {
    metrics.queueHighWaterMark = queue.length;
  }
  return enqueue(url, timeoutMs, priority);
}

// ─── RESPONSE CACHE ──────────────────────────────────────────

interface CachedResponse {
  data: any;
  timestamp: number;
}

const responseCache = new Map<string, CachedResponse>();

/**
 * Rate-limited fetch with response caching.
 * Returns cached JSON data if available and not expired.
 */
export async function dexFetchCached(
  url: string,
  cacheTtlMs = 30_000,
  priority: Priority = "normal"
): Promise<any> {
  const cached = responseCache.get(url);
  if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
    return cached.data;
  }

  const response = await dexFetch(url, 10_000, priority);
  if (!response.ok) {
    if (cached) {
      console.warn(`[DexRateLimiter] API error ${response.status}, returning stale cache for ${url.substring(0, 80)}`);
      return cached.data;
    }
    return null;
  }

  const data = await response.json();
  responseCache.set(url, { data, timestamp: Date.now() });

  // Prune old cache entries every 100 requests
  if (metrics.totalRequests % 100 === 0) {
    const now = Date.now();
    for (const [key, val] of responseCache.entries()) {
      if (now - val.timestamp > 5 * 60 * 1000) {
        responseCache.delete(key);
      }
    }
  }

  return data;
}

/**
 * Batch-fetch pair data for multiple token addresses on a chain.
 * Returns a Map of tokenAddress -> pair data for quick lookup.
 */
export async function dexBatchFetchPairs(
  chainId: string,
  addresses: string[],
  priority: Priority = "normal"
): Promise<Map<string, any>> {
  const DEX_API = "https://api.dexscreener.com";
  const result = new Map<string, any>();

  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30).join(",");
    try {
      const data = await dexFetchCached(
        `${DEX_API}/tokens/v1/${chainId}/${batch}`,
        30_000,
        priority
      );
      if (Array.isArray(data)) {
        for (const pair of data) {
          const addr = pair.baseToken?.address;
          if (addr) {
            const existing = result.get(addr);
            const existingLiq = existing?.liquidity?.usd ?? 0;
            const newLiq = pair.liquidity?.usd ?? 0;
            if (!existing || newLiq > existingLiq) {
              result.set(addr, pair);
            }
          }
        }
      }
    } catch {
      // Continue with other batches
    }
  }

  return result;
}
