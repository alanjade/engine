import { describe, it, expect } from 'vitest';
import { detectPullback, detectBreakoutRetest, detectLiquiditySweep, detectCompressionBreakout } from './setups.js';
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

describe('detectPullback', () => {
  it('detects a pullback in an established uptrend with a rejection candle', () => {
    const candles: Candle[] = [];
    let price = 100;
    // Long steady climb to establish EMA50 > EMA200.
    for (let i = 0; i < 200; i++) {
      price *= 1.006;
      candles.push(candle(price));
    }
    // Flatten at the peak so EMA20 anchors near it (otherwise EMA20 lags
    // far behind a still-climbing price and a modest pullback can't reach it).
    for (let i = 0; i < 15; i++) candles.push(candle(price));
    // Pullback ~3% off the high, then a bullish rejection candle: small body,
    // long lower wick, closes near the high (close > open).
    for (let i = 0; i < 6; i++) price *= 0.995;
    candles.push(candle(price * 1.002, { open: price, high: price * 1.005, low: price * 0.97 }));

    const result = detectPullback(timestamped(candles));
    expect(result.detected).toBe(true);
    expect(result.quality).toBeGreaterThan(0);
  });

  it('does not detect a pullback with insufficient history', () => {
    const candles = timestamped(Array.from({ length: 50 }, (_, i) => candle(100 + i)));
    const result = detectPullback(candles);
    expect(result.detected).toBe(false);
  });
});

describe('detectBreakoutRetest', () => {
  it('detects a breakout that retests and holds', () => {
    const candles: Candle[] = [];
    // Explicit resistance at exactly 108: repeated touches, other highs
    // vary enough (small increasing jitter) that they don't cluster into a
    // second false resistance level.
    for (let i = 0; i < 58; i++) {
      const touch = i % 6 === 5;
      const high = touch ? 108 : 100 + (i % 7) * 0.37;
      candles.push(candle(high - 3, { high, low: high - 6 }));
    }
    // Displacement breakout candle with volume expansion — closes well above 108.
    candles.push(candle(118, { open: 107, high: 119, low: 106.5, volume: 5000 }));
    // Retest: pulls back to exactly the old resistance level (108, now support).
    candles.push(candle(112, { open: 117, high: 117.5, low: 107.6, volume: 1200 }));
    // Retest holds: bullish candle closing back above the level.
    candles.push(candle(115, { open: 111, high: 115.5, low: 109.5, volume: 1300 }));

    const result = detectBreakoutRetest(timestamped(candles));
    expect(result.detected).toBe(true);
  });

  it('does not detect a breakout with no prior resistance', () => {
    const candles = timestamped(Array.from({ length: 60 }, (_, i) => candle(100 + i * 0.5)));
    const result = detectBreakoutRetest(candles);
    expect(result.detected).toBe(false);
  });
});

describe('detectLiquiditySweep', () => {
  it('detects a sweep below a support pool with reclaim', () => {
    const candles: Candle[] = [];
    // Support pool with several genuine local-minima touches near 93 (no
    // clamping/flat plateaus — pivot detection needs strict local minima).
    for (let i = 0; i < 58; i++) {
      const p = 98 + Math.sin(i / 4) * 5;
      candles.push(candle(p, { high: p + 2, low: p - 2 }));
    }
    // Sweep candle: wicks below the ~91 pool but closes back above it.
    candles.push(candle(94.5, { open: 95, high: 95.2, low: 90.5, volume: 1500 }));
    // Confirmation: closes clearly above the pool.
    candles.push(candle(97, { open: 94.5, high: 97.2, low: 94.3, volume: 1200 }));

    const result = detectLiquiditySweep(timestamped(candles));
    expect(result.detected).toBe(true);
  });

  it('does not detect a sweep with no reclaim', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const p = 100 + Math.sin(i / 3) * 5;
      candles.push(candle(p, { high: p + 2, low: Math.max(p - 2, 95) }));
    }
    // Wicks below and stays below — no reclaim.
    candles.push(candle(93, { open: 95, high: 95.2, low: 92, volume: 1500 }));
    const result = detectLiquiditySweep(timestamped(candles));
    expect(result.detected).toBe(false);
  });
});

describe('detectCompressionBreakout', () => {
  it('detects a breakout from a tight, contracting range with volume expansion', () => {
    const candles: Candle[] = [];
    // Wide-ish volatility first (so ATR "prior" is elevated).
    for (let i = 0; i < 45; i++) {
      const p = 100 + (i % 2 === 0 ? 2 : -2);
      candles.push(candle(p, { high: p + 3, low: p - 3, volume: 1000 }));
    }
    // Then tight compression: narrow range, low ATR.
    for (let i = 0; i < 14; i++) {
      candles.push(candle(100.2, { high: 100.5, low: 99.8, volume: 800 }));
    }
    // Breakout candle above the compressed range with volume expansion.
    candles.push(candle(103, { open: 100.3, high: 103.2, low: 100.2, volume: 2500 }));

    const result = detectCompressionBreakout(timestamped(candles));
    expect(result.detected).toBe(true);
  });

  it('does not detect a breakout when the range is not tight', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 44; i++) {
      const p = 100 + Math.sin(i / 2) * 10;
      candles.push(candle(p, { high: p + 5, low: p - 5, volume: 1000 }));
    }
    candles.push(candle(120, { open: 105, high: 121, low: 104, volume: 3000 }));
    const result = detectCompressionBreakout(timestamped(candles));
    expect(result.detected).toBe(false);
  });
});
