import { log, warn } from '../utils/logger.js';

const PROXY = 'https://swing.ayodejialalade29.workers.dev';

const TF_MAP = {
  okx:   { '4h': '4H', '1d': '1D' },
  bybit: { '4h': '240', '1d': 'D' },
};

const EXCHANGE_ORDER = ['okx', 'bybit'];
const MIN_CANDLES    = 100;

export async function fetchOHLCV(symbol, timeframe, exchange = null, limit = 250) {
  const order = exchange
    ? [exchange, ...EXCHANGE_ORDER.filter(e => e !== exchange)]
    : EXCHANGE_ORDER;

  let lastError;

  for (const ex of order) {
    try {
      const candles = await fetchFromExchange(symbol, timeframe, ex, limit);
      if (candles.length >= MIN_CANDLES) {
        if (ex !== order[0]) log(`[${symbol}] Fallback used: ${ex}`);
        return candles;
      }
      warn(`[${symbol}] ${ex} only returned ${candles.length} candles — trying next`);
    } catch (e) {
      const reason = e.message.includes('geo_blocked') ? 'geo-blocked'
                   : e.message.includes('rate_limited') ? 'rate-limited'
                   : e.message;
      warn(`[${symbol}] ${ex} failed (${reason}) — trying next`);
      lastError = e;
    }
  }

  throw lastError ?? new Error(`All exchanges failed for ${symbol} ${timeframe}`);
}

async function fetchFromExchange(symbol, timeframe, exchange, limit) {
  const sym = exchange === 'okx'
    ? symbol.replace('/', '-')
    : symbol.replace('/', '');

  const tf  = TF_MAP[exchange]?.[timeframe] ?? timeframe;
  const url = `${PROXY}?exchange=${exchange}&sym=${sym}&tf=${tf}`;

  log(`Fetching ${symbol} ${timeframe} via ${exchange}`);

  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 451) throw new Error('geo_blocked');
    if (res.status === 429) throw new Error('rate_limited');
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 120)}`);
  }

  const raw = await res.json();

  if (raw?.error) {
    if (String(raw.error).includes('geo_blocked')) throw new Error('geo_blocked');
    if (String(raw.error).includes('rate_limited')) throw new Error('rate_limited');
    throw new Error(`Exchange error: ${raw.error}`);
  }

  return normalize(exchange, raw, limit);
}

function normalize(exchange, raw, limit) {
  let candles;

  if (exchange === 'okx') {
    if (!raw?.data) throw new Error('OKX: unexpected response shape');
    candles = raw.data
      .map(c => ({
        timestamp: +c[0],
        open:      +c[1],
        high:      +c[2],
        low:       +c[3],
        close:     +c[4],
        volume:    +c[5],
      }))
      .reverse();

  } else if (exchange === 'bybit') {
    if (!raw?.result?.list) throw new Error('Bybit: unexpected response shape');
    candles = raw.result.list
      .map(c => ({
        timestamp: +c[0],
        open:      +c[1],
        high:      +c[2],
        low:       +c[3],
        close:     +c[4],
        volume:    +c[5],
      }))
      .reverse();

  } else {
    throw new Error(`Unknown exchange: ${exchange}`);
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles.slice(-limit);
}

export async function fetchTicker(symbol, exchange = null) {
  const candles = await fetchOHLCV(symbol, '1d', exchange, 1);
  return { last: candles.at(-1).close };
}