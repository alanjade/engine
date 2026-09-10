import { describe, it, expect, vi } from 'vitest';
import type { Candle, SymbolConfig, EntryDecision } from '../types/index.js';

// This file's mock of trade-state.js is scoped to this module only (vitest
// isolates mocks per test file), so it doesn't affect backtest.test.ts's
// use of the real decideEntry. Forcing a single deterministic ENTER lets us
// assert the fee/slippage/funding bookkeeping in runBacktest directly,
// without depending on decideEntry's real signal logic firing on synthetic
// price data (which is fragile and not what these tests are about).
vi.mock('./trade-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./trade-state.js')>();
  return {
    ...actual,
    decideEntry: (args: { candles4h: Candle[] }): EntryDecision => {
      // candles4h.length is exactly 221 on one and only one bar per backtest
      // run (the first bar checked, at minCandles4h=220) — fire ENTER there,
      // AVOID everywhere else.
      if (args.candles4h.length === 221) {
        return {
          state: 'ENTER',
          reasons: ['forced entry for cost-model test'],
          score: { total: 90, grade: 'A', bestSetup: 'TEST', breakdown: {} } as unknown as EntryDecision['score'],
          chase: null as unknown as EntryDecision['chase'],
          confirmation: null as unknown as EntryDecision['confirmation'],
          entry: 100,
          stopLoss: 90,
          takeProfit: 140,
          riskReward: 4,
          regime: 'STRONG_UPTREND' as unknown as EntryDecision['regime'],
          takeProfitLevels: { tp1: 110, tp2: 120, tp3: 140, rr1: 2, rr2: 3, rr3: 5 },
          entryZones: [] as unknown as EntryDecision['entryZones'],
        };
      }
      return {
        state: 'AVOID',
        reasons: ['forced avoid for cost-model test'],
        score: null, chase: null, confirmation: null, entry: null, stopLoss: null,
        takeProfit: null, riskReward: null, regime: 'RANGE' as unknown as EntryDecision['regime'],
        takeProfitLevels: null, entryZones: [] as unknown as EntryDecision['entryZones'],
      } as unknown as EntryDecision;
    },
  };
});

const { runBacktest } = await import('./backtest.js');

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
  supportLookback: 100, supProximity: 5, minRR: 1.2, volRatioMin: 1.0, maxRiskPct: 15,
};

// Price sits flat at 100 through the forced entry, then ramps up far enough
// to clear tp1 (110), tp2 (120), and tp3 (140) — so the forced trade actually
// closes within the dataset rather than being left openAtEnd.
function forcedEntryCandles(): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < 260; i++) {
    const price = i > 221 ? 100 + (i - 221) * 3 : 100;
    candles.push(candle(price));
  }
  return timestamped(candles);
}

describe('runBacktest cost model (fees, slippage, funding)', () => {
  it('deducts a positive cost from grossPnlPct to get pnlPct', () => {
    const data = forcedEntryCandles();
    const result = runBacktest(data, data, config);

    expect(result.trades.length).toBe(1);
    const [t] = result.trades;
    expect(t!.costPct).toBeGreaterThan(0);
    expect(t!.pnlPct).toBeCloseTo(t!.grossPnlPct - t!.costPct, 10);
  });

  it('charges zero cost when fees, slippage, and funding are all set to zero', () => {
    const data = forcedEntryCandles();
    const result = runBacktest(data, data, config, {
      feePctPerFill: 0,
      slippagePctPerFill: 0,
      fundingPctPerDay: 0,
    });

    expect(result.trades.length).toBe(1);
    const [t] = result.trades;
    expect(t!.costPct).toBe(0);
    expect(t!.pnlPct).toBe(t!.grossPnlPct);
  });

  it('charges only the entry+exit fee/slippage when funding is zero and the trade closes on one fill', () => {
    const data = forcedEntryCandles();
    const feePctPerFill = 0.05;
    const slippagePctPerFill = 0.02;
    const result = runBacktest(data, data, config, {
      feePctPerFill,
      slippagePctPerFill,
      fundingPctPerDay: 0,
    });

    expect(result.trades.length).toBe(1);
    const [t] = result.trades;
    // Entry fill + exit fill, each at (fee+slippage)% of the fraction closed.
    // Position may close in one or more partial fills; total closed fraction
    // is always 100%, so total fill-cost is exactly 2x one full-size fill
    // (entry once at 100%, exits summing to 100%).
    const expectedFillCost = 2 * (feePctPerFill + slippagePctPerFill);
    expect(t!.costPct).toBeCloseTo(expectedFillCost, 10);
  });

  it('charges strictly more cost for a higher funding rate, all else equal', () => {
    const data = forcedEntryCandles();
    const zeroFunding = runBacktest(data, data, config, { fundingPctPerDay: 0 });
    const highFunding = runBacktest(data, data, config, { fundingPctPerDay: 1 });

    expect(zeroFunding.trades.length).toBe(1);
    expect(highFunding.trades.length).toBe(1);
    expect(highFunding.trades[0]!.costPct).toBeGreaterThan(zeroFunding.trades[0]!.costPct);
  });
});
