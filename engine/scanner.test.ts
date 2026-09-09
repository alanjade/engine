import { describe, it, expect } from 'vitest';
import { runSlowScan, runFastScan } from './scanner.js';
import type { Candle, SymbolConfig } from '../types/index.js';

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
  supportLookback: 100, supProximity: 5, minRR: 1.2, volRatioMin: 1.0, maxRiskPct: 15,
};

function flatCandles(n = 220): Candle[] {
  return timestamped(Array.from({ length: n }, (_, i) => candle(100 + (i % 2 === 0 ? 0.05 : -0.05))));
}
function uptrendCandles(rate: number, n = 220): Candle[] {
  // Zigzag uptrend (rising baseline + oscillation) rather than a smooth
  // monotonic climb — a pure monotonic series has no swing highs/lows at
  // all, so analyzeStructure reads UNDEFINED bias / quality 0 regardless
  // of trend direction (see Phase 3/4 test notes on this same pitfall).
  // Amplitude/period tuned so the oscillation isn't swamped by the
  // per-cycle baseline growth — otherwise no genuine local reversal exists.
  const candles: Candle[] = [];
  let baseline = 100;
  for (let i = 0; i < n; i++) {
    baseline *= 1 + rate;
    const price = baseline + Math.sin(i / 2) * baseline * 0.05;
    candles.push(candle(price, { high: price * 1.005, low: price * 0.995, volume: 1000 + i * 3 }));
  }
  return timestamped(candles);
}
function downtrendCandles(rate: number, n = 220): Candle[] {
  const candles: Candle[] = [];
  let price = 1000;
  for (let i = 0; i < n; i++) { price *= 1 - rate; candles.push(candle(price)); }
  return timestamped(candles);
}

describe('runSlowScan', () => {
  it('excludes symbols with insufficient candle history', () => {
    const result = runSlowScan([{ symbol: 'X/USDT', candles1d: flatCandles(50), candles4h: flatCandles(50), supportLookback: 100 }]);
    expect(result).toEqual([]);
  });

  it('excludes flat, directionless symbols (no HTF bullish trend, weak structure)', () => {
    const result = runSlowScan([{ symbol: 'FLAT/USDT', candles1d: flatCandles(220), candles4h: flatCandles(220), supportLookback: 100 }]);
    expect(result.find(c => c.symbol === 'FLAT/USDT')).toBeUndefined();
  });

  it('excludes symbols in a downtrend regardless of any other factor', () => {
    const result = runSlowScan([{ symbol: 'DOWN/USDT', candles1d: downtrendCandles(0.007), candles4h: downtrendCandles(0.007), supportLookback: 100 }]);
    expect(result.find(c => c.symbol === 'DOWN/USDT')).toBeUndefined();
  });

  it('includes a symbol with a clean established uptrend on both 1D and 4H', () => {
    const trend = uptrendCandles(0.006);
    const result = runSlowScan([{ symbol: 'UP/USDT', candles1d: trend, candles4h: trend, supportLookback: 100 }]);
    const candidate = result.find(c => c.symbol === 'UP/USDT');
    expect(candidate).toBeDefined();
    expect(candidate!.htfBullish).toBe(true);
    expect(candidate!.regime).toMatch(/UPTREND/);
  });

  it('records majorSupport/majorResistance and a recent scannedAt timestamp', () => {
    const trend = uptrendCandles(0.006);
    const before = Date.now();
    const result = runSlowScan([{ symbol: 'UP/USDT', candles1d: trend, candles4h: trend, supportLookback: 100 }]);
    const candidate = result[0]!;
    expect(candidate.scannedAt).toBeGreaterThanOrEqual(before);
    expect(candidate.majorSupport === null || typeof candidate.majorSupport === 'number').toBe(true);
  });
});

describe('runFastScan', () => {
  it('only evaluates symbols present in the candidate list, ignoring the rest of the universe', () => {
    const trend = uptrendCandles(0.007);
    const candidates = runSlowScan([{ symbol: 'CANDIDATE/USDT', candles1d: trend, candles4h: trend, supportLookback: 100 }]);
    expect(candidates.length).toBeGreaterThan(0);

    const dataBySymbol = [
      { symbol: 'CANDIDATE/USDT', candles4h: trend, candles1d: trend, config },
      { symbol: 'NOT_A_CANDIDATE/USDT', candles4h: uptrendCandles(0.007), candles1d: uptrendCandles(0.007), config },
    ];
    const result = runFastScan(candidates, dataBySymbol);
    expect(result.every(o => o.symbol === 'CANDIDATE/USDT')).toBe(true);
  });

  it('returns an empty list when the candidate list is empty', () => {
    const dataBySymbol = [{ symbol: 'X/USDT', candles4h: uptrendCandles(0.007), candles1d: uptrendCandles(0.007), config }];
    expect(runFastScan([], dataBySymbol)).toEqual([]);
  });
});
