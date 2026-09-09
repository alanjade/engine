import type { SymbolConfig } from '../types/index.js';

// ── Per-symbol configuration ──────────────────────────────────────────────────
// Extracted from signal.ts so runner.ts (decideEntry/decideExit pipeline) and
// signal.ts (legacy, kept for reference/tests) share one source of truth
// instead of two configs silently drifting apart.
export const SYMBOL_CONFIG: Record<string, SymbolConfig> = {
  'BTC/USDT':  { atrMin: 0.6, emaDistMin: 1.2, rsiMin: 52, rsiMax: 72, supportLookback: 120, supProximity: 2.5, minRR: 1.5, volRatioMin: 1.2,  maxRiskPct: 5 },
  'ETH/USDT':  { atrMin: 0.8, emaDistMin: 1.0, rsiMin: 50, rsiMax: 73, supportLookback: 100, supProximity: 2.8, minRR: 1.5, volRatioMin: 1.15, maxRiskPct: 6 },
  'BNB/USDT':  { atrMin: 0.9, emaDistMin: 1.0, rsiMin: 50, rsiMax: 73, supportLookback: 100, supProximity: 3.0, minRR: 1.4, volRatioMin: 1.1,  maxRiskPct: 6 },
  'XRP/USDT':  { atrMin: 1.0, emaDistMin: 0.8, rsiMin: 48, rsiMax: 74, supportLookback: 100, supProximity: 3.0, minRR: 1.5, volRatioMin: 1.15, maxRiskPct: 7 },
  'DOGE/USDT': { atrMin: 1.5, emaDistMin: 0.7, rsiMin: 46, rsiMax: 74, supportLookback: 80,  supProximity: 4.0, minRR: 1.6, volRatioMin: 1.2,  maxRiskPct: 9 },
  'ADA/USDT':  { atrMin: 1.0, emaDistMin: 0.8, rsiMin: 48, rsiMax: 73, supportLookback: 100, supProximity: 3.0, minRR: 1.5, volRatioMin: 1.1,  maxRiskPct: 7 },
  'AVAX/USDT': { atrMin: 1.5, emaDistMin: 0.8, rsiMin: 48, rsiMax: 74, supportLookback: 80,  supProximity: 3.5, minRR: 1.5, volRatioMin: 1.1,  maxRiskPct: 8 },
  'GRAM/USDT': { atrMin: 1.5, emaDistMin: 0.6, rsiMin: 46, rsiMax: 75, supportLookback: 70,  supProximity: 4.0, minRR: 1.6, volRatioMin: 1.1,  maxRiskPct: 9 },
  'NEAR/USDT': { atrMin: 2.0, emaDistMin: 0.6, rsiMin: 45, rsiMax: 75, supportLookback: 70,  supProximity: 4.0, minRR: 1.6, volRatioMin: 1.1,  maxRiskPct: 10 },
};

export const DEFAULT_CONFIG: SymbolConfig = {
  atrMin: 1.0, emaDistMin: 1.0, rsiMin: 50, rsiMax: 73,
  supportLookback: 80, supProximity: 3.0, minRR: 1.5, volRatioMin: 1.15, maxRiskPct: 8,
};

export function cfg(symbol: string): SymbolConfig {
  return SYMBOL_CONFIG[symbol] ?? DEFAULT_CONFIG;
}
