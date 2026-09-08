import { describe, it, expect } from 'vitest';
import { classifyMomentum, detectMomentumExpansion, detectMomentumExhaustion, detectBullishDivergence, detectBearishDivergence, findBullishDivergence, findBearishDivergence } from './momentum.js';
import type { Candle } from '../types/index.js';

function candle(close: number): Candle {
  return { timestamp: 0, open: close, close, high: close * 1.01, low: close * 0.99, volume: 1000 };
}
function timestamped(candles: Candle[]): Candle[] {
  return candles.map((c, i) => ({ ...c, timestamp: i * 3_600_000 }));
}

describe('classifyMomentum', () => {
  it('classifies overbought, oversold, and neutral correctly', () => {
    expect(classifyMomentum(75)).toBe('OVERBOUGHT');
    expect(classifyMomentum(25)).toBe('OVERSOLD');
    expect(classifyMomentum(50)).toBe('NEUTRAL');
  });
});

describe('detectMomentumExpansion', () => {
  it('detects RSI accelerating away from 50 during a steady climb', () => {
    const closes: number[] = [];
    let price = 100;
    for (let i = 0; i < 30; i++) { price *= (i % 2 === 0 ? 1.003 : 0.997); closes.push(price); } // choppy, RSI near 50
    for (let i = 0; i < 10; i++) { price *= 1.012; closes.push(price); } // then a clean push up
    const candles = timestamped(closes.map(candle));
    expect(detectMomentumExpansion(candles)).toBe(true);
  });

  it('does not detect expansion on flat price action', () => {
    const candles = timestamped(Array.from({ length: 40 }, () => candle(100)));
    expect(detectMomentumExpansion(candles)).toBe(false);
  });
});

describe('detectMomentumExhaustion', () => {
  it('detects RSI pulling back after holding an overbought extreme', () => {
    const closes: number[] = [];
    let price = 100;
    for (let i = 0; i < 30; i++) { price *= 1.02; closes.push(price); } // push RSI to overbought
    for (let i = 0; i < 6; i++) { price *= 0.995; closes.push(price); } // pull back — RSI unwinds
    const candles = timestamped(closes.map(candle));
    expect(detectMomentumExhaustion(candles)).toBe(true);
  });

  it('does not detect exhaustion when RSI never reached an extreme', () => {
    const closes: number[] = [];
    let price = 100;
    for (let i = 0; i < 40; i++) { price *= 1.001; closes.push(price); }
    const candles = timestamped(closes.map(candle));
    expect(detectMomentumExhaustion(candles)).toBe(false);
  });
});

describe('findBullishDivergence / findBearishDivergence (pure comparison)', () => {
  it('detects bullish divergence: lower low in price paired with higher low in the indicator', () => {
    const price =     [10, 8, 9, 5, 7]; // swing lows at index1 (8) and index3 (5) — lower low
    const indicator = [40, 30, 45, 35, 50]; // swing lows at index1 (30) and index3 (35) — higher low
    expect(findBullishDivergence(price, indicator)).toBe(true);
  });

  it('does not flag divergence when the indicator also makes a lower low', () => {
    const price =     [10, 8, 9, 5, 7];
    const indicator = [40, 30, 45, 20, 50]; // indicator low also drops (30 -> 20) — confirms, no divergence
    expect(findBullishDivergence(price, indicator)).toBe(false);
  });

  it('detects bearish divergence: higher high in price paired with lower high in the indicator', () => {
    const price =     [10, 15, 12, 18, 14]; // swing highs at index1 (15) and index3 (18) — higher high
    const indicator = [40, 60, 45, 55, 50]; // swing highs at index1 (60) and index3 (55) — lower high
    expect(findBearishDivergence(price, indicator)).toBe(true);
  });

  it('does not flag divergence with too few swings', () => {
    expect(findBullishDivergence([10, 9, 8], [40, 39, 38])).toBe(false);
  });
});

describe('detectBullishDivergence / detectBearishDivergence (RSI-wired, integration smoke test)', () => {
  it('runs without throwing and returns a boolean on real candle data', () => {
    const closes: number[] = [];
    let price = 100;
    for (let i = 0; i < 60; i++) { price *= 1 + (Math.sin(i / 3) * 0.01); closes.push(price); }
    const candles = timestamped(closes.map(candle));
    expect(typeof detectBullishDivergence(candles)).toBe('boolean');
    expect(typeof detectBearishDivergence(candles)).toBe('boolean');
  });
});
