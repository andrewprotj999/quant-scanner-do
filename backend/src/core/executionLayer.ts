/**
 * Execution Abstraction Layer — v4
 *
 * Abstracts all trade execution behind a unified interface.
 * Currently implements paper trading; designed for seamless swap to live.
 *
 * When transitioning to live trading, ONLY this file needs to change.
 * Everything else (risk management, position sizing, profit-taking) stays identical.
 *
 * Architecture:
 * - ExecutionMode: "paper" | "live" | "shadow" (paper + live simultaneously)
 * - All execution goes through executeOrder() and executePartialExit()
 * - Pre-execution validation: size limits, slippage checks, balance verification
 * - Post-execution logging: fills, slippage, fees, latency
 *
 * Live trading integration points (future):
 * - Solana: Jupiter Aggregator API
 * - EVM: 1inch / Paraswap
 * - Centralized: CCXT library
 */

import { estimateSlippage, adjustPositionForSlippage } from "./slippageEstimator.js";

// ─── TYPES ──────────────────────────────────────────────────

export type ExecutionMode = "paper" | "live" | "shadow";

export interface OrderRequest {
  /** Token to trade */
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  pairAddress: string;
  /** Order details */
  side: "buy" | "sell";
  sizeUsd: number;
  price: number;
  /** Slippage tolerance (percentage) */
  maxSlippagePct: number;
  /** Conviction score for logging */
  convictionScore?: number;
  /** Reason for the trade */
  reason?: string;
}

export interface OrderResult {
  /** Whether the order was executed */
  success: boolean;
  /** Execution mode used */
  mode: ExecutionMode;
  /** Fill price (may differ from requested due to slippage) */
  fillPrice: number;
  /** Actual size filled */
  filledSizeUsd: number;
  /** Token amount received/sold */
  tokenAmount: number;
  /** Actual slippage experienced */
  slippagePct: number;
  /** Fees paid (USD) */
  feesUsd: number;
  /** Execution latency (ms) */
  latencyMs: number;
  /** Transaction hash (live mode only) */
  txHash?: string;
  /** Error message if failed */
  error?: string;
}

export interface PartialExitRequest {
  /** Position details */
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  pairAddress: string;
  /** Exit details */
  exitPercent: number;     // Percentage of remaining position to exit
  currentPrice: number;
  positionSizeUsd: number; // Current remaining position size
  /** Reason */
  reason: string;
}

export interface PartialExitResult {
  success: boolean;
  mode: ExecutionMode;
  fillPrice: number;
  soldSizeUsd: number;
  pnlUsd: number;
  slippagePct: number;
  feesUsd: number;
  latencyMs: number;
  txHash?: string;
  error?: string;
}

// ─── CONFIGURATION ──────────────────────────────────────────

let currentMode: ExecutionMode = "paper";

// Pre-execution validation limits
const LIMITS = {
  minOrderSizeUsd: 1,          // Minimum $1 order
  maxOrderSizeUsd: 10_000,     // Maximum $10k per order (paper)
  maxSlippagePct: 5,           // Maximum 5% slippage allowed
  paperFeeRate: 0.003,         // 0.3% simulated fee (realistic DEX fee)
  paperSlippageBase: 0.001,    // 0.1% base simulated slippage
};

// ─── MODE MANAGEMENT ────────────────────────────────────────

export function setExecutionMode(mode: ExecutionMode): void {
  console.log(`[Execution] Mode changed: ${currentMode} → ${mode}`);
  currentMode = mode;
}

export function getExecutionMode(): ExecutionMode {
  return currentMode;
}

// ─── PRE-EXECUTION VALIDATION ───────────────────────────────

/**
 * Validate an order before execution.
 * Returns issues that would prevent execution.
 */
export function validateOrder(order: OrderRequest): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (order.sizeUsd < LIMITS.minOrderSizeUsd) {
    issues.push(`Order size $${order.sizeUsd.toFixed(2)} below minimum $${LIMITS.minOrderSizeUsd}`);
  }

  if (order.sizeUsd > LIMITS.maxOrderSizeUsd) {
    issues.push(`Order size $${order.sizeUsd.toFixed(2)} exceeds maximum $${LIMITS.maxOrderSizeUsd}`);
  }

  if (order.price <= 0) {
    issues.push("Invalid price: must be positive");
  }

  if (!order.tokenAddress || !order.chain) {
    issues.push("Missing token address or chain");
  }

  if (order.maxSlippagePct > LIMITS.maxSlippagePct) {
    issues.push(`Slippage tolerance ${order.maxSlippagePct}% exceeds max ${LIMITS.maxSlippagePct}%`);
  }

  return { valid: issues.length === 0, issues };
}

// ─── PAPER EXECUTION ────────────────────────────────────────

/**
 * Simulate order execution with realistic slippage and fees.
 */
function executePaperOrder(order: OrderRequest, pair?: any): OrderResult {
  const startTime = Date.now();

  // Simulate realistic slippage
  let slippagePct = LIMITS.paperSlippageBase * 100;

  // If we have pair data, use the slippage estimator
  if (pair) {
    const slippageEst = estimateSlippage(order.sizeUsd, pair);
    slippagePct = slippageEst.slippagePercent;
  }

  // Apply slippage to fill price
  const slippageDirection = order.side === "buy" ? 1 : -1;
  const fillPrice = order.price * (1 + slippageDirection * slippagePct / 100);

  // Calculate fees
  const feesUsd = order.sizeUsd * LIMITS.paperFeeRate;

  // Calculate token amount
  const effectiveSize = order.sizeUsd - feesUsd;
  const tokenAmount = effectiveSize / fillPrice;

  return {
    success: true,
    mode: "paper",
    fillPrice,
    filledSizeUsd: order.sizeUsd,
    tokenAmount,
    slippagePct,
    feesUsd,
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Simulate partial exit with realistic conditions.
 */
function executePaperPartialExit(request: PartialExitRequest): PartialExitResult {
  const startTime = Date.now();

  const soldSizeUsd = request.positionSizeUsd * (request.exitPercent / 100);
  const slippagePct = LIMITS.paperSlippageBase * 100;
  const fillPrice = request.currentPrice * (1 - slippagePct / 100); // Sell slippage
  const feesUsd = soldSizeUsd * LIMITS.paperFeeRate;

  return {
    success: true,
    mode: "paper",
    fillPrice,
    soldSizeUsd,
    pnlUsd: 0, // Calculated by caller
    slippagePct,
    feesUsd,
    latencyMs: Date.now() - startTime,
  };
}

// ─── LIVE EXECUTION (PLACEHOLDER) ───────────────────────────

/**
 * Live order execution — placeholder for future implementation.
 * Will integrate with Jupiter (Solana) or 1inch (EVM).
 */
function executeLiveOrder(_order: OrderRequest): OrderResult {
  // TODO: Implement live execution
  // For Solana: Jupiter Aggregator API
  // For EVM: 1inch or Paraswap
  return {
    success: false,
    mode: "live",
    fillPrice: 0,
    filledSizeUsd: 0,
    tokenAmount: 0,
    slippagePct: 0,
    feesUsd: 0,
    latencyMs: 0,
    error: "Live execution not yet implemented",
  };
}

// ─── PUBLIC API ─────────────────────────────────────────────

/**
 * Execute an order through the abstraction layer.
 * Handles validation, mode routing, and logging.
 */
export async function executeOrder(order: OrderRequest, pair?: any): Promise<OrderResult> {
  // Pre-validation
  const validation = validateOrder(order);
  if (!validation.valid) {
    return {
      success: false,
      mode: currentMode,
      fillPrice: 0,
      filledSizeUsd: 0,
      tokenAmount: 0,
      slippagePct: 0,
      feesUsd: 0,
      latencyMs: 0,
      error: `Validation failed: ${validation.issues.join("; ")}`,
    };
  }

  // Slippage-adjusted size check
  if (pair) {
    const { adjustedSize, wasReduced } = adjustPositionForSlippage(order.sizeUsd, pair);
    if (wasReduced) {
      console.log(`[Execution] Size reduced from $${order.sizeUsd.toFixed(2)} to $${adjustedSize.toFixed(2)} for slippage`);
      order.sizeUsd = adjustedSize;
    }
  }

  // Route to appropriate executor
  switch (currentMode) {
    case "paper":
      return executePaperOrder(order, pair);

    case "live":
      return executeLiveOrder(order);

    case "shadow": {
      // Execute both paper and live, return paper result
      const paperResult = executePaperOrder(order, pair);
      const liveResult = executeLiveOrder(order);

      // Log comparison for analysis
      if (liveResult.success) {
        const slippageDiff = Math.abs(paperResult.slippagePct - liveResult.slippagePct);
        console.log(`[Shadow] Paper vs Live slippage: ${paperResult.slippagePct.toFixed(2)}% vs ${liveResult.slippagePct.toFixed(2)}% (diff: ${slippageDiff.toFixed(2)}%)`);
      }

      return paperResult; // Return paper result in shadow mode
    }

    default:
      return {
        success: false,
        mode: currentMode,
        fillPrice: 0,
        filledSizeUsd: 0,
        tokenAmount: 0,
        slippagePct: 0,
        feesUsd: 0,
        latencyMs: 0,
        error: `Unknown execution mode: ${currentMode}`,
      };
  }
}

/**
 * Execute a partial exit through the abstraction layer.
 */
export async function executePartialExit(request: PartialExitRequest): Promise<PartialExitResult> {
  switch (currentMode) {
    case "paper":
    case "shadow":
      return executePaperPartialExit(request);

    case "live":
      // TODO: Implement live partial exit
      return {
        success: false,
        mode: "live",
        fillPrice: 0,
        soldSizeUsd: 0,
        pnlUsd: 0,
        slippagePct: 0,
        feesUsd: 0,
        latencyMs: 0,
        error: "Live partial exit not yet implemented",
      };

    default:
      return {
        success: false,
        mode: currentMode,
        fillPrice: 0,
        soldSizeUsd: 0,
        pnlUsd: 0,
        slippagePct: 0,
        feesUsd: 0,
        latencyMs: 0,
        error: `Unknown execution mode: ${currentMode}`,
      };
  }
}

/**
 * Get execution layer status for API exposure.
 */
export function getExecutionStatus() {
  return {
    mode: currentMode,
    limits: LIMITS,
    liveReady: false, // Set to true when live execution is implemented
    supportedChains: currentMode === "paper"
      ? ["solana", "ethereum", "bsc", "base", "arbitrum", "polygon"]
      : [], // Will be populated when live is implemented
  };
}
