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
    expect(isTradableForLong({ regime: 'STRONG_UPTREND', strength: 80, atrPct: 1, emaSlope: 2, emaDistPct: 2 , emaBullish: true })).toBe(true);
    expect(isTradableForLong({ regime: 'WEAK_UPTREND', strength: 60, atrPct: 1, emaSlope: 0.5, emaDistPct: 1 , emaBullish: true })).toBe(true);
    expect(isTradableForLong({ regime: 'RANGE', strength: 40, atrPct: 1, emaSlope: 0, emaDistPct: 0 , emaBullish: false })).toBe(false);
    expect(isTradableForLong({ regime: 'STRONG_DOWNTREND', strength: 80, atrPct: 1, emaSlope: -2, emaDistPct: -2 , emaBullish: false })).toBe(false);
  });

  it('accepts a RANGE read when EMA alignment is still bullish (a pullback, not a real range)', () => {
    expect(isTradableForLong({ regime: 'RANGE', strength: 40, atrPct: 1, emaSlope: 0.1, emaDistPct: 1.5, emaBullish: true })).toBe(true);
  });

  it('rejects a RANGE read with no bullish EMA alignment (a genuine range)', () => {
    expect(isTradableForLong({ regime: 'RANGE', strength: 40, atrPct: 1, emaSlope: 0, emaDistPct: 0, emaBullish: false })).toBe(false);
  });

  it('detects a real pullback fixture as tradable: sustained uptrend, then a flattening pullback', () => {
    const uptrend = makeTrend(200, 100, 0.7); // establish strong uptrend
    const lastPrice = uptrend[uptrend.length - 1]!.close;
    const pullback = makeTrend(20, lastPrice, -0.1).map((c, i) => ({ ...c, timestamp: (200 + i) * 3_600_000 })); // flattens/dips recent slope
    const candles = [...uptrend, ...pullback];
    const result = detectRegime(candles);
    // Whatever specific regime label it lands on, EMA alignment must still
    // read bullish (price pulled back slightly, didn't invalidate the trend),
    // and it must be tradable — that's the actual bug this fixes.
    expect(result.emaBullish).toBe(true);
    expect(isTradableForLong(result)).toBe(true);
  });
});

describe('regimeScoreMultiplier', () => {
  it('gives full weight to strong uptrend and zero to downtrends/high volatility', () => {
    expect(regimeScoreMultiplier({ regime: 'STRONG_UPTREND', strength: 90, atrPct: 1, emaSlope: 2, emaDistPct: 2 , emaBullish: true })).toBe(1.0);
    expect(regimeScoreMultiplier({ regime: 'STRONG_DOWNTREND', strength: 90, atrPct: 1, emaSlope: -2, emaDistPct: -2 , emaBullish: false })).toBe(0);
    expect(regimeScoreMultiplier({ regime: 'HIGH_VOLATILITY', strength: 90, atrPct: 6, emaSlope: 0, emaDistPct: 0 , emaBullish: false })).toBe(0);
  });
});
