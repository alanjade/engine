import { describe, it, expect } from 'vitest';
import { calcApproxDelta, calcCVDSeries, detectBullishCVD, detectBearishCVD, analyzeCVD, cvdScoreMultiplier } from './cvd.js';
import type { Candle } from '../types/index.js';

function candle(close: number, opts: Partial<Candle> = {}): Candle {
  return {
    timestamp: 0,
    open: opts.open ?? close,
    close,
    high: opts.high ?? close + 1,
    low: opts.low ?? close - 1,
    volume: opts.volume ?? 1000,
  };
}
function timestamped(candles: Candle[]): Candle[] {
  return candles.map((c, i) => ({ ...c, timestamp: i * 3_600_000 }));
}

describe('calcApproxDelta', () => {
  it('is positive when close is near the high (buy pressure)', () => {
    const c = candle(9.9, { high: 10, low: 9, volume: 1000 });
    expect(calcApproxDelta(c)).toBeGreaterThan(0);
  });

  it('is negative when close is near the low (sell pressure)', () => {
    const c = candle(9.1, { high: 10, low: 9, volume: 1000 });
    expect(calcApproxDelta(c)).toBeLessThan(0);
  });

  it('is exactly zero when close sits at the midpoint', () => {
    const c = candle(9.5, { high: 10, low: 9, volume: 1000 });
    expect(calcApproxDelta(c)).toBeCloseTo(0, 5);
  });

  it('returns zero for a zero-range candle rather than dividing by zero', () => {
    const c = candle(10, { high: 10, low: 10, volume: 1000 });
    expect(calcApproxDelta(c)).toBe(0);
  });
});

describe('calcCVDSeries', () => {
  it('accumulates delta across candles', () => {
    const candles = [
      candle(9.9, { high: 10, low: 9, volume: 1000 }), // strong buy delta
      candle(9.9, { high: 10, low: 9, volume: 1000 }), // strong buy delta again
    ];
    const series = calcCVDSeries(candles);
    expect(series[1]!).toBeGreaterThan(series[0]!);
  });
});

describe('detectBullishCVD / detectBearishCVD', () => {
  it('detects bullish CVD when closes consistently sit near the high', () => {
    const candles = timestamped(Array.from({ length: 20 }, () => candle(9.9, { high: 10, low: 9, volume: 1000 })));
    expect(detectBullishCVD(candles)).toBe(true);
    expect(detectBearishCVD(candles)).toBe(false);
  });

  it('detects bearish CVD when closes consistently sit near the low', () => {
    const candles = timestamped(Array.from({ length: 20 }, () => candle(9.1, { high: 10, low: 9, volume: 1000 })));
    expect(detectBearishCVD(candles)).toBe(true);
    expect(detectBullishCVD(candles)).toBe(false);
  });
});

describe('analyzeCVD', () => {
  it('returns null with insufficient candles', () => {
    expect(analyzeCVD(timestamped([candle(100)]), 20)).toBeNull();
  });

  it('reports BULLISH trend and confirmsPrice=true when price and CVD both rise', () => {
    // Close sits near the top of each candle's own range (high-low), which
    // is what drives a positive delta — not just that price rises overall.
    const candles = timestamped(Array.from({ length: 20 }, (_, i) => candle(100 + i, { high: 100 + i + 0.1, low: 100 + i - 0.9, volume: 1000 })));
    const result = analyzeCVD(candles)!;
    expect(result.trend).toBe('BULLISH');
    expect(result.confirmsPrice).toBe(true);
  });
});

describe('cvdScoreMultiplier', () => {
  it('returns a neutral multiplier when analysis is unavailable', () => {
    expect(cvdScoreMultiplier(null)).toBe(0.5);
  });

  it('scores bullish-divergence highest and bearish-divergence lowest', () => {
    const bullDiv = { cvd: [], trend: 'FLAT' as const, bullishDivergence: true, bearishDivergence: false, confirmsPrice: false };
    const bearDiv = { cvd: [], trend: 'FLAT' as const, bullishDivergence: false, bearishDivergence: true, confirmsPrice: false };
    expect(cvdScoreMultiplier(bullDiv)).toBeGreaterThan(cvdScoreMultiplier(bearDiv));
  });
});
