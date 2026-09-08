import { calcATR } from './indicators.js';
import { nearestSupport, nearestResistance, analyzeStructure } from './structure.js';
import { detectRegime, isTradableForLong } from './regime.js';
import { calcStopLoss, calcTakeProfitLevels } from './risk.js';
import { calcEntryScore } from './score.js';
import { scoreEntryLocation } from './entry-location.js';
import { analyzeEntryConfirmation } from './confirmation.js';
import { analyzeChase } from './chase.js';
import type { Candle, EntryDecision, ExitDecision, Position, SymbolConfig } from '../types/index.js';

const MIN_STRUCTURE_QUALITY = 40;
const MIN_ENTRY_LOCATION_SCORE = 40;
const MIN_SCORE_TO_WAIT = 60;
const MIN_SCORE_TO_ENTER = 70;

export interface EntryDecisionInput {
  candles4h: Candle[];
  candles1d: Candle[];
  /** 1H → Setup detection, 15M → Entry confirmation (see TODO's Timeframe Responsibilities). Both optional; each falls back gracefully to 4H-only when unavailable for a given cycle. */
  candles1h?: Candle[];
  candles15m?: Candle[];
  config: SymbolConfig;
  candlesPerDay?: number; // for chase's 24h-move check — defaults to 6 (4H candles)
}

/**
 * Replaces the old flat BUY/NONE logic with ENTER/WAIT/AVOID, each backed by
 * the full stack built in Phases 3-10 rather than a handful of inline checks.
 *
 * AVOID fires early on any hard disqualifier (bad regime, poor structure,
 * poor entry location, poor RR, chase-blocked) — these are gates, not scored
 * inputs, because a great composite score shouldn't be able to outvote "this
 * setup is structurally broken" or "price already ran too far to chase".
 * ENTER requires both a high composite score AND full entry confirmation —
 * either alone is not enough. WAIT is anything in between: a real setup
 * that hasn't fully confirmed yet, worth watching rather than acting on.
 */
export function decideEntry(input: EntryDecisionInput): EntryDecision {
  const { candles4h, candles1d, candles1h, candles15m, config } = input;
  const candlesPerDay = input.candlesPerDay ?? 6;
  const reasons: string[] = [];

  const closes = candles4h.map(c => c.close);
  const price = closes[closes.length - 1];

  if (!price || candles4h.length < 220 || candles1d.length < 100) {
    return avoidResult(['Insufficient candle history.']);
  }

  const support = nearestSupport(candles4h, price, config.supportLookback);
  const resistance = nearestResistance(candles4h, price, config.supportLookback);
  const atr = calcATR(candles4h, 14);

  if (!support || !resistance || !atr) {
    return avoidResult(['No valid support/resistance/ATR available.']);
  }

  const regime = detectRegime(candles4h);
  if (!isTradableForLong(regime)) {
    return avoidResult([`Market regime not tradable for long: ${regime.regime}.`]);
  }

  const structure = analyzeStructure(candles4h, 2);
  if (structure.qualityScore < MIN_STRUCTURE_QUALITY) {
    return avoidResult([`Poor structure quality (${structure.qualityScore}/100).`], { regime: regime.regime });
  }

  const slResult = calcStopLoss(price, support, atr, config);
  if (!slResult.ok || slResult.stopLoss === null) {
    return avoidResult([slResult.reason ?? 'Stop-loss calculation failed.'], { regime: regime.regime });
  }
  const stopLoss = slResult.stopLoss;
  const takeProfit = resistance.price;
  const riskReward = (takeProfit - price) / (price - stopLoss);

  if (riskReward < config.minRR) {
    return avoidResult([`RR ${riskReward.toFixed(2)} below minimum ${config.minRR}.`], { entry: price, stopLoss, takeProfit, riskReward, regime: regime.regime });
  }

  const chase = analyzeChase({
    candles: candles4h, candlesPerDay, support: support.price,
    breakoutLevel: resistance.price, currentRR: riskReward, originalRR: riskReward,
  });
  if (chase?.blocked) {
    return avoidResult(['DO NOT CHASE: ' + chase.reasons.join(', ')], { entry: price, stopLoss, takeProfit, riskReward, chase, regime: regime.regime });
  }

  const score = calcEntryScore({ candles4h, candles1d, candles1h, stopLoss, takeProfit });
  const entryLocationScore = (score.breakdown.entryLocation / 15) * 100;
  if (entryLocationScore < MIN_ENTRY_LOCATION_SCORE) {
    return avoidResult([`Poor entry location (${entryLocationScore.toFixed(0)}/100).`], { entry: price, stopLoss, takeProfit, riskReward, score, chase, regime: regime.regime });
  }

  if (score.total < MIN_SCORE_TO_WAIT) {
    return avoidResult([`Composite score ${score.total} below WATCH threshold.`], { entry: price, stopLoss, takeProfit, riskReward, score, chase, regime: regime.regime });
  }

  const confirmation = analyzeEntryConfirmation({
    candles: candles4h, breakoutLevel: resistance.price,
    lowerTimeframeCandles: candles15m, // 15M → Entry confirmation
  });

  const takeProfitLevels = calcTakeProfitLevels(price, stopLoss, resistance.price);
  const entryZones = scoreEntryLocation(candles4h, { stopLoss, takeProfit })?.zones ?? null;

  if (confirmation?.confirmed && score.total >= MIN_SCORE_TO_ENTER) {
    reasons.push(`Setup confirmed (${confirmation.confirmedCount} confirmations), score ${score.total} (${score.grade}), RR ${riskReward.toFixed(2)}.`);
    return { state: 'ENTER', reasons, score, chase, confirmation, entry: price, stopLoss, takeProfit, riskReward, regime: regime.regime, takeProfitLevels, entryZones };
  }

  const missing = confirmation ? MIN_SCORE_TO_ENTER > score.total ? 'score below ENTER threshold' : 'confirmation incomplete' : 'confirmation unavailable';
  reasons.push(`Setup present (score ${score.total}, ${score.grade}) but ${missing}.`);
  return { state: 'WAIT', reasons, score, chase, confirmation, entry: price, stopLoss, takeProfit, riskReward, regime: regime.regime, takeProfitLevels, entryZones };
}

function avoidResult(
  reasons: string[],
  partial: Partial<Pick<EntryDecision, 'entry' | 'stopLoss' | 'takeProfit' | 'riskReward' | 'score' | 'chase' | 'confirmation' | 'regime'>> = {},
): EntryDecision {
  return {
    state: 'AVOID', reasons,
    score: partial.score ?? null,
    chase: partial.chase ?? null,
    confirmation: partial.confirmation ?? null,
    entry: partial.entry ?? null,
    stopLoss: partial.stopLoss ?? null,
    takeProfit: partial.takeProfit ?? null,
    riskReward: partial.riskReward ?? null,
    regime: partial.regime ?? null,
    takeProfitLevels: null,
    entryZones: null,
  };
}

/**
 * EXIT logic for an open position. Deliberately does not include trailing
 * stops — that's Phase 12 (position management) territory, since a trailing
 * stop requires tracking the position's highest-price-since-entry, which is
 * state this function doesn't have (and shouldn't own).
 */
export function decideExit(candles4h: Candle[], position: Position): ExitDecision {
  const reasons: string[] = [];
  if (!candles4h.length) return { exit: false, reasons: ['No candle data.'] };

  const price = candles4h[candles4h.length - 1]!.close;

  if (price <= position.stop_loss) reasons.push('Stop-loss reached.');
  if (price >= position.take_profit) reasons.push('Take-profit reached.');

  const structure = analyzeStructure(candles4h, 2);
  if (structure.lastEvent === 'BEARISH_CHOCH') reasons.push('Structure invalidated (bearish CHoCH).');

  const regime = detectRegime(candles4h);
  if (regime.regime === 'STRONG_DOWNTREND' || regime.regime === 'WEAK_DOWNTREND') {
    reasons.push(`Trend failure — regime now ${regime.regime}.`);
  }

  return { exit: reasons.length > 0, reasons };
}
