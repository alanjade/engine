import { isBullishRejection, isHammer, isBullishEngulfing, isDisplacementCandle } from './candles.js';
import { detectVolumeConfirmation } from './volume.js';
import { analyzeStructure } from './structure.js';
import { detectBreakoutRetest, detectLiquiditySweep } from './setups.js';
import type { Candle, EntryConfirmation } from '../types/index.js';

const MIN_CONFIRMATIONS_TO_ENTER = 3;

/** Close breaking above the given level on the most recent candle. */
export function detectBreakoutConfirmation(candles: Candle[], level: number): boolean {
  if (!candles.length) return false;
  const last = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2];
  const justBroke = last.close > level && (!prev || prev.close <= level);
  return justBroke;
}

export interface ConfirmationInput {
  candles: Candle[];
  /** Lower-timeframe candles (1H or 15M) — optional; when supplied, their own bullish rejection/engulfing on the latest candle counts as lowerTimeframeConfirmed. */
  lowerTimeframeCandles?: Candle[];
  breakoutLevel?: number;
}

export function analyzeEntryConfirmation(input: ConfirmationInput): EntryConfirmation | null {
  const { candles, lowerTimeframeCandles, breakoutLevel } = input;
  if (candles.length < 60) return null;

  const last = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2];

  const rejectionCandle = isBullishRejection(last);
  const hammer = isHammer(last);
  const engulfing = !!prev && isBullishEngulfing(prev, last);
  const displacementCandle = isDisplacementCandle(last);

  const breakoutConfirmed = breakoutLevel !== undefined && detectBreakoutConfirmation(candles, breakoutLevel);
  const breakoutRetestConfirmed = detectBreakoutRetest(candles).detected;

  const volumeConfirmed = detectVolumeConfirmation(candles);

  const structure = analyzeStructure(candles, 2);
  const structureConfirmed = structure.bias === 'BULLISH' && structure.lastEvent !== 'BEARISH_CHOCH';

  const liquidityConfirmed = detectLiquiditySweep(candles).detected;

  const lowerTimeframeConfirmed = lowerTimeframeCandles
    ? evaluateLowerTimeframe(lowerTimeframeCandles)
    : null;

  const checks = [
    rejectionCandle, hammer, engulfing, displacementCandle,
    breakoutConfirmed, breakoutRetestConfirmed, volumeConfirmed,
    structureConfirmed, liquidityConfirmed,
    lowerTimeframeConfirmed === true,
  ];
  const confirmedCount = checks.filter(Boolean).length;

  return {
    rejectionCandle, hammer, engulfing, displacementCandle,
    breakoutConfirmed, breakoutRetestConfirmed, volumeConfirmed,
    structureConfirmed, liquidityConfirmed, lowerTimeframeConfirmed,
    confirmedCount,
    confirmed: confirmedCount >= MIN_CONFIRMATIONS_TO_ENTER,
  };
}

function evaluateLowerTimeframe(candles: Candle[]): boolean | null {
  if (candles.length < 3) return null;
  const last = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2];
  return isBullishRejection(last) || isHammer(last) || (!!prev && isBullishEngulfing(prev, last));
}
