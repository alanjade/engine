import { log, warn } from '../utils/logger.js';
import type { Candle, ExchangeName, Ticker } from '../types/index.js';

// The OHLCV proxy exists because a browser client needs CORS relief.
// This service runs server-side (Node), so ticker lookups hit exchange
// REST APIs directly — no proxy, no staleness from reusing a 1D candle close.
const PROXY = 'https://swing.ayodejialalade29.workers.dev';

export type Timeframe = '15m' | '1h' | '4h' | '1d';

const TF_MAP: Record<ExchangeName, Record<Timeframe, string>> = {
  bybit:  { '15m': '15',    '1h': '60',   '4h': '240',    '1d': 'D' },
  okx:    { '15m': '15m',   '1h': '1H',   '4h': '4H',     '1d': '1D' },
  bitget: { '15m': '15min', '1h': '1h',   '4h': '4hour',  '1d': '1day' },
  gate:   { '15m': '15m',   '1h': '1h',   '4h': '4h',     '1d': '1d' },
};

// Minimum viable candle counts differ by timeframe — 100 4h candles is ~17
// days, but 100 15m candles is only ~1 day, which isn't enough for a
// meaningful EMA200. Require enough history relative to the longest EMA used.
const MIN_CANDLES: Record<Timeframe, number> = {
  '15m': 220,
  '1h': 220,
  '4h': 100,
  '1d': 100,
};

const EXCHANGE_ORDER: ExchangeName[] = ['bybit', 'gate', 'bitget', 'okx'];

function formatSymSlash(symbol: string, exchange: ExchangeName): string {
  if (exchange === 'okx') return symbol.replace('/', '-');
  if (exchange === 'gate') return symbol.replace('/', '_');
  return symbol.replace('/', ''); // bybit, bitget
}

class ExchangeFetchError extends Error {
  constructor(public readonly exchange: ExchangeName, message: string) {
    super(message);
    this.name = 'ExchangeFetchError';
  }
}

function classifyHttpError(status: number, body: string): Error {
  if (status === 451) return new Error('geo_blocked');
  if (status === 429) return new Error('rate_limited');
  return new Error(`HTTP ${status} — ${body.slice(0, 120)}`);
}

// ── OHLCV (via CORS proxy, unchanged behavior) ─────────────────────────────────

export async function fetchOHLCV(
  symbol: string,
  timeframe: Timeframe,
  exchange: ExchangeName | null = null,
  limit = 250,
): Promise<Candle[]> {
  const order = exchange ? [exchange, ...EXCHANGE_ORDER.filter(e => e !== exchange)] : EXCHANGE_ORDER;
  const minCandles = MIN_CANDLES[timeframe];

  let lastError: Error | undefined;

  for (const ex of order) {
    try {
      const candles = await fetchOHLCVFromExchange(symbol, timeframe, ex, limit);
      if (candles.length >= minCandles) {
        if (ex !== order[0]) log(`[${symbol}] Fallback used: ${ex}`);
        return candles;
      }
      warn(`[${symbol}] ${ex} only returned ${candles.length}/${minCandles} candles — trying next`);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const reason = err.message.includes('geo_blocked') ? 'geo-blocked'
        : err.message.includes('rate_limited') ? 'rate-limited'
        : err.message;
      warn(`[${symbol}] ${ex} failed (${reason}) — trying next`);
      lastError = new ExchangeFetchError(ex, err.message);
    }
  }

  throw lastError ?? new Error(`All exchanges failed for ${symbol} ${timeframe}`);
}

async function fetchOHLCVFromExchange(
  symbol: string,
  timeframe: Timeframe,
  exchange: ExchangeName,
  limit: number,
): Promise<Candle[]> {
  const sym = formatSymSlash(symbol, exchange);
  const tf = TF_MAP[exchange][timeframe] ?? timeframe;
  const url = `${PROXY}?exchange=${exchange}&sym=${sym}&tf=${tf}`;

  log(`Fetching ${symbol} ${timeframe} via ${exchange}`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw classifyHttpError(res.status, body);
  }

  const raw: unknown = await res.json();
  if (raw && typeof raw === 'object' && 'error' in raw) {
    const errStr = String((raw as { error: unknown }).error);
    if (errStr.includes('geo_blocked')) throw new Error('geo_blocked');
    if (errStr.includes('rate_limited')) throw new Error('rate_limited');
    throw new Error(`Exchange error: ${errStr}`);
  }

  return normalizeOHLCV(exchange, raw, limit);
}

function normalizeOHLCV(exchange: ExchangeName, raw: unknown, limit: number): Candle[] {
  let candles: Candle[];

  if (exchange === 'bybit') {
    const list = (raw as { result?: { list?: unknown[] } })?.result?.list;
    if (!list) throw new Error('Bybit: unexpected response shape');
    candles = (list as (string | number)[][])
      .map(c => ({ timestamp: +c[0]!, open: +c[1]!, high: +c[2]!, low: +c[3]!, close: +c[4]!, volume: +c[5]! }))
      .reverse();
  } else if (exchange === 'okx') {
    const data = (raw as { data?: unknown[] })?.data;
    if (!data) throw new Error('OKX: unexpected response shape');
    candles = (data as (string | number)[][])
      .map(c => ({ timestamp: +c[0]!, open: +c[1]!, high: +c[2]!, low: +c[3]!, close: +c[4]!, volume: +c[5]! }))
      .reverse();
  } else if (exchange === 'bitget') {
    const data = (raw as { data?: unknown[] })?.data;
    if (!data) throw new Error('Bitget: unexpected response shape');
    candles = (data as (string | number)[][])
      .map(c => ({ timestamp: +c[0]!, open: +c[1]!, high: +c[2]!, low: +c[3]!, close: +c[4]!, volume: +c[5]! }));
  } else if (exchange === 'gate') {
    if (!Array.isArray(raw)) throw new Error('Gate: unexpected response shape');
    candles = raw.map((c: { t: number; o: number; h: number; l: number; c: number; v: number }) => ({
      timestamp: +c.t * 1000,
      open: +c.o,
      high: +c.h,
      low: +c.l,
      close: +c.c,
      volume: +c.v,
    }));
  } else {
    throw new Error(`Unknown exchange: ${exchange satisfies never}`);
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles.slice(-limit);
}

// ── Multi-timeframe fetch with caching ─────────────────────────────────────────
//
// Reusable across the runner for any set of timeframes. Cache TTL scales with
// timeframe granularity — no reason to re-hit the proxy for 1D candles every
// 5-minute fast-scan tick.

const CACHE_TTL_MS: Record<Timeframe, number> = {
  '15m': 2 * 60 * 1000,
  '1h': 5 * 60 * 1000,
  '4h': 15 * 60 * 1000,
  '1d': 60 * 60 * 1000,
};

interface CacheEntry {
  candles: Candle[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol}:${timeframe}`;
}

/** Fetch OHLCV for one timeframe, reusing a cached result within its TTL. */
export async function fetchOHLCVCached(
  symbol: string,
  timeframe: Timeframe,
  exchange: ExchangeName | null = null,
  limit = 250,
): Promise<Candle[]> {
  const key = cacheKey(symbol, timeframe);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS[timeframe]) {
    return cached.candles;
  }

  const candles = await fetchOHLCV(symbol, timeframe, exchange, limit);
  cache.set(key, { candles, fetchedAt: Date.now() });
  return candles;
}

export type MultiTimeframeCandles = Partial<Record<Timeframe, Candle[]>>;

/**
 * Fetch several timeframes for one symbol, tolerating partial failure:
 * a timeframe that fails on every exchange is omitted from the result
 * (not thrown), so callers can decide what to do with incomplete data
 * instead of losing every timeframe because one was unavailable.
 */
export async function fetchMultiTimeframe(
  symbol: string,
  timeframes: Timeframe[],
  exchange: ExchangeName | null = null,
  limit = 250,
): Promise<MultiTimeframeCandles> {
  const result: MultiTimeframeCandles = {};

  await Promise.all(timeframes.map(async tf => {
    try {
      result[tf] = await fetchOHLCVCached(symbol, tf, exchange, limit);
    } catch (e) {
      warn(`[${symbol}] ${tf} unavailable on all exchanges: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));

  return result;
}

export function clearOHLCVCache(): void {
  cache.clear();
}

// ── Ticker (fixed: direct exchange REST calls, real current price) ────────────

async function fetchTickerFromExchange(symbol: string, exchange: ExchangeName): Promise<number> {
  switch (exchange) {
    case 'bybit': {
      const sym = formatSymSlash(symbol, exchange);
      const url = `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}`;
      const res = await fetch(url);
      if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ''));
      const json = (await res.json()) as { result?: { list?: { lastPrice?: string }[] } };
      const entry = json.result?.list?.[0];
      if (!entry?.lastPrice) throw new Error('Bybit: unexpected ticker response shape');
      return +entry.lastPrice;
    }
    case 'okx': {
      const sym = formatSymSlash(symbol, exchange);
      const url = `https://www.okx.com/api/v5/market/ticker?instId=${sym}`;
      const res = await fetch(url);
      if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ''));
      const json = (await res.json()) as { data?: { last?: string }[] };
      const entry = json.data?.[0];
      if (!entry?.last) throw new Error('OKX: unexpected ticker response shape');
      return +entry.last;
    }
    case 'bitget': {
      const sym = formatSymSlash(symbol, exchange);
      const url = `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${sym}`;
      const res = await fetch(url);
      if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ''));
      const json = (await res.json()) as { data?: { lastPr?: string }[] };
      const entry = json.data?.[0];
      if (!entry?.lastPr) throw new Error('Bitget: unexpected ticker response shape');
      return +entry.lastPr;
    }
    case 'gate': {
      const sym = formatSymSlash(symbol, exchange);
      const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${sym}`;
      const res = await fetch(url);
      if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ''));
      const json = (await res.json()) as { last?: string }[];
      const entry = json[0];
      if (!entry?.last) throw new Error('Gate: unexpected ticker response shape');
      return +entry.last;
    }
    default:
      throw new Error(`Unknown exchange: ${exchange satisfies never}`);
  }
}

export async function fetchTicker(symbol: string, exchange: ExchangeName | null = null): Promise<Ticker> {
  const order = exchange ? [exchange, ...EXCHANGE_ORDER.filter(e => e !== exchange)] : EXCHANGE_ORDER;

  let lastError: Error | undefined;
  for (const ex of order) {
    try {
      const last = await fetchTickerFromExchange(symbol, ex);
      if (ex !== order[0]) log(`[${symbol}] Ticker fallback used: ${ex}`);
      return { last };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      warn(`[${symbol}] ${ex} ticker failed (${err.message}) — trying next`);
      lastError = new ExchangeFetchError(ex, err.message);
    }
  }

  throw lastError ?? new Error(`All exchanges failed for ${symbol} ticker`);
}