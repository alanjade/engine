import { describe, it, expect } from 'vitest';
import { calcRelativeVolume, detectVolumeExpansion, detectVolumeContraction, detectVolumeConfirmation, detectVolumeDivergence } from './volume.js';
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

describe('calcRelativeVolume', () => {
  it('computes current volume relative to the prior SMA (excluding current candle)', () => {
    const candles = Array.from({ length: 21 }, (_, i) => candle(100, { volume: i === 20 ? 3000 : 1000 }));
    const rv = calcRelativeVolume(timestamped(candles), 20)!;
    expect(rv).toBeCloseTo(3, 1);
  });

  it('returns null with insufficient history', () => {
    expect(calcRelativeVolume(timestamped([candle(100)]), 20)).toBeNull();
  });
});

describe('detectVolumeExpansion / detectVolumeContraction', () => {
  it('flags expansion at high relative volume and contraction at low', () => {
    const high = Array.from({ length: 21 }, (_, i) => candle(100, { volume: i === 20 ? 2000 : 1000 }));
    const low = Array.from({ length: 21 }, (_, i) => candle(100, { volume: i === 20 ? 400 : 1000 }));
    expect(detectVolumeExpansion(timestamped(high), 20)).toBe(true);
    expect(detectVolumeContraction(timestamped(low), 20)).toBe(true);
    expect(detectVolumeExpansion(timestamped(low), 20)).toBe(false);
  });
});

describe('detectVolumeConfirmation', () => {
  it('confirms when volume expands on a candle with a decisive body', () => {
    const candles = Array.from({ length: 20 }, () => candle(100, { volume: 1000 }));
    candles.push(candle(105, { open: 100, high: 105.2, low: 99.8, volume: 2500 })); // strong body, high volume
    expect(detectVolumeConfirmation(timestamped(candles), 20)).toBe(true);
  });

  it('does not confirm a doji on high volume', () => {
    const candles = Array.from({ length: 20 }, () => candle(100, { volume: 1000 }));
    candles.push(candle(100.05, { open: 100, high: 102, low: 98, volume: 2500 })); // tiny body, wide range
    expect(detectVolumeConfirmation(timestamped(candles), 20)).toBe(false);
  });
});

describe('detectVolumeDivergence', () => {
  it('flags a new price extreme made on below-average volume', () => {
    const candles = Array.from({ length: 30 }, (_, i) => candle(100 + i * 0.1, { high: 100 + i * 0.1 + 0.5, low: 100 + i * 0.1 - 0.5, volume: 1000 }));
    // Final candle makes a new high but on weak volume.
    const last = candles[candles.length - 1]!;
    candles[candles.length - 1] = { ...last, high: last.high + 1, volume: 300 };
    expect(detectVolumeDivergence(timestamped(candles))).toBe(true);
  });

  it('does not flag when the new extreme has strong volume', () => {
    const candles = Array.from({ length: 30 }, (_, i) => candle(100 + i * 0.1, { high: 100 + i * 0.1 + 0.5, low: 100 + i * 0.1 - 0.5, volume: 1000 }));
    const last = candles[candles.length - 1]!;
    candles[candles.length - 1] = { ...last, high: last.high + 1, volume: 2500 };
    expect(detectVolumeDivergence(timestamped(candles))).toBe(false);
  });
});
