import { describe, it, expect } from 'vitest';
import { isBullishRejection, isBearishRejection, isBullishEngulfing, isBearishEngulfing, isHammer, isShootingStar, isDisplacementCandle } from './candles.js';
import type { Candle } from '../types/index.js';

function candle(open: number, close: number, high: number, low: number): Candle {
  return { timestamp: 0, open, close, high, low, volume: 1000 };
}

describe('isHammer (distinct from generic bullish rejection)', () => {
  it('detects a true hammer: small body at top, long lower wick, minimal upper wick', () => {
    // body 98-100 (small), lower wick down to 90 (long), upper wick to 100.2 (minimal)
    const c = candle(98, 100, 100.2, 90);
    expect(isHammer(c)).toBe(true);
  });

  it('rejects a candle with a long lower wick but also a significant upper wick', () => {
    // Long lower wick present, but upper wick is also large — not a clean hammer.
    const c = candle(98, 100, 105, 90);
    expect(isHammer(c)).toBe(false);
    // Still counts as generic bullish rejection though (lower wick dominates, closes high in range).
    expect(isBullishRejection(c)).toBe(true);
  });
});

describe('isShootingStar', () => {
  it('detects a shooting star: small body at bottom, long upper wick, minimal lower wick', () => {
    const c = candle(100, 98, 110, 97.8);
    expect(isShootingStar(c)).toBe(true);
  });
});

describe('isBearishEngulfing', () => {
  it('detects a bearish candle fully engulfing the prior bullish candle', () => {
    const prev = candle(100, 105, 105.5, 99.5); // bullish
    const curr = candle(106, 99, 106.5, 98.5);  // bearish, engulfs prev's range
    expect(isBearishEngulfing(prev, curr)).toBe(true);
  });

  it('does not flag engulfing when the current candle does not fully cover the prior body', () => {
    const prev = candle(100, 105, 105.5, 99.5);
    const curr = candle(103, 101, 103.5, 100.5); // bearish but doesn't engulf
    expect(isBearishEngulfing(prev, curr)).toBe(false);
  });
});

describe('isDisplacementCandle', () => {
  it('flags a candle whose body dominates its range', () => {
    const c = candle(100, 110, 110.5, 99.5); // body=10, range=11, ratio=0.91
    expect(isDisplacementCandle(c)).toBe(true);
  });

  it('does not flag a small-bodied candle with a wide range', () => {
    const c = candle(100, 100.5, 105, 95); // body=0.5, range=10
    expect(isDisplacementCandle(c)).toBe(false);
  });
});
