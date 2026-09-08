import { describe, it, expect } from 'vitest';
import { findSwingPoints, analyzeStructure } from './structure.js';
import type { Candle } from '../types/index.js';

/** Builds candles from a sequence of turning-point prices, interpolating between them. */
function fromTurningPoints(points: number[], candlesPerLeg = 4): Candle[] {
  const candles: Candle[] = [];
  let idx = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!, to = points[i + 1]!;
    for (let j = 0; j < candlesPerLeg; j++) {
      const t = j / candlesPerLeg;
      const close = from + (to - from) * t;
      const open = idx === 0 ? close : candles[candles.length - 1]!.close;
      candles.push({
        timestamp: idx * 3_600_000,
        open,
        close,
        // Wicks derived from close only (not open) so a turning-point candle
        // is a strict local extreme even though its open equals the
        // previous candle's close.
        high: close * 1.002,
        low: close * 0.998,
        volume: 1000,
      });
      idx++;
    }
  }
  return candles;
}

describe('findSwingPoints', () => {
  it('labels an uptrend sequence as alternating HL/HH', () => {
    // low, high, higher-low, higher-high, higher-low, higher-high
    const candles = fromTurningPoints([100, 120, 108, 130, 115, 140], 5);
    const swings = findSwingPoints(candles, 2);
    const labels = swings.map(s => s.label);
    expect(labels).toContain('HH');
    expect(labels).toContain('HL');
    expect(labels).not.toContain('LL');
    expect(labels).not.toContain('LH');
  });

  it('labels a downtrend sequence as alternating LH/LL (first swing of each kind has no prior reference)', () => {
    const candles = fromTurningPoints([140, 115, 130, 108, 120, 100], 5);
    const swings = findSwingPoints(candles, 2);
    const labels = swings.map(s => s.label);
    // First high/low of each kind default ambiguous (no prior reference) — only later swings are meaningful.
    expect(labels.slice(-2)).toEqual(['LL', 'LH']);
  });
});

describe('analyzeStructure', () => {
  it('returns UNDEFINED bias with too little swing data', () => {
    const candles = fromTurningPoints([100, 110], 5);
    const result = analyzeStructure(candles);
    expect(result.bias).toBe('UNDEFINED');
    expect(result.qualityScore).toBe(0);
  });

  it('reads BULLISH bias from a clean HH/HL sequence and sets invalidation at the last HL', () => {
    const candles = fromTurningPoints([100, 120, 108, 130, 116, 145], 5);
    const result = analyzeStructure(candles);
    expect(result.bias).toBe('BULLISH');
    expect(result.invalidationLevel).toBeCloseTo(116, 0);
    expect(result.qualityScore).toBeGreaterThan(0);
  });

  it('reads BEARISH bias from a clean LH/LL sequence and sets invalidation at the last LH', () => {
    const candles = fromTurningPoints([140, 115, 130, 108, 122, 95], 5);
    const result = analyzeStructure(candles);
    expect(result.bias).toBe('BEARISH');
    expect(result.invalidationLevel).toBeCloseTo(122, 0);
  });

  it('detects a BULLISH_CHOCH when price breaks the last swing high during a bearish structure', () => {
    // Bearish structure (140,115,130,108,122,95) then a strong push back above 130 (last LH before 122/95)
    const bearish = fromTurningPoints([140, 115, 130, 108, 122, 95], 5);
    const reversal = fromTurningPoints([95, 150], 6).map((c, i) => ({ ...c, timestamp: (bearish.length + i) * 3_600_000 }));
    const candles = [...bearish, ...reversal];
    const result = analyzeStructure(candles);
    expect(result.lastEvent).toBe('BULLISH_CHOCH');
  });

  it('detects a BULLISH_BOS on continuation beyond the last swing high in a bullish structure', () => {
    const bullish = fromTurningPoints([100, 120, 108, 130, 116, 135], 5);
    const continuation = fromTurningPoints([135, 160], 6).map((c, i) => ({ ...c, timestamp: (bullish.length + i) * 3_600_000 }));
    const candles = [...bullish, ...continuation];
    const result = analyzeStructure(candles);
    expect(result.lastEvent).toBe('BULLISH_BOS');
  });
});
