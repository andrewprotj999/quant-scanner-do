import { useCallback } from "react";
import { FlaskConical, Settings, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";

export default function Backtest() {
  const paramsFetcher = useCallback(() => api.getParams(), []);
  const { data: paramsData } = usePolling(paramsFetcher, 30000);

  const params = paramsData?.params ?? paramsData ?? {};

  const paramList = [
    { key: "min_conviction", label: "Min Conviction", value: params.min_conviction ?? params.minConviction ?? 70, unit: "/100" },
    { key: "stop_loss_pct", label: "Stop Loss", value: params.stop_loss_pct ?? params.stopLossPct ?? 10, unit: "%" },
    { key: "tp1_target_pct", label: "TP1 Target", value: params.tp1_target_pct ?? params.tp1TargetPct ?? 25, unit: "%" },
    { key: "trail_post_tp1", label: "Trail Post-TP1", value: params.trail_post_tp1 ?? params.trailPostTp1 ?? 8, unit: "%" },
    { key: "break_even_threshold", label: "Break-Even Threshold", value: params.break_even_threshold ?? params.breakEvenThreshold ?? 15, unit: "%" },
    { key: "trail_pre_tp1", label: "Trail Pre-TP1", value: params.trail_pre_tp1 ?? params.trailPreTp1 ?? 12, unit: "%" },
    { key: "trail_big_win", label: "Trail Big Win", value: params.trail_big_win ?? params.trailBigWin ?? 6, unit: "%" },
    { key: "circuit_breaker", label: "Circuit Breaker", value: params.circuit_breaker ?? params.circuitBreaker ?? 50, unit: "%" },
    { key: "min_risk", label: "Min Risk", value: params.min_risk ?? params.minRisk ?? 1, unit: "%" },
    { key: "max_risk", label: "Max Risk", value: params.max_risk ?? params.maxRisk ?? 2.5, unit: "%" },
    { key: "max_pos_low", label: "Max Pos (Low)", value: params.max_pos_low ?? params.maxPosLow ?? 3, unit: "%" },
    { key: "max_pos_high", label: "Max Pos (High)", value: params.max_pos_high ?? params.maxPosHigh ?? 7, unit: "%" },
    { key: "rug_liq_fdv_max", label: "Rug Liq/FDV Max", value: params.rug_liq_fdv_max ?? params.rugLiqFdvMax ?? 5, unit: "x" },
    { key: "vol_dry_up", label: "Vol Dry-Up", value: params.vol_dry_up ?? params.volDryUp ?? 0.02, unit: "x" },
  ];

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white font-mono flex items-center gap-3">
          <FlaskConical className="w-6 h-6 text-primary" />
          Backtest & Parameters
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Dynamic parameters auto-tuned by the backtest system every 6 hours
        </p>
      </div>

      {/* Auto-Tuning Status */}
      <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-2">
          <RefreshCw className="w-5 h-5 text-violet-400" />
          <span className="text-sm font-mono font-bold text-violet-400">
            AUTO-TUNING ACTIVE
          </span>
        </div>
        <p className="text-xs text-zinc-400">
          The backtest system runs every 6 hours, analyzing recent trade performance to optimize
          these parameters. Values are stored in the engine_params database table and can be
          manually overridden via .env or direct DB edits.
        </p>
      </div>

      {/* Parameters Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {paramList.map((param) => (
          <div
            key={param.key}
            className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4"
          >
            <div className="text-[10px] text-zinc-500 font-mono mb-2">
              {param.label.toUpperCase()}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-mono font-bold text-white">
                {typeof param.value === "number" ? param.value : param.value}
              </span>
              <span className="text-sm font-mono text-zinc-500">{param.unit}</span>
            </div>
            <div className="text-[10px] text-zinc-600 font-mono mt-1">
              {param.key}
            </div>
          </div>
        ))}
      </div>

      {/* How It Works */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-mono font-bold text-zinc-300 mb-4">
          HOW THE BACKTEST SYSTEM WORKS
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs text-zinc-400">
          <div>
            <div className="text-emerald-400 font-mono font-bold mb-2">1. DATA COLLECTION</div>
            <p>Every closed trade is logged with full metadata: entry/exit prices, conviction score, chain, DEX, hold time, exit reason, and P&L.</p>
          </div>
          <div>
            <div className="text-sky-400 font-mono font-bold mb-2">2. PATTERN ANALYSIS</div>
            <p>The system groups trades by 7 categories (chain, DEX, conviction range, exit type, hold time, liquidity, time of day) and calculates win rates and avg P&L per pattern.</p>
          </div>
          <div>
            <div className="text-violet-400 font-mono font-bold mb-2">3. PARAMETER OPTIMIZATION</div>
            <p>Every 6 hours, the system re-evaluates all 14 parameters against recent performance and adjusts them to maximize risk-adjusted returns.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
