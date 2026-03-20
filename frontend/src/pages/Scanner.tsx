/**
 * Scanner — Token Search & Analysis
 * Uses DexScreener API for real-time token data
 */

import { useState, useEffect } from "react";
import {
  Search,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Droplets,
  Clock,
  Zap,
  RefreshCw,
} from "lucide-react";
import {
  searchPairs,
  getTopBoostedTokens,
  type PairData,
  type BoostedToken,
} from "@/lib/dexscreener";

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatAge(timestamp: number | null): string {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  const hours = diff / 3600000;
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export default function Scanner() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PairData[]>([]);
  const [boosted, setBoosted] = useState<BoostedToken[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingBoosted, setLoadingBoosted] = useState(true);
  const [selectedPair, setSelectedPair] = useState<PairData | null>(null);

  // Load boosted tokens on mount
  useEffect(() => {
    getTopBoostedTokens()
      .then((data) => setBoosted(data.slice(0, 20)))
      .catch(console.error)
      .finally(() => setLoadingBoosted(false));
  }, []);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const pairs = await searchPairs(query);
      setResults(pairs.slice(0, 30));
      setSelectedPair(null);
    } catch (err) {
      console.error("Search failed:", err);
    }
    setSearching(false);
  }

  function refreshBoosted() {
    setLoadingBoosted(true);
    getTopBoostedTokens()
      .then((data) => setBoosted(data.slice(0, 20)))
      .catch(console.error)
      .finally(() => setLoadingBoosted(false));
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white font-mono flex items-center gap-3">
          <Search className="w-6 h-6 text-primary" />
          Token Scanner
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Search tokens across all chains via DexScreener
        </p>
      </div>

      {/* Search Bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search token name, symbol, or address..."
          className="flex-1 bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder:text-zinc-600 focus:outline-none focus:border-primary/50"
        />
        <button
          onClick={handleSearch}
          disabled={searching}
          className="px-6 py-3 rounded-lg bg-primary hover:bg-primary/80 text-white font-mono text-sm font-bold disabled:opacity-50 transition-colors"
        >
          {searching ? "..." : "SCAN"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Results / Boosted List */}
        <div className="lg:col-span-2 space-y-4">
          {results.length > 0 ? (
            <>
              <h2 className="text-sm font-mono font-bold text-zinc-400">
                SEARCH RESULTS ({results.length})
              </h2>
              <div className="space-y-2">
                {results.map((pair, i) => (
                  <PairRow
                    key={`${pair.pairAddress}-${i}`}
                    pair={pair}
                    onClick={() => setSelectedPair(pair)}
                    isSelected={selectedPair?.pairAddress === pair.pairAddress}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-mono font-bold text-zinc-400">
                  BOOSTED TOKENS
                </h2>
                <button
                  onClick={refreshBoosted}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingBoosted ? "animate-spin" : ""}`} />
                </button>
              </div>
              {loadingBoosted ? (
                <div className="text-center py-8">
                  <div className="text-zinc-600 text-2xl mb-2 animate-pulse">&#128225;</div>
                  <div className="text-zinc-500 text-xs font-mono">Loading boosted tokens...</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {boosted.map((token, i) => (
                    <div
                      key={`${token.tokenAddress}-${i}`}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 flex items-center justify-between hover:border-zinc-700 transition-colors cursor-pointer"
                      onClick={() => {
                        setQuery(token.tokenAddress);
                        searchPairs(token.tokenAddress).then((pairs) => {
                          setResults(pairs.slice(0, 30));
                          if (pairs[0]) setSelectedPair(pairs[0]);
                        });
                      }}
                    >
                      <div className="flex items-center gap-3">
                        {token.icon && (
                          <img
                            src={token.icon}
                            alt=""
                            className="w-8 h-8 rounded-full"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        )}
                        <div>
                          <div className="text-white font-mono font-bold text-sm">
                            {token.description || token.tokenAddress.slice(0, 8) + "..."}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {token.chainId} · {token.totalAmount} boosts
                          </div>
                        </div>
                      </div>
                      <a
                        href={token.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-500 hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail Panel */}
        <div>
          {selectedPair ? (
            <PairDetail pair={selectedPair} />
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
              <div className="text-zinc-600 text-4xl mb-3">&#128269;</div>
              <div className="text-zinc-500 font-mono text-sm">
                Select a token to view details
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PairRow({
  pair,
  onClick,
  isSelected,
}: {
  pair: PairData;
  onClick: () => void;
  isSelected: boolean;
}) {
  const change24h = pair.priceChange?.h24 ?? 0;
  const isUp = change24h >= 0;

  return (
    <div
      onClick={onClick}
      className={`bg-zinc-900/50 border rounded-lg p-3 flex items-center justify-between cursor-pointer transition-colors ${
        isSelected
          ? "border-primary/50 bg-primary/5"
          : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-white">
              {pair.baseToken.symbol}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {pair.chainId}
            </span>
            {pair.labels?.includes("boost") && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
                BOOST
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500">
            {pair.dexId} · {pair.baseToken.name}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs font-mono">
        <div className="text-right">
          <div className="text-zinc-300">{pair.priceUsd ? `$${parseFloat(pair.priceUsd).toPrecision(4)}` : "—"}</div>
          <div className={isUp ? "text-emerald-400" : "text-rose-400"}>
            {isUp ? "+" : ""}{change24h.toFixed(2)}%
          </div>
        </div>
        <div className="text-right text-zinc-500">
          <div>VOL {formatNumber(pair.volume?.h24)}</div>
          <div>LIQ {formatNumber(pair.liquidity?.usd)}</div>
        </div>
      </div>
    </div>
  );
}

function PairDetail({ pair }: { pair: PairData }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-mono font-bold text-white">
              {pair.baseToken.symbol}
            </h3>
            <div className="text-xs text-zinc-500">
              {pair.baseToken.name} · {pair.chainId} · {pair.dexId}
            </div>
          </div>
          <a
            href={pair.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary text-xs font-mono hover:bg-primary/20 transition-colors"
          >
            DexScreener ↗
          </a>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Price */}
        <div>
          <div className="text-xs text-zinc-500 font-mono mb-1">PRICE</div>
          <div className="text-2xl font-mono font-bold text-white">
            {pair.priceUsd ? `$${parseFloat(pair.priceUsd).toPrecision(6)}` : "—"}
          </div>
        </div>

        {/* Price Changes */}
        <div className="grid grid-cols-4 gap-2">
          {(["m5", "h1", "h6", "h24"] as const).map((period) => {
            const change = pair.priceChange?.[period] ?? 0;
            const isUp = change >= 0;
            return (
              <div key={period} className="text-center">
                <div className="text-[10px] text-zinc-500 font-mono">{period.toUpperCase()}</div>
                <div className={`text-sm font-mono font-bold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {isUp ? "+" : ""}{change.toFixed(2)}%
                </div>
              </div>
            );
          })}
        </div>

        {/* Key Metrics */}
        <div className="space-y-2">
          <DetailRow icon={<Droplets className="w-3.5 h-3.5" />} label="Liquidity" value={formatNumber(pair.liquidity?.usd)} />
          <DetailRow icon={<BarChart3 className="w-3.5 h-3.5" />} label="24h Volume" value={formatNumber(pair.volume?.h24)} />
          <DetailRow icon={<TrendingUp className="w-3.5 h-3.5" />} label="FDV" value={formatNumber(pair.fdv)} />
          <DetailRow icon={<TrendingUp className="w-3.5 h-3.5" />} label="Market Cap" value={formatNumber(pair.marketCap)} />
          <DetailRow icon={<Clock className="w-3.5 h-3.5" />} label="Age" value={formatAge(pair.pairCreatedAt)} />
        </div>

        {/* Transactions */}
        <div>
          <div className="text-xs text-zinc-500 font-mono mb-2">TRANSACTIONS (24H)</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-2 text-center">
              <div className="text-emerald-400 font-mono font-bold">{pair.txns?.h24?.buys ?? 0}</div>
              <div className="text-[10px] text-emerald-400/70">BUYS</div>
            </div>
            <div className="bg-rose-500/10 border border-rose-500/20 rounded p-2 text-center">
              <div className="text-rose-400 font-mono font-bold">{pair.txns?.h24?.sells ?? 0}</div>
              <div className="text-[10px] text-rose-400/70">SELLS</div>
            </div>
          </div>
        </div>

        {/* Links */}
        {pair.info?.socials && pair.info.socials.length > 0 && (
          <div>
            <div className="text-xs text-zinc-500 font-mono mb-2">LINKS</div>
            <div className="flex flex-wrap gap-2">
              {pair.info.socials.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                >
                  {s.platform || s.type || "link"}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-zinc-300 font-mono">{value}</span>
    </div>
  );
}

function BarChart3Icon(props: any) {
  return <BarChart3 {...props} />;
}
