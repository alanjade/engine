import { describe, it, expect } from 'vitest';
import {
  detectExcessiveEmaDistance, detectExcessiveSupportDistance, detectExcessiveBreakoutDistance,
  detectLargeCandle, detectExcessive24hMove, detectOverextendedRSI, detectDeterioratingRR,
  analyzeChase, chaseLabel,
} from './chase.js';
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

describe('individual chase detectors', () => {
  it('flags excessive EMA distance only when price has run away above the EMA', () => {
    expect(detectExcessiveEmaDistance(110, 100, 6)).toBe(true); // 10% above
    expect(detectExcessiveEmaDistance(102, 100, 6)).toBe(false); // only 2% above
    expect(detectExcessiveEmaDistance(90, 100, 6)).toBe(false); // below the EMA, not chasing
  });

  it('flags excessive distance from support', () => {
    expect(detectExcessiveSupportDistance(112, 100, 8)).toBe(true);
    expect(detectExcessiveSupportDistance(103, 100, 8)).toBe(false);
  });

  it('flags excessive distance above a breakout level', () => {
    expect(detectExcessiveBreakoutDistance(110, 100, 5)).toBe(true);
    expect(detectExcessiveBreakoutDistance(102, 100, 5)).toBe(false);
  });

  it('flags a large recent candle relative to ATR', () => {
    const normal = Array.from({ length: 20 }, () => candle(100, { high: 101, low: 99 }));
    const withBlowoff = [...normal.slice(0, -1), candle(110, { open: 100, high: 112, low: 99 })];
    expect(detectLargeCandle(timestamped(withBlowoff))).toBe(true);
    expect(detectLargeCandle(timestamped(normal))).toBe(false);
  });

  it('flags excessive 24h move', () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(100 * (1 + i * 0.03))); // ~27% cumulative over the window
    expect(detectExcessive24hMove(timestamped(candles), 6, 15)).toBe(true);
    const flat = Array.from({ length: 10 }, () => candle(100));
    expect(detectExcessive24hMove(timestamped(flat), 6, 15)).toBe(false);
  });

  it('flags overextended RSI', () => {
    expect(detectOverextendedRSI(80)).toBe(true);
    expect(detectOverextendedRSI(60)).toBe(false);
  });

  it('flags deteriorating RR when current RR has shrunk well below the original', () => {
    expect(detectDeterioratingRR(1.0, 2.0)).toBe(true); // 50% of original
    expect(detectDeterioratingRR(1.8, 2.0)).toBe(false); // 90% of original — still fine
  });
});

describe('analyzeChase', () => {
  it('returns null with insufficient candle history', () => {
    expect(analyzeChase({ candles: timestamped(Array.from({ length: 10 }, () => candle(100))), candlesPerDay: 6 })).toBeNull();
  });

  it('is CLEAR when price is well-behaved relative to all reference levels', () => {
    // Small alternating noise so RSI isn't a degenerate 100 from a perfectly flat series.
    const candles = timestamped(Array.from({ length: 80 }, (_, i) =>
      candle(100 + (i % 2 === 0 ? 0.1 : -0.1), { high: 100.6, low: 99.4 })));
    const result = analyzeChase({ candles, candlesPerDay: 6, support: 96, currentRR: 2, originalRR: 2 })!;
    expect(result.blocked).toBe(false);
    expect(chaseLabel(result)).toBe('CLEAR');
  });

  it('blocks entry when multiple chase flags fire together', () => {
    const candles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 74; i++) { price *= 1.01; candles.push(candle(price)); } // steady climb
    // Blow-off top: big candle, huge 24h move already baked into the climb, RSI will be overextended.
    price *= 1.15;
    candles.push(candle(price, { open: price / 1.15, high: price * 1.01, low: price / 1.15 * 0.98 }));
    const ts = timestamped(candles);
    const result = analyzeChase({ candles: ts, candlesPerDay: 6, support: 90, currentRR: 0.5, originalRR: 2 })!;
    expect(result.blocked).toBe(true);
    expect(chaseLabel(result)).toBe('DO NOT CHASE');
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
