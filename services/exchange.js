import ccxt from 'ccxt';
import { log, err } from '../utils/logger.js';

const exchange = new ccxt.binance({ enableRateLimit: true });

const TIMEFRAME_MAP = { '4h': '4h', '1d': '1d' };

export async function fetchOHLCV(symbol, timeframe, limit = 250) {
  const tf = TIMEFRAME_MAP[timeframe];
  if (!tf) throw new Error(`Unknown timeframe: ${timeframe}`);
  log(`Fetching ${symbol} ${tf} x${limit}`);
  const raw = await exchange.fetchOHLCV(symbol, tf, undefined, limit);
  return raw.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp, open, high, low, close, volume,
  }));
}

export async function fetchCurrentPrice(symbol) {
  const ticker = await exchange.fetchTicker(symbol);
  return ticker.last;
}
