import { log, warn } from '../utils/logger.js';

const PROXY = 'https://swing.ayodejialalade29.workers.dev';

// Timeframe mappings per exchange
const TF_MAP = {
  bybit:  { '4h': '240',   '1d': 'D'    },
  okx:    { '4h': '4H',    '1d': '1D'   },
  bitget: { '4h': '4hour', '1d': '1day' },
  gate:   { '4h': '4h',    '1d': '1d'   },
};

function formatSym(symbol, exchange) {
  if (exchange === 'okx')   return symbol.replace('/', '-');
  if (exchange === 'gate')  return symbol.replace('/', '_');
  return symbol.replace('/', ''); // bybit, bitget
}

const EXCHANGE_ORDER = ['bybit', 'gate', 'bitget', 'okx'];

const MIN_CANDLES = 100;

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
  const sym = formatSym(symbol, exchange);
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

  if (exchange === 'bybit') {
    // { result: { list: [[ts, o, h, l, c, v], ...] } } — newest first
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

  } else if (exchange === 'okx') {
    // { data: [[ts, o, h, l, c, vol, ...], ...] } — newest first
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

  } else if (exchange === 'bitget') {
    // { data: [[ts, o, h, l, c, v], ...] } — oldest first
    if (!raw?.data) throw new Error('Bitget: unexpected response shape');
    candles = raw.data
      .map(c => ({
        timestamp: +c[0],
        open:      +c[1],
        high:      +c[2],
        low:       +c[3],
        close:     +c[4],
        volume:    +c[5],
      }));

  } else if (exchange === 'gate') {
    // Array of objects: [{ t, o, h, l, c, v }, ...] — oldest first
    if (!Array.isArray(raw)) throw new Error('Gate: unexpected response shape');
    candles = raw.map(c => ({
      timestamp: +c.t * 1000, // Gate returns seconds, convert to ms
      open:      +c.o,
      high:      +c.h,
      low:       +c.l,
      close:     +c.c,
      volume:    +c.v,
    }));

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