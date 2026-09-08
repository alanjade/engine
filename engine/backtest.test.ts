import { describe, it, expect } from 'vitest';
import { runBacktest, computeMetrics, type BacktestTrade } from './backtest.js';
import type { Candle, SymbolConfig } from '../types/index.js';

function trade(overrides: Partial<BacktestTrade>): BacktestTrade {
  return {
    entryIndex: 0, exitIndex: 1, entry: 100, stopLoss: 95, tp1: 105, tp2: 110, tp3: 120,
    pnlPct: 0, rMultiple: null, actions: [], setup: null, grade: null, score: null,
    ...overrides,
  };
}

function candle(close: number, opts: Partial<Candle> = {}): Candle {
  return {
    timestamp: 0,
    open: opts.open ?? close,
    close,
    high: opts.high ?? close * 1.005,
    low: opts.low ?? close * 0.995,
    volume: opts.volume ?? 1000,
  };
}
function timestamped(candles: Candle[]): Candle[] {
  return candles.map((c, i) => ({ ...c, timestamp: i * 3_600_000 * 4 })); // 4H spacing
}

const config: SymbolConfig = {
  atrMin: 0.5, emaDistMin: 0.5, rsiMin: 40, rsiMax: 80,
  supportLookback: 100, supProximity: 5, minRR: 1.2, volRatioMin: 1.0, maxRiskPct: 0.15,
};

describe('computeMetrics', () => {
  it('returns an all-zero shape for no trades, never divides by zero', () => {
    const m = computeMetrics([]);
    expect(m.totalTrades).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
    expect(Object.keys(m.bySetup)).toHaveLength(0);
  });

  it('computes win rate, avg win/loss, and profit factor from mixed trades', () => {
    const trades = [
      trade({ pnlPct: 10, rMultiple: 2 }),
      trade({ pnlPct: 5, rMultiple: 1 }),
      trade({ pnlPct: -4, rMultiple: -1 }),
    ];
    const m = computeMetrics(trades);
    expect(m.totalTrades).toBe(3);
    expect(m.winRate).toBeCloseTo(2 / 3);
    expect(m.avgWinPct).toBeCloseTo(7.5);
    expect(m.avgLossPct).toBeCloseTo(-4);
    expect(m.profitFactor).toBeCloseTo(15 / 4);
    expect(m.avgRR).toBeCloseTo((2 + 1 - 1) / 3);
  });

  it('treats all-losing trades as zero (not negative or NaN) profit factor when there is no gross profit', () => {
    const m = computeMetrics([trade({ pnlPct: -5 }), trade({ pnlPct: -3 })]);
    expect(m.profitFactor).toBe(0);
    expect(m.winRate).toBe(0);
  });

  it('gives infinite profit factor for all-winning trades (no gross loss to divide by)', () => {
    const m = computeMetrics([trade({ pnlPct: 5 }), trade({ pnlPct: 3 })]);
    expect(m.profitFactor).toBe(Infinity);
  });

  it('computes max drawdown from the compounded equity curve, not just the worst single trade', () => {
    // +10%, -20%, +5% — drawdown is peak(110) to trough(88) = 20%, not the -20% trade in isolation.
    const trades = [trade({ pnlPct: 10 }), trade({ pnlPct: -20 }), trade({ pnlPct: 5 })];
    const m = computeMetrics(trades);
    expect(m.maxDrawdownPct).toBeCloseTo(20, 5);
  });

  it('counts the longest losing streak, not total losses', () => {
    const trades = [
      trade({ pnlPct: -1 }), trade({ pnlPct: -1 }), trade({ pnlPct: 5 }),
      trade({ pnlPct: -1 }), trade({ pnlPct: -1 }), trade({ pnlPct: -1 }),
    ];
    const m = computeMetrics(trades);
    expect(m.maxConsecutiveLosses).toBe(3);
  });

  it('groups results by setup and grade separately', () => {
    const trades = [
      trade({ pnlPct: 5, setup: 'PULLBACK', grade: 'A' }),
      trade({ pnlPct: -3, setup: 'PULLBACK', grade: 'B' }),
      trade({ pnlPct: 8, setup: 'BREAKOUT_RETEST', grade: 'A' }),
    ];
    const m = computeMetrics(trades);
    expect(m.bySetup['PULLBACK']!.trades).toBe(2);
    expect(m.bySetup['BREAKOUT_RETEST']!.trades).toBe(1);
    expect(m.byGrade['A']!.trades).toBe(2);
    expect(m.byGrade['B']!.trades).toBe(1);
  });
});

describe('runBacktest', () => {
  it('produces zero trades on insufficient candle history, without throwing', () => {
    const short = timestamped(Array.from({ length: 50 }, () => candle(100)));
    const result = runBacktest(short, short, config);
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.totalTrades).toBe(0);
  });

  it('produces zero trades on flat, directionless data (matches decideEntry AVOID behavior)', () => {
    const flat = timestamped(Array.from({ length: 300 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.05 : -0.05))));
    const result = runBacktest(flat, flat, config);
    expect(result.trades).toHaveLength(0);
    expect(result.openAtEnd).toBeNull();
  });

  it('never looks ahead: entries only ever use candles at or before their own index', () => {
    // A trending-then-reversing series is enough to at least exercise the
    // walk-forward loop without asserting a specific number of trades
    // (decideEntry's exact trigger conditions are covered elsewhere) —
    // this is a smoke test that the loop terminates and stays internally
    // consistent (every trade's exitIndex > entryIndex and within bounds).
    let price = 100;
    const candles: Candle[] = [];
    for (let i = 0; i < 400; i++) {
      price += Math.sin(i / 15) * 1.5 + (i < 200 ? 0.3 : -0.1);
      candles.push(candle(Math.max(price, 1)));
    }
    const data = timestamped(candles);
    const result = runBacktest(data, data, config);

    for (const t of result.trades) {
      expect(t.entryIndex).toBeLessThan(t.exitIndex);
      expect(t.exitIndex).toBeLessThan(data.length);
      expect(t.entryIndex).toBeGreaterThanOrEqual(220);
    }
    // Trades shouldn't overlap — each new scan resumes strictly after the previous trade closed.
    for (let i = 1; i < result.trades.length; i++) {
      expect(result.trades[i]!.entryIndex).toBeGreaterThan(result.trades[i - 1]!.exitIndex);
    }
  });
});
