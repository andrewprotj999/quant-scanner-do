const BASE = "https://api.dexscreener.com";

export interface PairData {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative?: string;
  priceUsd?: string;
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: { label: string; url: string }[];
    socials?: { platform?: string; type?: string; url: string }[];
  };
}

export interface BoostedToken {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  openGraph?: string;
  description?: string;
  links?: { label: string; type: string; url: string }[];
  totalAmount: number;
  amount: number;
}

export async function searchPairs(query: string): Promise<PairData[]> {
  const res = await fetch(`${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`DexScreener search failed: ${res.status}`);
  const data = await res.json();
  return data.pairs ?? [];
}

export async function getTopBoostedTokens(): Promise<BoostedToken[]> {
  const res = await fetch(`${BASE}/token-boosts/top/v1`);
  if (!res.ok) throw new Error(`DexScreener boosted failed: ${res.status}`);
  return res.json();
}

export async function getTokenPairs(chainId: string, tokenAddress: string): Promise<PairData[]> {
  const res = await fetch(`${BASE}/latest/dex/tokens/${tokenAddress}`);
  if (!res.ok) throw new Error(`DexScreener token failed: ${res.status}`);
  const data = await res.json();
  return (data.pairs ?? []).filter((p: PairData) => p.chainId === chainId);
}
