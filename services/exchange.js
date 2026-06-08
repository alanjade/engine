import { log } from '../utils/logger.js';

const PROXY = 'https://terminal.ayodejialalade29.workers.dev';

const TF_MAP = {
  binance: { '4h': '4h',  '1d': '1d' },
  bybit:   { '4h': '240', '1d': 'D'  },
  okx:     { '4h': '4H',  '1d': '1D' },
};

export async function fetchOHLCV(symbol, timeframe, exchange = 'bybit', limit = 250) {
  const sym = symbol.replace('/', '');
  const tf  = TF_MAP[exchange]?.[timeframe] ?? timeframe;
  const url = `${PROXY}?exchange=${exchange}&sym=${sym}&tf=${tf}`;

  log(`Fetching ${symbol} ${timeframe} x${limit} via ${exchange} proxy`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Proxy ${res.status} for ${symbol} ${timeframe} — ${body.slice(0, 200)}`);
  }

  const raw = await res.json();
  return normalize(exchange, raw, limit);
}

function normalize(exchange, raw, limit) {
  let candles;

  if (exchange === 'binance') {
    candles = raw.map(c => ({
      timestamp: +c[0],
      open:   +c[1],
      high:   +c[2],
      low:    +c[3],
      close:  +c[4],
      volume: +c[5],
    }));

  } else if (exchange === 'bybit') {
    candles = raw.result.list
      .map(c => ({
        timestamp: +c[0],
        open:   +c[1],
        high:   +c[2],
        low:    +c[3],
        close:  +c[4],
        volume: +c[5],
      }))
      .reverse();

  } else if (exchange === 'okx') {
    candles = raw.data
      .map(c => ({
        timestamp: +c[0],
        open:   +c[1],
        high:   +c[2],
        low:    +c[3],
        close:  +c[4],
        volume: +c[5],
      }))
      .reverse();
  }

  return candles.slice(-limit);
}

export async function fetchTicker(symbol, exchange = 'bybit') {
  const candles = await fetchOHLCV(symbol, '1d', exchange, 1);
  return { last: candles.at(-1).close };
}