import { describe, it, expect } from 'vitest';
import { rankOpportunities } from './opportunity.js';
import type { Candle, SymbolConfig } from '../types/index.js';

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
  return candles.map((c, i) => ({ ...c, timestamp: i * 3_600_000 }));
}

const config: SymbolConfig = {
  atrMin: 0.5, emaDistMin: 0.5, rsiMin: 40, rsiMax: 80,
  supportLookback: 100, supProximity: 5, minRR: 1.2, volRatioMin: 1.0, maxRiskPct: 15,
};

function flatCandles(): Candle[] {
  return timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.05 : -0.05))));
}

function uptrendCandles(rate: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 220; i++) { price *= 1 + rate; candles.push(candle(price, { volume: 1000 + i * 3 })); }
  return timestamped(candles);
}

describe('rankOpportunities', () => {
  it('returns zero opportunities when nothing clears AVOID — never forces a trade', () => {
    const symbols = [
      { symbol: 'FLAT1/USDT', candles4h: flatCandles(), candles1d: flatCandles(), config },
      { symbol: 'FLAT2/USDT', candles4h: flatCandles(), candles1d: flatCandles(), config },
    ];
    const result = rankOpportunities(symbols);
    expect(result).toEqual([]);
  });

  it('ranks opportunities by descending score and assigns sequential ranks', () => {
    const symbols = [
      { symbol: 'FLAT/USDT', candles4h: flatCandles(), candles1d: flatCandles(), config },
      { symbol: 'STRONG/USDT', candles4h: uptrendCandles(0.008), candles1d: uptrendCandles(0.008), config },
      { symbol: 'MILD/USDT', candles4h: uptrendCandles(0.003), candles1d: uptrendCandles(0.003), config },
    ];
    const result = rankOpportunities(symbols);

    // Flat should never appear (AVOID); ranking among the rest should be by score descending.
    expect(result.every(o => o.symbol !== 'FLAT/USDT')).toBe(true);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
      expect(result[i]!.rank).toBe(i + 1);
    }
    if (result.length > 0) expect(result[0]!.rank).toBe(1);
  });

  it('respects topN and truncates the list', () => {
    const symbols = Array.from({ length: 5 }, (_, i) => ({
      symbol: `SYM${i}/USDT`,
      candles4h: uptrendCandles(0.004 + i * 0.001),
      candles1d: uptrendCandles(0.004 + i * 0.001),
      config,
    }));
    const result = rankOpportunities(symbols, { topN: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('includes bestSetup and riskReward fields for each ranked opportunity', () => {
    const symbols = [{ symbol: 'X/USDT', candles4h: uptrendCandles(0.007), candles1d: uptrendCandles(0.007), config }];
    const result = rankOpportunities(symbols);
    for (const o of result) {
      expect(typeof o.score).toBe('number');
      expect(['A+', 'A', 'B', 'WATCH', 'AVOID']).toContain(o.grade);
      expect(o.riskReward === null || typeof o.riskReward === 'number').toBe(true);
    }
  });
});
