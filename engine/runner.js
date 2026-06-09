import { fetchOHLCV } from '../services/exchange.js';
import { sendAlert, formatBuyAlert, formatSellAlert, formatHoldAlert } from '../services/telegram.js';
import {
  saveSignal, isDuplicate,
  getPosition, upsertPosition, countOpenPositions,
} from '../services/store.js';
import { evaluate } from './signal.js';
import { log, warn } from '../utils/logger.js';

const SYMBOLS = [
  'BTC/USDT',
  'ETH/USDT',
  'BNB/USDT',
  'XRP/USDT',
  'DOGE/USDT',
  'ADA/USDT',
  'AVAX/USDT',
  'TON/USDT',
  'NEAR/USDT',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runAll() {
  log('=== Scan started ===');
  for (const symbol of SYMBOLS) {
    try {
      const openCount = await countOpenPositions();
      await runSymbol(symbol, openCount);
    } catch (e) {
      warn(`[${symbol}] Error: ${e.message}`);
    }
    await sleep(2500);
  }
  log('=== Scan complete ===');
}

async function runSymbol(symbol, openPositionCount) {
  log(`[${symbol}] Evaluating...`);

  let candles4h, candles1d;

  try {
    candles4h = await fetchOHLCV(symbol, '4h', null, 250);
  } catch (e) {
    warn(`[${symbol}] 4h fetch failed on all exchanges: ${e.message}`);
    return;
  }

  try {
    candles1d = await fetchOHLCV(symbol, '1d', null, 250);
  } catch (e) {
    warn(`[${symbol}] 1d fetch failed on all exchanges: ${e.message}`);
    return;
  }

  const position = await getPosition(symbol);
  const result   = evaluate({ symbol, candles4h, candles1d, position, openPositionCount });

  log(`[${symbol}] Signal: ${result.signal} — ${result.reason}`);

  if (result.signal === 'NONE') return;

  if (result.signal === 'BUY') {
    if (await isDuplicate(symbol, 'BUY', result.support)) {
      warn(`[${symbol}] Duplicate BUY suppressed.`);
      return;
    }
    await saveSignal(result);
    await upsertPosition({
      symbol,
      status:      'OPEN',
      entry:       result.entry,
      stop_loss:   result.stop_loss,
      take_profit: result.take_profit,
      size:        result.position_size,
      remaining:   100,
    });
    await sendAlert(formatBuyAlert(result));
  }

  if (result.signal === 'SELL') {
    await saveSignal(result);
    await upsertPosition({
      symbol,
      status:      'CLOSED',
      entry:       position.entry,
      stop_loss:   null,
      take_profit: null,
      size:        position.size,
      remaining:   0,
    });
    await sendAlert(formatSellAlert(result));
  }

  if (result.signal === 'HOLD') {
    await sendAlert(formatHoldAlert(result));
  }
}