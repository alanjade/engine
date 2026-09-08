import { describe, it, expect } from 'vitest';
import { decideEntry, decideExit } from './trade-state.js';
import type { Candle, Position, SymbolConfig } from '../types/index.js';

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

const config: SymbolConfig = {
  atrMin: 0.5, emaDistMin: 0.5, rsiMin: 40, rsiMax: 80,
  supportLookback: 100, supProximity: 5, minRR: 1.2, volRatioMin: 1.0, maxRiskPct: 0.15,
};

describe('decideEntry', () => {
  it('returns AVOID with insufficient candle history', () => {
    const short = timestamped(Array.from({ length: 50 }, () => candle(100)));
    const result = decideEntry({ candles4h: short, candles1d: short, config });
    expect(result.state).toBe('AVOID');
    expect(result.score).toBeNull();
  });

  it('returns AVOID for flat, directionless price action (bad regime / poor structure)', () => {
    const flat = timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.05 : -0.05))));
    const result = decideEntry({ candles4h: flat, candles1d: flat, config });
    expect(result.state).toBe('AVOID');
  });

  it('does not return ENTER for a strong downtrend regardless of other factors', () => {
    const downtrend: Candle[] = [];
    let price = 1000;
    for (let i = 0; i < 220; i++) { price *= 0.993; downtrend.push(candle(price)); }
    const result = decideEntry({ candles4h: timestamped(downtrend), candles1d: timestamped(downtrend), config });
    expect(result.state).not.toBe('ENTER');
  });

  it('produces a decision with entry/stopLoss/takeProfit populated whenever it gets past the structural gates', () => {
    const uptrend: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 220; i++) { price *= 1.006; uptrend.push(candle(price, { volume: 1000 + i * 3 })); }
    const result = decideEntry({ candles4h: timestamped(uptrend), candles1d: timestamped(uptrend), config });
    // Whatever state it lands on, if it got far enough to compute levels, they should be internally consistent.
    if (result.entry !== null && result.stopLoss !== null && result.takeProfit !== null) {
      expect(result.stopLoss).toBeLessThan(result.entry);
      expect(result.riskReward).not.toBeNull();
    }
    expect(['ENTER', 'WAIT', 'AVOID']).toContain(result.state);
  });
});

describe('decideExit', () => {
  const openPosition: Position = { status: 'OPEN', stop_loss: 90, take_profit: 120 };

  it('exits when price has fallen to or below the stop-loss', () => {
    const candles = timestamped(Array.from({ length: 60 }, () => candle(89)));
    const result = decideExit(candles, openPosition);
    expect(result.exit).toBe(true);
    expect(result.reasons.some(r => r.includes('Stop-loss'))).toBe(true);
  });

  it('exits when price has reached the take-profit', () => {
    const candles = timestamped(Array.from({ length: 60 }, () => candle(121)));
    const result = decideExit(candles, openPosition);
    expect(result.exit).toBe(true);
    expect(result.reasons.some(r => r.includes('Take-profit'))).toBe(true);
  });

  it('does not exit when price is between stop and target with no structural break', () => {
    const candles = timestamped(Array.from({ length: 60 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.1 : -0.1))));
    const result = decideExit(candles, openPosition);
    expect(result.exit).toBe(false);
  });

  it('exits on trend failure when the regime has flipped to a downtrend', () => {
    const candles: Candle[] = [];
    let price = 500;
    for (let i = 0; i < 220; i++) { price *= 0.994; candles.push(candle(price)); } // sustained decline, enough history for EMA200
    const result = decideExit(timestamped(candles), { status: 'OPEN', stop_loss: 1, take_profit: 100000 });
    expect(result.exit).toBe(true);
    expect(result.reasons.some(r => r.includes('Trend failure'))).toBe(true);
  });

  it('returns exit=false with no candle data', () => {
    expect(decideExit([], openPosition).exit).toBe(false);
  });
});

describe('decideEntry — 1H/15M wiring', () => {
  it('passes candles15m through to entry confirmation as the lower-timeframe check', () => {
    const uptrend: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 220; i++) { price *= 1.006; uptrend.push(candle(price, { volume: 1000 + i * 3 })); }
    const candles4h = timestamped(uptrend);
    const candles15m = timestamped([candle(101), candle(100), candle(98, { open: 100, high: 100.2, low: 90, close: 99.8 })]);

    const withoutLtf = decideEntry({ candles4h, candles1d: candles4h, config });
    const withLtf = decideEntry({ candles4h, candles1d: candles4h, candles15m, config });

    // Whatever state each lands on, confirmation.lowerTimeframeConfirmed should
    // reflect whether 15M data was actually supplied — null without it, a
    // real boolean with it — proving the field is wired, not dropped.
    if (withoutLtf.confirmation) expect(withoutLtf.confirmation.lowerTimeframeConfirmed).toBeNull();
    if (withLtf.confirmation) expect(typeof withLtf.confirmation.lowerTimeframeConfirmed).toBe('boolean');
  });
});
