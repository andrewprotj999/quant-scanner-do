import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Settings, Brain } from "lucide-react";

export default function EngineSettings() {
  const [params, setParams] = useState<any>(null);
  const [patterns, setPatterns] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getParams(), api.getPatterns()])
      .then(([p, pat]) => { setParams(p); setPatterns(pat); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const p = params?.params || {};

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Settings size={24} className="text-accent" />
        Engine Settings
      </h1>

      {loading ? (
        <div className="text-text-muted animate-pulse">Loading...</div>
      ) : (
        <>
          {/* Current Parameters */}
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <h2 className="text-lg font-semibold mb-4">Dynamic Parameters</h2>
            <p className="text-sm text-text-muted mb-4">
              These values are auto-tuned by the backtest system every 6 hours.
              Edit .env or the engine_params DB table to override.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <ParamCard label="Min Conviction" value={p.minConviction ?? 70} unit="/100" />
              <ParamCard label="Stop Loss" value={p.stopLossPercent ?? 10} unit="%" />
              <ParamCard label="TP1 Target" value={p.tp1Percent ?? 25} unit="%" />
              <ParamCard label="Break-Even Threshold" value={p.breakEvenThreshold ?? 15} unit="%" />
              <ParamCard label="Trail Pre-TP1" value={p.trailPreTp1 ?? 12} unit="%" />
              <ParamCard label="Trail Post-TP1" value={p.trailPostTp1 ?? 8} unit="%" />
              <ParamCard label="Trail Big Win" value={p.trailBigWin ?? 6} unit="%" />
              <ParamCard label="Circuit Breaker" value={p.circuitBreakerPct ?? 50} unit="%" />
              <ParamCard label="Min Risk" value={p.minRiskPercent ?? 1.0} unit="%" />
              <ParamCard label="Max Risk" value={p.maxRiskPercent ?? 2.5} unit="%" />
              <ParamCard label="Max Pos (Low)" value={p.maxPosPctLow ?? 3} unit="%" />
              <ParamCard label="Max Pos (High)" value={p.maxPosPctHigh ?? 7} unit="%" />
              <ParamCard label="Rug Liq/FDV Max" value={p.rugLiqFdvMax ?? 5} unit="x" />
              <ParamCard label="Vol Dry-Up" value={p.volDryUpThreshold ?? 0.02} unit="x" />
            </div>
          </div>

          {/* Learning Patterns */}
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Brain size={18} className="text-accent" />
              Learning Patterns ({patterns?.count || 0})
            </h2>
            {patterns?.patterns?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wide">
                      <th className="text-left p-3">Type</th>
                      <th className="text-left p-3">Value</th>
                      <th className="text-right p-3">Trades</th>
                      <th className="text-right p-3">Win Rate</th>
                      <th className="text-right p-3">Avg P&L</th>
                      <th className="text-right p-3">Weight Adj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patterns.patterns.map((pat: any) => {
                      const total = (pat.wins || 0) + (pat.losses || 0);
                      const winRate = total > 0 ? ((pat.wins || 0) / total * 100).toFixed(0) : "—";
                      return (
                        <tr key={`${pat.patternType}-${pat.patternValue}`} className="border-b border-border/30 hover:bg-bg-hover">
                          <td className="p-3 font-mono text-xs text-accent">{pat.patternType}</td>
                          <td className="p-3 font-mono text-xs">{pat.patternValue}</td>
                          <td className="p-3 text-right">{total}</td>
                          <td className="p-3 text-right">{winRate}%</td>
                          <td className={`p-3 text-right font-mono ${parseFloat(pat.avgPnlPercent || "0") >= 0 ? "text-accent" : "text-danger"}`}>
                            {parseFloat(pat.avgPnlPercent || "0").toFixed(1)}%
                          </td>
                          <td className="p-3 text-right font-mono text-xs">
                            {parseFloat(pat.weightAdjustment || "0").toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-text-muted text-sm">No patterns learned yet. Patterns build as trades close.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ParamCard({ label, value, unit }: { label: string; value: number | string; unit: string }) {
  return (
    <div className="bg-bg/50 border border-border/50 rounded-lg p-3">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-lg font-bold font-mono mt-1">
        {value}<span className="text-sm text-text-muted ml-1">{unit}</span>
      </p>
    </div>
  );
}
