import { fetchMultiTimeframe } from '../services/exchange.js';
import {
  sendAlert, formatEnterAlert, formatWaitAlert, formatExitAlert, formatPositionUpdateAlert,
} from '../services/telegram.js';
import {
  getPosition, upsertPosition, countOpenPositions, isDuplicate, saveDecision,
} from '../services/store.js';
import { decideEntry, decideExit } from './trade-state.js';
import { openPosition, updatePosition } from './position-management.js';
import { calcPositionSize, validateMaxExposure } from './risk.js';
import { cfg } from './config.js';
import { ENV } from '../utils/env.js';
import { log, warn } from '../utils/logger.js';
import type { ManagedPosition, StoredPosition } from '../types/index.js';

const SYMBOLS = [
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT',
  'ADA/USDT', 'AVAX/USDT', 'GRAM/USDT', 'NEAR/USDT',
];

const MAX_OPEN_POSITIONS = 2;

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

/**
 * Rebuilds a ManagedPosition from what's in the store. Degrades gracefully
 * for rows written before tp1/tp2/tp3 were persisted (or opened by the old
 * legacy pipeline): those collapse to a single-target position (tp1=tp2=tp3)
 * so partials just never fire rather than throwing, instead of assuming a
 * shape that isn't there.
 */
function reconstructManagedPosition(stored: StoredPosition): ManagedPosition {
  const entry = stored.entry ?? 0;
  const finalTarget = stored.take_profit ?? entry;
  return {
    entry,
    stopLoss: stored.stop_loss ?? 0,
    tp1: stored.tp1 ?? finalTarget,
    tp2: stored.tp2 ?? finalTarget,
    tp3: stored.tp3 ?? finalTarget,
    remainingPct: stored.remaining ?? 100,
    highestPrice: stored.highest_price ?? entry,
    tp1Hit: stored.tp1_hit ?? false,
    tp2Hit: stored.tp2_hit ?? false,
    breakEvenActivated: stored.break_even_activated ?? false,
  };
}

async function runSymbol(symbol: string, openPositionCount: number): Promise<void> {
  log(`[${symbol}] Evaluating...`);

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
  const candles1h = tf['1h'] ?? undefined;
  const candles15m = tf['15m'] ?? undefined;

  const storedPosition = await getPosition(symbol);

  // ── Already in a position → manage it, don't look for new entries ──────────
  if (storedPosition.status === 'OPEN') {
    await manageOpenPosition(symbol, storedPosition, candles4h);
    return;
  }

  // ── Flat → run ENTER/WAIT/AVOID logic ───────────────────────────────────────
  const decision = decideEntry({
    candles4h, candles1d, candles1h, candles15m, config: cfg(symbol),
  });
  log(`[${symbol}] Decision: ${decision.state} — ${decision.reasons.join(' ')}`);

  if (decision.state === 'AVOID') {
    // Not alerted to Telegram every cycle — AVOID is the common case and
    // would drown ENTER/EXIT alerts in noise. Logged above for visibility;
    // formatAvoidAlert exists (Phase 15) for callers that want it surfaced
    // (e.g. an on-demand "why isn't X triggering" command).
    return;
  }

  if (decision.state === 'WAIT') {
    await sendAlert(formatWaitAlert(symbol, decision));
    return;
  }

  // decision.state === 'ENTER'
  if (!validateMaxExposure(openPositionCount, MAX_OPEN_POSITIONS)) {
    warn(`[${symbol}] ENTER signal suppressed — max open positions (${MAX_OPEN_POSITIONS}) reached.`);
    return;
  }
  if (decision.entry === null || decision.stopLoss === null || !decision.takeProfitLevels) {
    warn(`[${symbol}] ENTER signal missing required fields — skipping.`);
    return;
  }
  if (await isDuplicate(symbol, 'ENTER', decision.entry)) {
    warn(`[${symbol}] Duplicate ENTER suppressed.`);
    return;
  }

  const { tp1, tp2, tp3 } = decision.takeProfitLevels;
  const size = calcPositionSize(ENV.ACCOUNT_EQUITY, decision.entry, decision.stopLoss);
  const managed = openPosition(decision.entry, decision.stopLoss, tp1, tp2, tp3);

  await upsertPosition({
    symbol, status: 'OPEN', entry: managed.entry, stop_loss: managed.stopLoss,
    take_profit: managed.tp3, size, remaining: managed.remainingPct,
    tp1: managed.tp1, tp2: managed.tp2, tp3: managed.tp3,
    highest_price: managed.highestPrice, tp1_hit: managed.tp1Hit,
    tp2_hit: managed.tp2Hit, break_even_activated: managed.breakEvenActivated,
  });
  await saveDecision({
    symbol, state: 'ENTER', entry: managed.entry, stopLoss: managed.stopLoss,
    takeProfit: managed.tp3, confidence: decision.score?.total ?? null,
  });
  await sendAlert(formatEnterAlert(symbol, decision));
}

async function manageOpenPosition(symbol: string, storedPosition: StoredPosition, candles4h: import('../types/index.js').Candle[]): Promise<void> {
  const managed = reconstructManagedPosition(storedPosition);

  // Structural/regime invalidation (bearish CHoCH, trend flip) — checked
  // separately from updatePosition, which only tracks stop/TP/trailing math
  // and doesn't look at market structure.
  const structuralExit = decideExit(candles4h, {
    status: 'OPEN', stop_loss: managed.stopLoss, take_profit: managed.tp3,
  });

  const result = updatePosition(managed, candles4h);
  const closed = result.closed || structuralExit.exit;

  if (closed) {
    const exitPrice = candles4h[candles4h.length - 1]!.close;
    const reasons = [...result.actions, ...structuralExit.reasons];
    log(`[${symbol}] Position closed: ${reasons.join(' ')}`);

    await upsertPosition({
      symbol, status: 'CLOSED', entry: storedPosition.entry, stop_loss: null,
      take_profit: null, size: storedPosition.size, remaining: 0,
    });
    await saveDecision({
      symbol, state: 'EXIT', entry: managed.entry, stopLoss: result.position.stopLoss,
      takeProfit: managed.tp3, confidence: null,
    });
    await sendAlert(formatExitAlert({
      symbol, entry: managed.entry, exitPrice, stopLoss: result.position.stopLoss,
      decision: { exit: true, reasons },
    }));
    return;
  }

  if (result.actions.length > 0) {
    log(`[${symbol}] Position update: ${result.actions.join(' ')}`);
    await upsertPosition({
      symbol, status: 'OPEN', entry: storedPosition.entry, stop_loss: result.position.stopLoss,
      take_profit: storedPosition.take_profit, size: storedPosition.size,
      remaining: result.position.remainingPct,
      tp1: result.position.tp1, tp2: result.position.tp2, tp3: result.position.tp3,
      highest_price: result.position.highestPrice, tp1_hit: result.position.tp1Hit,
      tp2_hit: result.position.tp2Hit, break_even_activated: result.position.breakEvenActivated,
    });
    await sendAlert(formatPositionUpdateAlert(symbol, result.position, result.actions));
    return;
  }

  log(`[${symbol}] Position unchanged (${result.position.remainingPct}% remaining, stop $${result.position.stopLoss.toFixed(4)}).`);
}