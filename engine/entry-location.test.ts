import { describe, it, expect } from 'vitest';
import { calcVWAP, calcValueArea, calcFibLevels } from './indicators.js';
import { scoreEntryLocation } from './entry-location.js';
import type { Candle } from '../types/index.js';

function candle(close: number, opts: Partial<Candle> = {}): Candle {
  return {
    timestamp: 0,
    open: opts.open ?? close,
    close,
    high: opts.high ?? close * 1.01,
    low: opts.low ?? close * 0.99,
    volume: opts.volume ?? 1000,
  };
}
function timestamped(candles: Candle[]): Candle[] {
  return candles.map((c, i) => ({ ...c, timestamp: i * 3_600_000 }));
}

describe('calcVWAP', () => {
  it('weights price by volume, not a simple average', () => {
    const candles: Candle[] = [
      candle(100, { high: 100, low: 100, volume: 1 }),
      candle(200, { high: 200, low: 200, volume: 100 }),
    ];
    const vwap = calcVWAP(candles)!;
    expect(vwap).toBeGreaterThan(150); // pulled toward 200 by its much larger volume
    expect(vwap).toBeLessThan(200);
  });

  it('returns null for an empty candle set', () => {
    expect(calcVWAP([])).toBeNull();
  });
});

describe('calcValueArea', () => {
  it('finds the point of control where volume concentrates', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) candles.push(candle(100, { high: 101, low: 99, volume: 100 }));
    for (let i = 0; i < 30; i++) candles.push(candle(150, { high: 151, low: 149, volume: 5000 })); // heavy volume cluster
    const va = calcValueArea(candles)!;
    expect(va.poc).toBeGreaterThan(120); // POC pulled toward the heavy-volume cluster near 150
    expect(va.vaLow).toBeLessThanOrEqual(va.poc);
    expect(va.vaHigh).toBeGreaterThanOrEqual(va.poc);
  });

  it('returns null with too few candles', () => {
    expect(calcValueArea([candle(100), candle(101)])).toBeNull();
  });
});

describe('calcFibLevels', () => {
  it('computes standard retracement levels between a swing low and high', () => {
    const levels = calcFibLevels(100, 200);
    expect(levels['0.5']).toBeCloseTo(150, 5);
    expect(levels['0.618']).toBeCloseTo(200 - 100 * 0.618, 5);
    expect(levels['0.236']).toBeGreaterThan(levels['0.618']!); // shallower retracement = higher price
  });
});

describe('scoreEntryLocation', () => {
  it('returns null with insufficient candle history', () => {
    const candles = timestamped(Array.from({ length: 30 }, (_, i) => candle(100 + i)));
    expect(scoreEntryLocation(candles)).toBeNull();
  });

  it('scores support proximity higher when price sits near a support level than mid-range', () => {
    const base: Candle[] = [];
    for (let i = 0; i < 80; i++) {
      const p = 100 + Math.sin(i / 4) * 5; // oscillates 95-105, creating a support pool near 94
      base.push(candle(p, { high: p + 1, low: p - 1 }));
    }

    const nearSupport = [...base, candle(95.3, { high: 95.6, low: 94.9 })];
    const midRange = [...base, candle(100, { high: 100.5, low: 99.5 })];

    const nearResult = scoreEntryLocation(timestamped(nearSupport))!;
    const midResult = scoreEntryLocation(timestamped(midRange))!;

    // Composite score isn't compared directly here — EMA/fib proximity are
    // legitimately part of the composite and can outweigh support proximity
    // depending on where price sits relative to *all* factors, not just one.
    expect(nearResult.components.supportProximity).toBeGreaterThan(midResult.components.supportProximity);
  });

  it('increases score when a favorable stop/target imply strong RR', () => {
    const base: Candle[] = [];
    for (let i = 0; i < 80; i++) base.push(candle(100 + Math.sin(i / 4) * 3));
    const candles = timestamped(base);

    const noRR = scoreEntryLocation(candles)!;
    const goodRR = scoreEntryLocation(candles, { stopLoss: 95, takeProfit: 130 })!; // price ~100ish, RR > 3
    expect(goodRR.score).toBeGreaterThan(noRR.score);
    expect(goodRR.components.riskRewardScore).toBeGreaterThan(0);
  });

  it('generates three entry zones ordered aggressive -> balanced -> conservative by distance', () => {
    const base: Candle[] = [];
    for (let i = 0; i < 80; i++) base.push(candle(100 + Math.sin(i / 4) * 5));
    const result = scoreEntryLocation(timestamped(base))!;
    expect(result.zones).toHaveLength(3);
    expect(result.zones[0]!.name).toBe('AGGRESSIVE');
    expect(result.zones[0]!.distanceFromPricePct).toBe(0);
    expect(result.zones[2]!.name).toBe('CONSERVATIVE');
    expect(result.zones[2]!.distanceFromPricePct).toBeGreaterThanOrEqual(result.zones[1]!.distanceFromPricePct);
  });
});
