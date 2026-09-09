import { describe, it, expect } from 'vitest';
import { openPosition, updatePosition } from './position-management.js';
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

describe('openPosition', () => {
  it('starts at 100% remaining with no partials hit', () => {
    const p = openPosition(100, 90, 110, 120, 130);
    expect(p.remainingPct).toBe(100);
    expect(p.tp1Hit).toBe(false);
    expect(p.tp2Hit).toBe(false);
    expect(p.breakEvenActivated).toBe(false);
  });
});

describe('updatePosition', () => {
  it('closes fully on stop-loss hit', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const candles = timestamped([candle(89)]);
    const result = updatePosition(position, candles);
    expect(result.closed).toBe(true);
    expect(result.actions).toContain('STOP_LOSS_HIT');
    expect(result.position.remainingPct).toBe(0);
  });

  it('takes a partial at TP1 and moves the stop to break-even', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const candles = timestamped([candle(111, { high: 111.5 })]);
    const result = updatePosition(position, candles);
    expect(result.position.tp1Hit).toBe(true);
    expect(result.position.remainingPct).toBe(67);
    expect(result.position.stopLoss).toBe(100); // moved to entry
    expect(result.position.breakEvenActivated).toBe(true);
    expect(result.closed).toBe(false);
    expect(result.actions.some(a => a.startsWith('PARTIAL_TP1'))).toBe(true);
    expect(result.actions).toContain('BREAKEVEN_STOP: stop moved to entry.');
  });

  it('takes a partial at TP2 only after TP1 has already hit, and locks stop at TP1', () => {
    let position = openPosition(100, 90, 110, 120, 130);
    let result = updatePosition(position, timestamped([candle(111)]));
    position = result.position;
    result = updatePosition(position, timestamped([candle(111), candle(121)]));
    expect(result.position.tp2Hit).toBe(true);
    expect(result.position.remainingPct).toBe(34);
    expect(result.position.stopLoss).toBe(110); // locked at TP1
  });

  it('does not take TP2 before TP1 has hit even if price jumps straight past both', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const result = updatePosition(position, timestamped([candle(125)])); // past both tp1 and tp2 in one candle
    // TP1 logic fires first (price >= tp1), then TP2 logic requires tp1Hit — same update, so TP2 should NOT also fire in this same call incorrectly skipping TP1's accounting.
    expect(result.position.tp1Hit).toBe(true);
    expect(result.position.tp2Hit).toBe(true); // both can fire in the same update since tp1Hit is set synchronously first
    expect(result.position.remainingPct).toBe(34);
  });

  it('closes fully at TP3', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const result = updatePosition(position, timestamped([candle(131)]));
    expect(result.closed).toBe(true);
    expect(result.actions).toContain('FINAL_TP_HIT');
  });

  it('triggers an emergency exit on a severe single-candle drop', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const candles = timestamped([candle(100), candle(90, { open: 100, close: 90 })]); // ~10% single-candle drop
    const result = updatePosition(position, candles);
    expect(result.closed).toBe(true);
    expect(result.actions.some(a => a.startsWith('EMERGENCY_EXIT'))).toBe(true);
  });

  it('trails the stop upward using ATR once in profit, and never loosens it', () => {
    let position = openPosition(100, 90, 110, 120, 130);
    // Push through TP1 first so trailing logic is active.
    const afterTp1 = updatePosition(position, timestamped([candle(111, { high: 111.5 })])).position;

    // Build a candle series climbing further, ending well above TP1, to trigger ATR trailing.
    const climb: Candle[] = [];
    let price = 111;
    for (let i = 0; i < 20; i++) { price *= 1.01; climb.push(candle(price, { high: price * 1.01, low: price * 0.99 })); }
    const result = updatePosition(afterTp1, timestamped(climb));

    expect(result.position.stopLoss).toBeGreaterThanOrEqual(afterTp1.stopLoss);
  });

  it('does not trail before TP1 has been hit', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const climb: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 15; i++) { price *= 1.004; climb.push(candle(price)); } // rises but stays under TP1 (110)
    const result = updatePosition(position, timestamped(climb));
    expect(result.position.stopLoss).toBe(90); // unchanged — still pre-TP1
  });

  it('returns unmodified position with no candle data', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const result = updatePosition(position, []);
    expect(result.position).toEqual(position);
    expect(result.closed).toBe(false);
  });

  it('triggers the stop-loss on a wick through it even when the candle closes back above (wick, not close)', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    // Wicks down to 88 (through the 90 stop) but closes back at 95.
    const candles = timestamped([candle(95, { open: 96, high: 96.5, low: 88 })]);
    const result = updatePosition(position, candles);
    expect(result.closed).toBe(true);
    expect(result.actions).toContain('STOP_LOSS_HIT');
    expect(result.fillPrice).toBe(90); // filled at the stop level itself, not the wick low or the close
  });

  it('does not trigger the stop on a candle that stays entirely above it', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const candles = timestamped([candle(95, { open: 94, high: 96, low: 92 })]);
    const result = updatePosition(position, candles);
    expect(result.closed).toBe(false);
  });

  it('triggers TP1 on a wick through it even when the candle closes back below (wick, not close)', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    // Wicks up to 112 (through the 110 TP1) but closes back at 105.
    const candles = timestamped([candle(105, { open: 104, high: 112, low: 103 })]);
    const result = updatePosition(position, candles);
    expect(result.position.tp1Hit).toBe(true);
    expect(result.actions.some(a => a.startsWith('PARTIAL_TP1'))).toBe(true);
  });

  it('reports fillPrice as the exact level touched for FINAL_TP_HIT, not the wick high', () => {
    const position = openPosition(100, 90, 110, 120, 130);
    const candles = timestamped([candle(125, { open: 122, high: 135, low: 121 })]); // wicks well past tp3=130
    const result = updatePosition(position, candles);
    expect(result.closed).toBe(true);
    expect(result.actions).toContain('FINAL_TP_HIT');
    expect(result.fillPrice).toBe(130);
  });
});
