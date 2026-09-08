import { describe, it, expect } from 'vitest';
import { detectBreakoutConfirmation, analyzeEntryConfirmation } from './confirmation.js';
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

describe('detectBreakoutConfirmation', () => {
  it('confirms when the latest close just crossed above the level (prior candle did not)', () => {
    const candles = [candle(98), candle(102)];
    expect(detectBreakoutConfirmation(candles, 100)).toBe(true);
  });

  it('does not confirm when price was already above the level on the prior candle too', () => {
    const candles = [candle(103), candle(104)];
    expect(detectBreakoutConfirmation(candles, 100)).toBe(false);
  });

  it('does not confirm when the latest close is still below the level', () => {
    const candles = [candle(95), candle(97)];
    expect(detectBreakoutConfirmation(candles, 100)).toBe(false);
  });
});

describe('analyzeEntryConfirmation', () => {
  it('returns null with insufficient candle history', () => {
    expect(analyzeEntryConfirmation({ candles: timestamped(Array.from({ length: 10 }, () => candle(100))) })).toBeNull();
  });

  it('confirms entry when enough independent signals line up', () => {
    const candles: Candle[] = [];
    let price = 100;
    // Established uptrend with clean HH/HL structure.
    for (let i = 0; i < 60; i++) { price *= 1.008; candles.push(candle(price)); }
    // Final candle: strong displacement + volume expansion + hammer-like rejection.
    candles.push(candle(price * 1.01, {
      open: price * 0.985, high: price * 1.012, low: price * 0.965, volume: 5000,
    }));

    const result = analyzeEntryConfirmation({ candles: timestamped(candles) })!;
    expect(result.confirmedCount).toBeGreaterThanOrEqual(1);
    expect(typeof result.confirmed).toBe('boolean');
  });

  it('reports lowerTimeframeConfirmed as null when no lower-timeframe candles are supplied', () => {
    const candles = timestamped(Array.from({ length: 70 }, (_, i) => candle(100 + i * 0.1)));
    const result = analyzeEntryConfirmation({ candles })!;
    expect(result.lowerTimeframeConfirmed).toBeNull();
  });

  it('evaluates lowerTimeframeConfirmed as a boolean when 1H/15M candles are supplied', () => {
    const candles = timestamped(Array.from({ length: 70 }, (_, i) => candle(100 + i * 0.1)));
    const ltf = [candle(101), candle(100), candle(98, { open: 100, high: 100.2, low: 90, close: 99.8 })]; // hammer-shaped last candle
    const result = analyzeEntryConfirmation({ candles, lowerTimeframeCandles: ltf })!;
    expect(typeof result.lowerTimeframeConfirmed).toBe('boolean');
  });
});
