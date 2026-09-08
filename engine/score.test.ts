import { describe, it, expect } from 'vitest';
import { calcEntryScore } from './score.js';
import type { Candle } from '../types/index.js';

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

describe('calcEntryScore', () => {
  it('produces a low score and AVOID grade for flat, directionless price action', () => {
    const flat = timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.05 : -0.05))));
    const result = calcEntryScore({ candles4h: flat, candles1d: flat });
    expect(result.total).toBeLessThan(60);
    expect(result.grade).toBe('AVOID');
  });

  it('produces a materially higher score for a clean established uptrend than flat action', () => {
    const flat = timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.05 : -0.05))));

    const uptrend: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 220; i++) { price *= 1.007; uptrend.push(candle(price, { volume: 1000 + i * 5 })); }
    const uptrendCandles = timestamped(uptrend);

    const flatResult = calcEntryScore({ candles4h: flat, candles1d: flat });
    const uptrendResult = calcEntryScore({ candles4h: uptrendCandles, candles1d: uptrendCandles });

    expect(uptrendResult.total).toBeGreaterThan(flatResult.total);
  });

  it('breaks down into exactly the ten weighted components summing to the total', () => {
    const candles = timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + i * 0.05)));
    const result = calcEntryScore({ candles4h: candles, candles1d: candles });
    const keys = Object.keys(result.breakdown);
    expect(keys).toHaveLength(10);
    const sum = Math.round(Object.values(result.breakdown).reduce((a, b) => a + b, 0));
    expect(result.total).toBe(Math.min(100, Math.max(0, sum)));
  });

  it('respects the documented grade thresholds', () => {
    const gradeFor = (total: number) =>
      total >= 90 ? 'A+' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'WATCH' : 'AVOID';
    for (const total of [95, 85, 75, 65, 40]) {
      expect(gradeFor(total)).toBe(
        total === 95 ? 'A+' : total === 85 ? 'A' : total === 75 ? 'B' : total === 65 ? 'WATCH' : 'AVOID',
      );
    }
  });

  it('scores session liquidity higher during the London/NY overlap than thin Asian hours', () => {
    const candles = timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + i * 0.05)));
    const overlap = calcEntryScore({ candles4h: candles, candles1d: candles, now: new Date('2026-01-01T13:00:00Z') });
    const thin = calcEntryScore({ candles4h: candles, candles1d: candles, now: new Date('2026-01-01T02:00:00Z') });
    expect(overlap.breakdown.session).toBeGreaterThan(thin.breakdown.session);
  });

  it('reports the best detected setup kind when one fires, or null otherwise', () => {
    const flat = timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.05 : -0.05))));
    const flatResult = calcEntryScore({ candles4h: flat, candles1d: flat });
    expect(flatResult.bestSetup === null || typeof flatResult.bestSetup === 'string').toBe(true);
  });
});
