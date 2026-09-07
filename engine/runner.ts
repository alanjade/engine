import { fetchMultiTimeframe } from '../services/exchange.js';
import { sendAlert, formatBuyAlert, formatSellAlert, formatHoldAlert } from '../services/telegram.js';
import { saveSignal, isDuplicate, getPosition, upsertPosition, countOpenPositions } from '../services/store.js';
import { evaluate } from './signal.js';
import { log, warn } from '../utils/logger.js';
import type { Position } from '../types/index.js';

const SYMBOLS = [
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT',
  'ADA/USDT', 'AVAX/USDT', 'GRAM/USDT', 'NEAR/USDT',
];

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export async function runAll(): Promise<void> {
  log('=== Scan started ===');
  for (const symbol of SYMBOLS) {
    try {
      await runSymbol(symbol, await countOpenPositions());
    } catch (error) {
      warn(`[${symbol}] Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(2500);
  }
  log('=== Scan complete ===');
}

async function runSymbol(symbol: string, openPositionCount: number): Promise<void> {
  log(`[${symbol}] Evaluating...`);

  // Pulls all four timeframes now so Phase 3+ (regime/structure/setup logic)
  // has 1H/15M available without touching the fetch layer again. Scoring
  // still only consumes 4h/1d until that logic lands.
  const tf = await fetchMultiTimeframe(symbol, ['1d', '4h', '1h', '15m'], null, 250);

  if (!tf['4h'] || !tf['1d']) {
    warn(`[${symbol}] Missing required timeframe (4h: ${!!tf['4h']}, 1d: ${!!tf['1d']}) — skipping.`);
    return;
  }
  if (!tf['1h'] || !tf['15m']) {
    warn(`[${symbol}] 1h/15m unavailable this cycle — proceeding on 4h/1d only.`);
  }

  const candles4h = tf['4h'];
  const candles1d = tf['1d'];

  const storedPosition = await getPosition(symbol);
  const position: Position = {
    status: storedPosition.status,
    stop_loss: storedPosition.stop_loss ?? 0,
    take_profit: storedPosition.take_profit ?? 0,
    remaining: storedPosition.remaining,
    resistance: storedPosition.resistance,
  };
  const result = evaluate({ symbol, candles4h, candles1d, position, openPositionCount });
  log(`[${symbol}] Signal: ${result.signal} — ${result.reason}`);

  if (result.signal === 'NONE') return;
  if (result.signal === 'BUY') {
    if (await isDuplicate(symbol, 'BUY', result.support)) {
      warn(`[${symbol}] Duplicate BUY suppressed.`);
      return;
    }
    await saveSignal(result);
    await upsertPosition({
      symbol, status: 'OPEN', entry: result.entry, stop_loss: result.stop_loss,
      take_profit: result.take_profit, size: result.position_size, remaining: 100,
    });
    await sendAlert(formatBuyAlert(result));
    return;
  }
  if (result.signal === 'SELL') {
    await saveSignal(result);
    await upsertPosition({
      symbol, status: 'CLOSED', entry: storedPosition.entry, stop_loss: null,
      take_profit: null, size: storedPosition.size, remaining: 0,
    });
    await sendAlert(formatSellAlert(result));
    return;
  }
  await sendAlert(formatHoldAlert(result));
}
