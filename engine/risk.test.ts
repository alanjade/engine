import { describe, it, expect } from 'vitest';
import { calcStopLoss, calcPositionSize, calcTakeProfitLevels, validateMaxExposure, rejectInsufficientRR } from './risk.js';
import type { SymbolConfig } from '../types/index.js';

const cfg: SymbolConfig = {
  atrMin: 1, emaDistMin: 1, rsiMin: 50, rsiMax: 73,
  supportLookback: 80, supProximity: 3, minRR: 1.5, volRatioMin: 1.1, maxRiskPct: 0.08,
};

describe('calcStopLoss', () => {
  it('clamps to the tight bound when raw stop is closer to price than support*0.99', () => {
    // support=100, atr=0.6 -> tightBound=99, looseBound=98.8, rawStop=99.7 -> clamps to 99
    const result = calcStopLoss(105, { price: 100, count: 3 }, 0.6, cfg);
    expect(result.ok).toBe(true);
    expect(result.stopLoss).toBeCloseTo(99, 5);
  });

  it('rejects when ATR collapses/crosses the valid range (old bug case: atr too small)', () => {
    // support=100, atr=0.5 -> tightBound=99, looseBound=99 -> loose >= tight -> reject
    const result = calcStopLoss(105, { price: 100, count: 3 }, 0.5, cfg);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ATR too large/);
  });

  it('rejects when stop would land at or above entry', () => {
    // support=100, atr=0.6 -> valid range, clamped stop=99. entry=98 < stop=99 -> invalid.
    const result = calcStopLoss(98, { price: 100, count: 3 }, 0.6, cfg);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/at or above entry/);
  });

  it('rejects when stop distance exceeds maxRiskPct', () => {
    const tightCfg: SymbolConfig = { ...cfg, maxRiskPct: 0.001 };
    const result = calcStopLoss(105, { price: 100, count: 3 }, 0.6, tightCfg);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exceeds max acceptable risk/);
  });
});

describe('calcPositionSize', () => {
  it('sizes to 1% account risk', () => {
    const size = calcPositionSize(10000, 105, 99, 0.01);
    expect(size).toBeCloseTo(100 / 6, 2); // 100 / (105-99)
  });

  it('throws instead of silently returning Infinity/NaN when risk <= 0', () => {
    expect(() => calcPositionSize(10000, 100, 100)).toThrow();
    expect(() => calcPositionSize(10000, 100, 101)).toThrow();
  });
});

describe('calcTakeProfitLevels', () => {
  it('uses flat RR multiples when no resistance is supplied', () => {
    const levels = calcTakeProfitLevels(110, 100); // risk=10
    expect(levels.tp1).toBeCloseTo(120, 5); // 1R
    expect(levels.tp2).toBeCloseTo(130, 5); // 2R (no resistance to anchor to)
    expect(levels.rr1).toBeCloseTo(1, 5);
    expect(levels.rr2).toBeCloseTo(2, 5);
  });

  it('anchors TP2 to resistance when it clears 1R', () => {
    const levels = calcTakeProfitLevels(110, 100, 125); // risk=10, resistance=125 > tp1(120)
    expect(levels.tp2).toBe(125);
    expect(levels.tp3).toBeGreaterThan(levels.tp2);
  });

  it('falls back to the 2R target when resistance does not clear 1R', () => {
    const levels = calcTakeProfitLevels(110, 100, 115); // resistance below tp1(120)
    expect(levels.tp2).toBeCloseTo(130, 5); // ignores the too-close resistance
  });

  it('always orders tp1 < tp2 < tp3', () => {
    const levels = calcTakeProfitLevels(110, 100, 125);
    expect(levels.tp1).toBeLessThan(levels.tp2);
    expect(levels.tp2).toBeLessThan(levels.tp3);
  });
});

describe('validateMaxExposure', () => {
  it('allows new positions under the cap and blocks at/over it', () => {
    expect(validateMaxExposure(1, 3)).toBe(true);
    expect(validateMaxExposure(3, 3)).toBe(false);
    expect(validateMaxExposure(4, 3)).toBe(false);
  });
});

describe('rejectInsufficientRR', () => {
  it('rejects RR below the minimum and accepts RR at or above it', () => {
    expect(rejectInsufficientRR(1.2, 1.5)).toBe(true);
    expect(rejectInsufficientRR(1.5, 1.5)).toBe(false);
    expect(rejectInsufficientRR(2.0, 1.5)).toBe(false);
  });
});
