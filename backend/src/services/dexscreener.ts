/**
 * DexScreener API Service
 *
 * Handles all data fetching from DexScreener with:
 * - Rate limiting (respect 300 req/min)
 * - Retry logic with exponential backoff
 * - Timeout handling
 * - Response caching
 * - Unified data normalization
 */

const BASE_URL = "https://api.dexscreener.com";
const CACHE_TTL_MS = 15_000; // 15 seconds
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds
const MAX_RETRIES = 2;

// ─── IN-MEMORY CACHE ──────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
  // Prune old entries periodically
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.timestamp > CACHE_TTL_MS * 2) cache.delete(k);
    }
  }
}

// ─── FETCH WITH RETRY ─────────────────────────────────────

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        // Rate limited — wait and retry
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.warn(`[DexScreener] Rate limited, waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    } catch (err: any) {
      if (attempt === retries) {
        console.error(`[DexScreener] Failed after ${retries + 1} attempts: ${url}`, err.message);
        return null;
      }
      const wait = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return null;
}

// ─── NORMALIZED PAIR TYPE ─────────────────────────────────

export interface NormalizedPair {
  pairAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  chain: string;
  dexId: string;
  priceUsd: number;
  priceChange5m: number;
  priceChangeH1: number;
  priceChangeH6: number;
  priceChangeH24: number;
  volume5m: number;
  volumeH1: number;
  volumeH6: number;
  volumeH24: number;
  liquidity: number;
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  txns5m: { buys: number; sells: number };
  txnsH1: { buys: number; sells: number };
  txnsH24: { buys: number; sells: number };
  url: string;
}

function normalizePair(pair: any): NormalizedPair | null {
  try {
    if (!pair || !pair.baseToken || !pair.priceUsd) return null;

    return {
      pairAddress: pair.pairAddress ?? "",
      tokenAddress: pair.baseToken.address ?? "",
      tokenSymbol: pair.baseToken.symbol ?? "???",
      tokenName: pair.baseToken.name ?? "",
      chain: pair.chainId ?? "unknown",
      dexId: pair.dexId ?? "",
      priceUsd: parseFloat(pair.priceUsd) || 0,
      priceChange5m: pair.priceChange?.m5 ?? 0,
      priceChangeH1: pair.priceChange?.h1 ?? 0,
      priceChangeH6: pair.priceChange?.h6 ?? 0,
      priceChangeH24: pair.priceChange?.h24 ?? 0,
      volume5m: pair.volume?.m5 ?? 0,
      volumeH1: pair.volume?.h1 ?? 0,
      volumeH6: pair.volume?.h6 ?? 0,
      volumeH24: pair.volume?.h24 ?? 0,
      liquidity: pair.liquidity?.usd ?? 0,
      fdv: pair.fdv ?? 0,
      marketCap: pair.marketCap ?? pair.fdv ?? 0,
      pairCreatedAt: pair.pairCreatedAt ?? 0,
      txns5m: pair.txns?.m5 ?? { buys: 0, sells: 0 },
      txnsH1: pair.txns?.h1 ?? { buys: 0, sells: 0 },
      txnsH24: pair.txns?.h24 ?? { buys: 0, sells: 0 },
      url: pair.url ?? `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`,
    };
  } catch {
    return null;
  }
}

// ─── PUBLIC API ───────────────────────────────────────────

/**
 * Fetch boosted tokens (promoted/trending on DexScreener)
 */
export async function fetchBoostedTokens(): Promise<Array<{ tokenAddress: string; chainId: string; amount: number }>> {
  const cacheKey = "boosted";
  const cached = getCached<any[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchWithRetry(`${BASE_URL}/token-boosts/top/v1`);
  if (!data || !Array.isArray(data)) return [];

  const tokens = data.map((t: any) => ({
    tokenAddress: t.tokenAddress,
    chainId: t.chainId,
    amount: t.amount ?? 0,
  }));

  setCache(cacheKey, tokens);
  return tokens;
}

/**
 * Fetch trending token profiles
 */
export async function fetchTrendingProfiles(): Promise<Array<{ tokenAddress: string; chainId: string }>> {
  const cacheKey = "trending";
  const cached = getCached<any[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchWithRetry(`${BASE_URL}/token-profiles/latest/v1`);
  if (!data || !Array.isArray(data)) return [];

  const tokens = data.map((t: any) => ({
    tokenAddress: t.tokenAddress,
    chainId: t.chainId,
  }));

  setCache(cacheKey, tokens);
  return tokens;
}

/**
 * Fetch pair data for a batch of token addresses on a specific chain
 */
export async function fetchPairsByTokens(chain: string, addresses: string[]): Promise<NormalizedPair[]> {
  if (addresses.length === 0) return [];

  // DexScreener allows up to 30 addresses per request
  const batches: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    batches.push(addresses.slice(i, i + 30));
  }

  const results: NormalizedPair[] = [];

  for (const batch of batches) {
    const joined = batch.join(",");
    const cacheKey = `pairs:${chain}:${joined}`;
    const cached = getCached<NormalizedPair[]>(cacheKey);

    if (cached) {
      results.push(...cached);
      continue;
    }

    const data = await fetchWithRetry(`${BASE_URL}/tokens/v1/${chain}/${joined}`);
    if (!data || !Array.isArray(data)) continue;

    const normalized = data.map(normalizePair).filter(Boolean) as NormalizedPair[];
    setCache(cacheKey, normalized);
    results.push(...normalized);
  }

  return results;
}

/**
 * Fetch a single pair's current data
 */
export async function fetchPairPrice(chain: string, pairAddress: string): Promise<NormalizedPair | null> {
  const cacheKey = `pair:${chain}:${pairAddress}`;
  const cached = getCached<NormalizedPair>(cacheKey);
  if (cached) return cached;

  const data = await fetchWithRetry(`${BASE_URL}/latest/dex/pairs/${chain}/${pairAddress}`);
  if (!data?.pairs?.[0]) return null;

  const normalized = normalizePair(data.pairs[0]);
  if (normalized) setCache(cacheKey, normalized);
  return normalized;
}

/**
 * Fetch all trending tokens across all chains, deduplicated
 * Returns a map of chainId → tokenAddresses[]
 */
export async function fetchAllTrendingTokens(): Promise<Map<string, string[]>> {
  const [boosted, profiles] = await Promise.all([
    fetchBoostedTokens(),
    fetchTrendingProfiles(),
  ]);

  const chainMap = new Map<string, Set<string>>();

  for (const token of [...boosted, ...profiles]) {
    if (!token.tokenAddress || !token.chainId) continue;
    if (!chainMap.has(token.chainId)) {
      chainMap.set(token.chainId, new Set());
    }
    chainMap.get(token.chainId)!.add(token.tokenAddress);
  }

  // Convert Sets to arrays
  const result = new Map<string, string[]>();
  for (const [chain, addrs] of chainMap) {
    result.set(chain, Array.from(addrs));
  }

  return result;
}

/**
 * Clear the entire cache (useful for testing)
 */
export function clearCache(): void {
  cache.clear();
}
