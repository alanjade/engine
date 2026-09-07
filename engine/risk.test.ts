import { describe, it, expect } from 'vitest';
import { calcStopLoss, calcPositionSize } from './risk.js';
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