import type { Level, SymbolConfig, TakeProfitLevels } from '../types/index.js';

export interface StopLossResult {
  ok: boolean;
  stopLoss: number | null;
  reason: string | null;
}

/**
 * Structure + ATR-based stop calculation.
 *
 * Bounds are named by their actual position on the price axis, not by
 * intent — this is what the old sl_floor/sl_ceiling naming got backwards:
 * `sl_floor = support * 0.99` is CLOSER to price (tighter stop), while
 * `sl_ceiling = support - 2*atr` is FARTHER from price (looser stop) —
 * i.e. the "floor" was actually the upper bound and the "ceiling" the
 * lower bound. That made the `floor > ceiling` guard fire backwards
 * whenever ATR was large, so a bad clamp range slipped through instead
 * of being rejected.
 *
 * Here:
 *   - tightBound  = the closest-to-price the stop is allowed to be (support * 0.99)
 *   - looseBound  = the farthest-from-price the stop is allowed to be (support - 2*ATR)
 *   - rawStop     = the unclamped structure+ATR estimate (support - 0.5*ATR)
 * The final stop is rawStop clamped between looseBound (lower) and tightBound (upper).
 */
export function calcStopLoss(
  entry: number,
  support: Level,
  atr: number,
  config: SymbolConfig,
): StopLossResult {
  const tightBound = support.price * 0.99;
  const looseBound = support.price - 2 * atr;
  const rawStop = support.price - 0.5 * atr;

  if (looseBound >= tightBound) {
    return { ok: false, stopLoss: null, reason: 'ATR too large — SL range invalid (loose bound ≥ tight bound).' };
  }

  const stopLoss = Math.min(tightBound, Math.max(looseBound, rawStop));

  if (stopLoss >= entry) {
    return { ok: false, stopLoss: null, reason: 'Stop-loss at or above entry — invalid setup.' };
  }

  const riskPct = (entry - stopLoss) / entry;
  if (riskPct > config.maxRiskPct) {
    return {
      ok: false,
      stopLoss: null,
      reason: `Stop distance ${(riskPct * 100).toFixed(2)}% exceeds max acceptable risk ${(config.maxRiskPct * 100).toFixed(2)}%.`,
    };
  }

  return { ok: true, stopLoss, reason: null };
}

/** 1% account-risk position sizing. Throws if risk <= 0 to avoid silent Infinity/NaN sizing. */
export function calcPositionSize(accountEquity: number, entry: number, stopLoss: number, riskPct = 0.01): number {
  const risk = entry - stopLoss;
  if (risk <= 0) {
    throw new Error(`Invalid risk per unit (${risk}) — stop-loss must be below entry.`);
  }
  return Math.round(((accountEquity * riskPct) / risk) * 100) / 100;
}

/**
 * Three take-profit tiers. TP2 anchors to actual resistance when it's a
 * viable target (beyond 1R) rather than a flat RR multiple, since a fixed
 * "2R" target can sit either well short of or well past a real resistance
 * level — using the level itself when available is more realistic than a
 * round-number RR target invented independent of market structure.
 */
export function calcTakeProfitLevels(entry: number, stopLoss: number, resistance?: number): TakeProfitLevels {
  const risk = entry - stopLoss;
  const tp1 = entry + risk * 1;
  const tp2 = resistance !== undefined && resistance > tp1 ? resistance : entry + risk * 2;
  const tp3 = Math.max(entry + risk * 3, entry + (tp2 - entry) * 1.5);

  return {
    tp1, tp2, tp3,
    rr1: (tp1 - entry) / risk,
    rr2: (tp2 - entry) / risk,
    rr3: (tp3 - entry) / risk,
  };
}

/** Portfolio-level exposure cap — independent of any single trade's own risk math. */
export function validateMaxExposure(openPositionCount: number, maxOpenPositions: number): boolean {
  return openPositionCount < maxOpenPositions;
}

/** Explicit RR gate, split out from calcStopLoss so callers can check it against a resistance-anchored TP without recomputing the stop. */
export function rejectInsufficientRR(riskReward: number, minRR: number): boolean {
  return riskReward < minRR;
}
