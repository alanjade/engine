import type { Candle } from '../types/index.js';

export function isBullishRejection(candle: Candle): boolean {
  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const range = high - low;
  if (range === 0) return false;
  const lowerWick = Math.min(open, close) - low;
  const closePositionInRange = (close - low) / range;
  return lowerWick >= 2 * body && close > open && closePositionInRange >= 0.6;
}

export function isBearishRejection(candle: Candle): boolean {
  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const range = high - low;
  if (range === 0) return false;
  const upperWick = high - Math.max(open, close);
  const closePositionInRange = (close - low) / range;
  return upperWick >= 2 * body && close < open && closePositionInRange <= 0.4;
}

export function isBullishEngulfing(prev: Candle, curr: Candle): boolean {
  return (
    prev.close < prev.open &&
    curr.close > curr.open &&
    curr.open <= prev.close &&
    curr.close >= prev.open
  );
}

export function isBearishEngulfing(prev: Candle, curr: Candle): boolean {
  return (
    prev.close > prev.open &&
    curr.close < curr.open &&
    curr.open >= prev.close &&
    curr.close <= prev.open
  );
}

/**
 * A real hammer, distinct from generic bullish rejection: small body sitting
 * at the TOP of the range with a long lower wick AND a minimal upper wick
 * (near-zero). Generic rejection only requires the lower wick to dominate —
 * a hammer additionally requires the upper wick to be small, which rules out
 * candles that wicked significantly both ways.
 */
export function isHammer(candle: Candle): boolean {
  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const range = high - low;
  if (range === 0) return false;
  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);
  return lowerWick >= 2 * body && upperWick <= body * 0.3 && body / range <= 0.35;
}

/** Same shape as a hammer but appearing after a downtrend closes bearish enough not to matter — inverted for tops. */
export function isShootingStar(candle: Candle): boolean {
  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const range = high - low;
  if (range === 0) return false;
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  return upperWick >= 2 * body && lowerWick <= body * 0.3 && body / range <= 0.35;
}

/** A candle with an unusually dominant body relative to its range — conviction, not indecision. */
export function isDisplacementCandle(candle: Candle, minBodyRatio = 0.6): boolean {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  return range > 0 && body / range >= minBodyRatio;
}

export function hasConfirmationPattern(candles: Candle[]): boolean {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last) return false;
  return (
    isBullishRejection(last) ||
    isHammer(last) ||
    (!!prev && isBullishEngulfing(prev, last))
  );
}
