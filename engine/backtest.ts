import type { Candle, SymbolConfig } from '../types/index.js';
import { decideEntry } from './trade-state.js';
import { openPosition, updatePosition } from './position-management.js';

export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  /** Weighted across partial closes (TP1/TP2 fractions at their own prices), not just the final exit price. */
  pnlPct: number;
  rMultiple: number | null;
  actions: string[];
  setup: string | null;
  grade: string | null;
  score: number | null;
}

export interface BacktestOptions {
  /** 4H candles of history required before the first entry check. Must be >= what decideEntry itself requires (220) or every check trivially AVOIDs on "Insufficient candle history." */
  minCandles4h?: number;
  minCandles1d?: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  avgRR: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  maxConsecutiveLosses: number;
  bySetup: Record<string, { trades: number; winRate: number; avgRR: number }>;
  byGrade: Record<string, { trades: number; winRate: number; avgRR: number }>;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** A position still open when candle data ran out — excluded from metrics (its outcome is unknown), reported separately. */
  openAtEnd: Omit<BacktestTrade, 'pnlPct' | 'rMultiple'> | null;
  metrics: BacktestMetrics;
}

/** 1D candles with timestamp <= the given 4H bar's timestamp — no lookahead into the future daily candle. */
function alignDaily(candles1d: Candle[], asOfTimestamp: number): Candle[] {
  let end = 0;
  while (end < candles1d.length && candles1d[end]!.timestamp <= asOfTimestamp) end++;
  return candles1d.slice(0, end);
}

/**
 * Walk-forward backtest over 4H candles, reusing the exact same decideEntry
 * (engine/trade-state.ts) and updatePosition (engine/position-management.ts)
 * that run live in engine/runner.ts — so a backtest result reflects the same
 * logic that would fire in production, not a separate reimplementation that
 * could quietly drift from it.
 *
 * At each bar: run decideEntry on only the candles up to and including that
 * bar (no lookahead). On ENTER, open a position and advance bar-by-bar
 * running updatePosition until it closes, weighting P&L by each partial
 * close's own price (TP1/TP2 fractions at their own levels, not the final
 * exit price applied to the whole position) before resuming the scan for
 * the next entry after this trade closes.
 */
export function runBacktest(
  candles4h: Candle[],
  candles1d: Candle[],
  config: SymbolConfig,
  opts: BacktestOptions = {},
): BacktestResult {
  const minCandles4h = opts.minCandles4h ?? 220;
  const minCandles1d = opts.minCandles1d ?? 100;
  const trades: BacktestTrade[] = [];
  let openAtEnd: BacktestResult['openAtEnd'] = null;

  let i = minCandles4h;
  while (i < candles4h.length) {
    const window4h = candles4h.slice(0, i + 1);
    const window1d = alignDaily(candles1d, window4h[window4h.length - 1]!.timestamp);

    if (window1d.length < minCandles1d) { i++; continue; }

    const decision = decideEntry({ candles4h: window4h, candles1d: window1d, config });

    if (decision.state !== 'ENTER' || decision.entry === null || decision.stopLoss === null || !decision.takeProfitLevels) {
      i++;
      continue;
    }

    const { tp1, tp2, tp3 } = decision.takeProfitLevels;
    const entry = decision.entry;
    const initialStopLoss = decision.stopLoss;
    let managed = openPosition(entry, initialStopLoss, tp1, tp2, tp3);
    let prevRemaining = managed.remainingPct;
    let realizedPnlPct = 0;
    const allActions: string[] = [];
    let exitIndex = i;
    let closed = false;

    let j = i + 1;
    while (j < candles4h.length && !closed) {
      const window = candles4h.slice(0, j + 1);
      const prevManaged = managed;
      const result = updatePosition(managed, window);
      managed = result.position;
      allActions.push(...result.actions);

      const closedFractionPct = prevRemaining - managed.remainingPct;
      if (closedFractionPct > 0) {
        const closePrice = result.actions.some(a => a.startsWith('PARTIAL_TP1')) ? prevManaged.tp1
          : result.actions.some(a => a.startsWith('PARTIAL_TP2')) ? prevManaged.tp2
          : result.actions.some(a => a === 'STOP_LOSS_HIT') ? prevManaged.stopLoss
          : result.actions.some(a => a === 'FINAL_TP_HIT') ? prevManaged.tp3
          : window[window.length - 1]!.close; // EMERGENCY_EXIT / TREND_FAILURE_EXIT

        realizedPnlPct += (closedFractionPct / 100) * ((closePrice - entry) / entry) * 100;
      }
      prevRemaining = managed.remainingPct;

      if (result.closed) { closed = true; exitIndex = j; }
      j++;
    }

    const initialRiskPct = ((entry - initialStopLoss) / entry) * 100;
    const rMultiple = closed && initialRiskPct > 0 ? realizedPnlPct / initialRiskPct : null;

    const tradeBase = {
      entryIndex: i, exitIndex, entry, stopLoss: initialStopLoss, tp1, tp2, tp3,
      actions: allActions, setup: decision.score?.bestSetup ?? null,
      grade: decision.score?.grade ?? null, score: decision.score?.total ?? null,
    };

    if (closed) {
      trades.push({ ...tradeBase, pnlPct: realizedPnlPct, rMultiple });
      i = exitIndex + 1;
    } else {
      // Ran out of candle data mid-trade — record it separately, don't score an unknown outcome.
      openAtEnd = tradeBase;
      break;
    }
  }

  return { trades, openAtEnd, metrics: computeMetrics(trades) };
}

export function computeMetrics(trades: BacktestTrade[]): BacktestMetrics {
  const empty: BacktestMetrics = {
    totalTrades: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, avgRR: 0,
    profitFactor: 0, expectancy: 0, maxDrawdownPct: 0, totalReturnPct: 0,
    maxConsecutiveLosses: 0, bySetup: {}, byGrade: {},
  };
  if (trades.length === 0) return empty;

  const wins = trades.filter(t => t.pnlPct > 0);
  const losses = trades.filter(t => t.pnlPct <= 0);

  const avgWinPct = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  const winRate = wins.length / trades.length;
  const expectancy = winRate * avgWinPct + (1 - winRate) * avgLossPct;

  const rMultiples = trades.map(t => t.rMultiple).filter((r): r is number => r !== null);
  const avgRR = rMultiples.length ? rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length : 0;

  // Equity curve compounding each trade's pct return, for drawdown + total return.
  let equity = 100;
  let peak = 100;
  let maxDrawdownPct = 0;
  for (const t of trades) {
    equity *= 1 + t.pnlPct / 100;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }
  const totalReturnPct = ((equity - 100) / 100) * 100;

  let maxConsecutiveLosses = 0;
  let streak = 0;
  for (const t of trades) {
    if (t.pnlPct <= 0) { streak++; maxConsecutiveLosses = Math.max(maxConsecutiveLosses, streak); }
    else streak = 0;
  }

  const groupBy = (keyFn: (t: BacktestTrade) => string | null): Record<string, { trades: number; winRate: number; avgRR: number }> => {
    const groups: Record<string, BacktestTrade[]> = {};
    for (const t of trades) {
      const key = keyFn(t) ?? 'UNKNOWN';
      (groups[key] ??= []).push(t);
    }
    const out: Record<string, { trades: number; winRate: number; avgRR: number }> = {};
    for (const [key, group] of Object.entries(groups)) {
      const groupWins = group.filter(t => t.pnlPct > 0).length;
      const groupR = group.map(t => t.rMultiple).filter((r): r is number => r !== null);
      out[key] = {
        trades: group.length,
        winRate: groupWins / group.length,
        avgRR: groupR.length ? groupR.reduce((s, r) => s + r, 0) / groupR.length : 0,
      };
    }
    return out;
  };

  return {
    totalTrades: trades.length, winRate, avgWinPct, avgLossPct, avgRR,
    profitFactor, expectancy, maxDrawdownPct, totalReturnPct, maxConsecutiveLosses,
    bySetup: groupBy(t => t.setup),
    byGrade: groupBy(t => t.grade),
  };
}
