import { log } from '../utils/logger.js';

const PROXY = 'https://terminal.ayodejialalade29.workers.dev';

// Timeframe mapping: ccxt-style → exchange native
const TF_MAP = {
  binance: { '4h': '4h', '1d': '1d' },
  bybit:   { '4h': '240', '1d': 'D' },
  okx:     { '4h': '4H', '1d': '1D' },
};

/**
 * Fetch OHLCV via the Cloudflare proxy.
 * Returns array of [timestamp, open, high, low, close, volume] — same shape ccxt uses.
 */
export async function fetchOHLCV(symbol, timeframe, exchange = 'binance', limit = 250) {
  const sym = symbol.replace('/', '');          // BTC/USDT → BTCUSDT
  const tf  = TF_MAP[exchange]?.[timeframe] ?? timeframe;

  const url = `${PROXY}?exchange=${exchange}&sym=${sym}&tf=${tf}`;
  log(`Fetching ${symbol} ${timeframe} x${limit} via ${exchange} proxy`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Proxy ${res.status} for ${symbol} ${timeframe}`);

  const raw = await res.json();
  return normalize(exchange, raw, limit);
}

function normalize(exchange, raw, limit) {
  let candles;

  if (exchange === 'binance') {
    // [[openTime, o, h, l, c, v, ...], ...]
    candles = raw.map(c => [+c[0], +c[1], +c[2], +c[3], +c[4], +c[5]]);

  } else if (exchange === 'bybit') {
    // { result: { list: [[time, o, h, l, c, v], ...] } } — newest first
    candles = raw.result.list
      .map(c => [+c[0], +c[1], +c[2], +c[3], +c[4], +c[5]])
      .reverse();

  } else if (exchange === 'okx') {
    // { data: [[ts, o, h, l, c, vol, ...], ...] } — newest first
    candles = raw.data
      .map(c => [+c[0], +c[1], +c[2], +c[3], +c[4], +c[5]])
      .reverse();
  }

  // Trim to requested limit (proxy fetches 500, engine wants 250)
  return candles.slice(-limit);
}

/**
 * Fetch current ticker price (last traded price).
 * Falls back gracefully — just reads close of latest candle if ticker not needed.
 */
export async function fetchTicker(symbol, exchange = 'binance') {
  // Reuse OHLCV — last candle close is close enough for signal logic
  const candles = await fetchOHLCV(symbol, '1d', exchange, 1);
  return { last: candles.at(-1)[4] };
}