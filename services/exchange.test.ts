import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidCandle, normalizeOHLCV, fetchOHLCV, clearOHLCVCache, dropFormingCandle } from './exchange.js';
import type { Candle } from '../types/index.js';

function validCandle(overrides: Partial<Candle> = {}): Candle {
  return { timestamp: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 500, ...overrides };
}

describe('isValidCandle', () => {
  it('accepts a well-formed candle', () => {
    expect(isValidCandle(validCandle())).toBe(true);
  });

  it('rejects a candle with a NaN field', () => {
    expect(isValidCandle(validCandle({ close: NaN }))).toBe(false);
    expect(isValidCandle(validCandle({ volume: NaN }))).toBe(false);
  });

  it('rejects a candle with high below low', () => {
    expect(isValidCandle(validCandle({ high: 90, low: 99 }))).toBe(false);
  });

  it('rejects a candle where open/close fall outside the high-low range', () => {
    expect(isValidCandle(validCandle({ open: 105 }))).toBe(false); // open above high
    expect(isValidCandle(validCandle({ close: 95, low: 99 }))).toBe(false); // close below low
  });

  it('rejects negative volume', () => {
    expect(isValidCandle(validCandle({ volume: -1 }))).toBe(false);
  });
});

describe('dropFormingCandle', () => {
  it('drops the last candle when its close time has not passed yet (still forming)', () => {
    const now = Date.now();
    const candles = [
      { timestamp: now - 8 * 3_600_000, open: 100, high: 101, low: 99, close: 100.5, volume: 500 },
      { timestamp: now - 30 * 60 * 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 500 }, // opened 30min ago, 4H candle not closed yet
    ];
    const result = dropFormingCandle(candles, '4h');
    expect(result).toHaveLength(1);
  });

  it('keeps the last candle when its close time has already passed', () => {
    const now = Date.now();
    const candles = [
      { timestamp: now - 8 * 3_600_000, open: 100, high: 101, low: 99, close: 100.5, volume: 500 },
      { timestamp: now - 5 * 3_600_000, open: 100, high: 101, low: 99, close: 100.5, volume: 500 }, // opened 5h ago, well past a 4H close
    ];
    const result = dropFormingCandle(candles, '4h');
    expect(result).toHaveLength(2);
  });

  it('returns an empty array unchanged', () => {
    expect(dropFormingCandle([], '4h')).toEqual([]);
  });
});

describe('normalizeOHLCV', () => {
  it('drops malformed candles from a Bybit-shaped response instead of poisoning the series with NaN', () => {
    const raw = {
      result: {
        list: [
          ['3000', '102', '103', '101', '102.5', '400'], // valid
          ['2000', 'not-a-number', '103', '101', '102.5', '400'], // malformed -> NaN open
          ['1000', '100', '101', '99', '100.5', '500'], // valid
        ],
      },
    };
    const candles = normalizeOHLCV('bybit', raw, 250);
    expect(candles).toHaveLength(2);
    expect(candles.every(c => Number.isFinite(c.open))).toBe(true);
  });

  it('drops a candle with an impossible high/low relationship from a Gate-shaped response', () => {
    const raw = [
      { t: 1, o: 100, h: 90, l: 99, c: 100, v: 500 }, // high < low, impossible
      { t: 2, o: 100, h: 101, l: 99, c: 100.5, v: 500 }, // valid
    ];
    const candles = normalizeOHLCV('gate', raw, 250);
    expect(candles).toHaveLength(1);
  });

  it('returns candles sorted ascending by timestamp regardless of input order', () => {
    const raw = {
      data: [
        ['300', '100', '101', '99', '100.5', '500'],
        ['100', '100', '101', '99', '100.5', '500'],
        ['200', '100', '101', '99', '100.5', '500'],
      ],
    };
    const candles = normalizeOHLCV('okx', raw, 250);
    expect(candles.map(c => c.timestamp)).toEqual([100, 200, 300]);
  });
});

describe('fetchOHLCV — timeout and retry', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearOHLCVCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retries after a transient 500 and succeeds on the next attempt', async () => {
    let calls = 0;
    const goodBody = {
      result: {
        list: Array.from({ length: 250 }, (_, i) => [String(i * 1000), '100', '101', '99', '100.5', '500']),
      },
    };
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('server error', { status: 500 });
      return new Response(JSON.stringify(goodBody), { status: 200 });
    }) as unknown as typeof fetch;

    const candles = await fetchOHLCV('BTC/USDT', '4h', 'bybit', 250);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(candles.length).toBeGreaterThan(0);
  }, 10_000);

  it('does not retry a 451 geo-block — fails straight to the next exchange', async () => {
    let bybitCalls = 0;
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('exchange=bybit')) { bybitCalls++; return new Response('blocked', { status: 451 }); }
      const goodBody = { data: Array.from({ length: 250 }, (_, i) => [String(i * 1000), '100', '101', '99', '100.5', '500']) };
      return new Response(JSON.stringify(goodBody), { status: 200 });
    }) as unknown as typeof fetch;

    const candles = await fetchOHLCV('BTC/USDT', '4h', 'bybit', 250);
    expect(bybitCalls).toBe(1); // no retry on geo-block — moved straight to the next exchange
    expect(candles.length).toBeGreaterThan(0);
  }, 10_000);
});
