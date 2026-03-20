/**
 * Rules — Trading Rules Reference
 * Static reference of all trading rules and risk management
 */

import { Shield, AlertTriangle, Target, TrendingUp, Clock, Zap, BarChart3 } from "lucide-react";

const ruleCategories = [
  {
    title: "ENTRY RULES",
    icon: <Target className="w-5 h-5 text-emerald-400" />,
    color: "border-emerald-500/30",
    rules: [
      { rule: "Minimum conviction score of 70/100", detail: "Token must pass multi-factor analysis" },
      { rule: "Minimum liquidity $100K", detail: "Ensures sufficient depth for entry/exit" },
      { rule: "No chasing — entry on pullback only", detail: "Wait for retracement from recent highs" },
      { rule: "Maximum 10 concurrent positions", detail: "Diversification limit to manage risk" },
      { rule: "FDV/Liquidity ratio < 5x", detail: "Avoid tokens with inflated valuations" },
      { rule: "Volume dry-up threshold 0.02x", detail: "Skip tokens with declining volume" },
    ],
  },
  {
    title: "EXIT RULES",
    icon: <TrendingUp className="w-5 h-5 text-sky-400" />,
    color: "border-sky-500/30",
    rules: [
      { rule: "Stop loss at 10% below entry", detail: "Hard stop to limit downside" },
      { rule: "TP1 at +25% — take 50% off", detail: "Lock in partial profits early" },
      { rule: "Break-even stop after +15%", detail: "Move stop to entry after significant gain" },
      { rule: "Trailing stop pre-TP1: 12%", detail: "Dynamic stop before first target" },
      { rule: "Trailing stop post-TP1: 8%", detail: "Tighter trail after partial profit" },
      { rule: "Big winner trail: 6%", detail: "Let winners run with tight trail" },
    ],
  },
  {
    title: "RISK MANAGEMENT",
    icon: <Shield className="w-5 h-5 text-amber-400" />,
    color: "border-amber-500/30",
    rules: [
      { rule: "Max risk per trade: 1-2.5%", detail: "Dynamic based on conviction score" },
      { rule: "Min risk per trade: 1%", detail: "Floor for position sizing" },
      { rule: "Daily drawdown halt at -5%", detail: "Stop trading for the day" },
      { rule: "2 consecutive losses → pause", detail: "Cool-down period after losing streak" },
      { rule: "Circuit breaker at -50%", detail: "Emergency stop if equity drops 50%" },
      { rule: "Max position size (low conviction): 3%", detail: "Smaller size for lower scores" },
      { rule: "Max position size (high conviction): 7%", detail: "Larger size for high-score setups" },
    ],
  },
  {
    title: "SELF-LEARNING",
    icon: <Zap className="w-5 h-5 text-violet-400" />,
    color: "border-violet-500/30",
    rules: [
      { rule: "Pattern tracking across 7 categories", detail: "Chain, DEX, conviction, exit type, hold time, liquidity, time of day" },
      { rule: "Auto-adjust after 3+ trades per pattern", detail: "Score adjustments based on win rate and avg P&L" },
      { rule: "Backtest system every 6 hours", detail: "Re-optimize parameters based on recent performance" },
      { rule: "Dynamic parameter tuning", detail: "14 parameters auto-tuned by backtest results" },
      { rule: "Learning log for transparency", detail: "Every adjustment is logged with reasoning" },
    ],
  },
];

export default function Rules() {
  return (
    <div className="space-y-6 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white font-mono flex items-center gap-3">
          <Shield className="w-6 h-6 text-primary" />
          Trading Rules
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Complete rule set governing the autonomous trading engine
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {ruleCategories.map((category) => (
          <div
            key={category.title}
            className={`bg-zinc-900/50 border border-zinc-800 border-l-4 ${category.color} rounded-lg overflow-hidden`}
          >
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
              {category.icon}
              <h2 className="text-sm font-mono font-bold text-zinc-300">
                {category.title}
              </h2>
            </div>
            <div className="p-4 space-y-3">
              {category.rules.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 mt-2 flex-shrink-0" />
                  <div>
                    <div className="text-sm text-zinc-300 font-mono">
                      {item.rule}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {item.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
