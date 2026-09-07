import { describe, it, expect } from 'vitest';
import { detectRegime, isTradableForLong, regimeScoreMultiplier } from './regime.js';
import type { Candle } from '../types/index.js';

function makeTrend(count: number, startPrice: number, pctPerCandle: number, atrPct = 1.5): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    price = price * (1 + pctPerCandle / 100);
    const close = price;
    const range = close * (atrPct / 100);
    candles.push({
      timestamp: i * 3_600_000,
      open,
      close,
      high: Math.max(open, close) + range / 2,
      low: Math.min(open, close) - range / 2,
      volume: 1000,
    });
  }
  return candles;
}

function makeFlat(count: number, price: number, atrPct = 0.3): Candle[] {
  return makeTrend(count, price, 0, atrPct);
}

describe('detectRegime', () => {
  it('detects STRONG_UPTREND on a sustained steep rally', () => {
    const candles = makeTrend(260, 100, 0.35); // compounds to a steep sustained climb
    const result = detectRegime(candles);
    expect(result.regime).toBe('STRONG_UPTREND');
    expect(result.strength).toBeGreaterThanOrEqual(50);
  });

  it('detects WEAK_UPTREND on a shallow grind up', () => {
    const candles = makeTrend(260, 100, 0.06);
    const result = detectRegime(candles);
    expect(result.regime).toBe('WEAK_UPTREND');
  });

  it('detects STRONG_DOWNTREND on a sustained steep decline', () => {
    const candles = makeTrend(260, 100, -0.35);
    const result = detectRegime(candles);
    expect(result.regime).toBe('STRONG_DOWNTREND');
  });

  it('detects WEAK_DOWNTREND on a shallow grind down', () => {
    const candles = makeTrend(260, 100, -0.06);
    const result = detectRegime(candles);
    expect(result.regime).toBe('WEAK_DOWNTREND');
  });

  it('detects RANGE on flat price action with normal volatility', () => {
    const candles = makeFlat(260, 100, 1.5);
    const result = detectRegime(candles);
    expect(result.regime).toBe('RANGE');
  });

  it('detects COMPRESSION on flat price action with contracted volatility', () => {
    const candles = makeFlat(260, 100, 0.3);
    const result = detectRegime(candles);
    expect(result.regime).toBe('COMPRESSION');
  });

  it('detects HIGH_VOLATILITY when ATR% is extreme regardless of trend', () => {
    const candles = makeTrend(260, 100, 0.1, 6.0);
    const result = detectRegime(candles);
    expect(result.regime).toBe('HIGH_VOLATILITY');
  });

  it('falls back to RANGE when there is not enough history for EMA200', () => {
    const candles = makeFlat(60, 100, 1.5);
    const result = detectRegime(candles);
    expect(result.regime).toBe('RANGE');
  });
});

describe('isTradableForLong', () => {
  it('accepts strong and weak uptrends only', () => {
    expect(isTradableForLong({ regime: 'STRONG_UPTREND', strength: 80, atrPct: 1, emaSlope: 2, emaDistPct: 2 })).toBe(true);
    expect(isTradableForLong({ regime: 'WEAK_UPTREND', strength: 60, atrPct: 1, emaSlope: 0.5, emaDistPct: 1 })).toBe(true);
    expect(isTradableForLong({ regime: 'RANGE', strength: 40, atrPct: 1, emaSlope: 0, emaDistPct: 0 })).toBe(false);
    expect(isTradableForLong({ regime: 'STRONG_DOWNTREND', strength: 80, atrPct: 1, emaSlope: -2, emaDistPct: -2 })).toBe(false);
  });
});

describe('regimeScoreMultiplier', () => {
  it('gives full weight to strong uptrend and zero to downtrends/high volatility', () => {
    expect(regimeScoreMultiplier({ regime: 'STRONG_UPTREND', strength: 90, atrPct: 1, emaSlope: 2, emaDistPct: 2 })).toBe(1.0);
    expect(regimeScoreMultiplier({ regime: 'STRONG_DOWNTREND', strength: 90, atrPct: 1, emaSlope: -2, emaDistPct: -2 })).toBe(0);
    expect(regimeScoreMultiplier({ regime: 'HIGH_VOLATILITY', strength: 90, atrPct: 6, emaSlope: 0, emaDistPct: 0 })).toBe(0);
  });
});