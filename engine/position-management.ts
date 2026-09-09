import { calcATR } from './indicators.js';
import { analyzeStructure } from './structure.js';
import { detectRegime } from './regime.js';
import type { Candle, ManagedPosition, PositionUpdateResult } from '../types/index.js';

const TP1_CLOSE_PCT = 33; // % of position closed at each partial
const TP2_CLOSE_PCT = 33;
const ATR_TRAIL_MULTIPLE = 2.5;
const EMERGENCY_DROP_PCT = 8; // single-candle drop this severe exits regardless of stop placement

export function openPosition(entry: number, stopLoss: number, tp1: number, tp2: number, tp3: number): ManagedPosition {
  return {
    entry, stopLoss, tp1, tp2, tp3,
    remainingPct: 100,
    highestPrice: entry,
    tp1Hit: false, tp2Hit: false, breakEvenActivated: false,
  };
}

/**
 * Advances a position by one candle: applies partial take-profits,
 * break-even and trailing-stop adjustments, and checks for an emergency or
 * trend-failure exit. Returns a new ManagedPosition (never mutates the
 * input) plus the list of actions taken this update, so the caller can
 * log/alert on exactly what happened.
 *
 * Execution assumption (documented, not left implicit): stop-loss and
 * take-profit triggers check the candle's LOW/HIGH (wick), not its close —
 * a long can wick through a level intrabar and close back on the other
 * side, and a close-only check would silently miss that fill. Fill price
 * is assumed to be exactly the level touched (no slippage modeled). When a
 * candle's wick could plausibly hit both the stop and a target in the same
 * bar, the stop is checked first — the conservative assumption, since OHLC
 * data alone can't tell you which happened first intrabar.
 */
export function updatePosition(position: ManagedPosition, candles: Candle[]): PositionUpdateResult {
  const actions: string[] = [];
  let p = { ...position };

  if (!candles.length) return { position: p, actions, closed: p.remainingPct <= 0, fillPrice: null };

  const last = candles[candles.length - 1]!;
  const price = last.close; // still used for non-level signals below (emergency drop %, trend failure) — those are close-based by nature, not a specific price level being touched
  p.highestPrice = Math.max(p.highestPrice, last.high);

  // Emergency exit: a single-candle crash this severe overrides everything
  // else — waiting for the stop to catch up on the next candle isn't safe.
  const dropPct = ((last.open - last.close) / last.open) * 100;
  if (dropPct >= EMERGENCY_DROP_PCT) {
    actions.push(`EMERGENCY_EXIT: single-candle drop of ${dropPct.toFixed(1)}%.`);
    p.remainingPct = 0;
    return { position: p, actions, closed: true, fillPrice: price };
  }

  // Trend failure: regime has flipped against the position.
  if (candles.length >= 220) {
    const regime = detectRegime(candles);
    if (regime.regime === 'STRONG_DOWNTREND' || regime.regime === 'WEAK_DOWNTREND') {
      actions.push(`TREND_FAILURE_EXIT: regime now ${regime.regime}.`);
      p.remainingPct = 0;
      return { position: p, actions, closed: true, fillPrice: price };
    }
  }

  // Stop-loss / final target — wick-based (see doc comment above), stop
  // checked first as the conservative same-candle assumption.
  if (last.low <= p.stopLoss) {
    actions.push('STOP_LOSS_HIT');
    p.remainingPct = 0;
    return { position: p, actions, closed: true, fillPrice: p.stopLoss };
  }
  if (last.high >= p.tp3) {
    actions.push('FINAL_TP_HIT');
    p.remainingPct = 0;
    return { position: p, actions, closed: true, fillPrice: p.tp3 };
  }

  // Partial TP1 + move to break-even.
  if (!p.tp1Hit && last.high >= p.tp1) {
    p.tp1Hit = true;
    p.remainingPct -= TP1_CLOSE_PCT;
    actions.push(`PARTIAL_TP1: closed ${TP1_CLOSE_PCT}%, ${p.remainingPct}% remaining.`);
    if (!p.breakEvenActivated) {
      p.stopLoss = Math.max(p.stopLoss, p.entry);
      p.breakEvenActivated = true;
      actions.push('BREAKEVEN_STOP: stop moved to entry.');
    }
  }

  // Partial TP2 — only after TP1, locks in stop at TP1 level.
  if (p.tp1Hit && !p.tp2Hit && last.high >= p.tp2) {
    p.tp2Hit = true;
    p.remainingPct -= TP2_CLOSE_PCT;
    actions.push(`PARTIAL_TP2: closed ${TP2_CLOSE_PCT}%, ${p.remainingPct}% remaining.`);
    p.stopLoss = Math.max(p.stopLoss, p.tp1);
    actions.push('STOP_LOCKED_AT_TP1');
  }

  // Trailing stop — only trails once in profit (after TP1), and never loosens.
  if (p.tp1Hit && p.remainingPct > 0) {
    const atr = calcATR(candles, 14);
    if (atr) {
      const atrTrail = p.highestPrice - atr * ATR_TRAIL_MULTIPLE;
      if (atrTrail > p.stopLoss) {
        p.stopLoss = atrTrail;
        actions.push(`ATR_TRAIL: stop raised to ${atrTrail.toFixed(4)}.`);
      }
    }

    const structure = analyzeStructure(candles, 2);
    if (structure.invalidationLevel !== null && structure.invalidationLevel > p.stopLoss) {
      p.stopLoss = structure.invalidationLevel;
      actions.push(`STRUCTURE_TRAIL: stop raised to last HL ${structure.invalidationLevel.toFixed(4)}.`);
    }
  }

  return { position: p, actions, closed: p.remainingPct <= 0, fillPrice: null };
}
