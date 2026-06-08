export function isBullishRejection(candle) {
  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const range = high - low;
  if (range === 0) return false;
  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);
  const closePositionInRange = (close - low) / range;
  return (
    lowerWick >= 2 * body &&
    close > open &&
    closePositionInRange >= 0.6
  );
}

export function isBearishRejection(candle) {
  const { open, high, low, close } = candle;
  const body = Math.abs(close - open);
  const range = high - low;
  if (range === 0) return false;
  const upperWick = high - Math.max(open, close);
  const closePositionInRange = (close - low) / range;
  return (
    upperWick >= 2 * body &&
    close < open &&
    closePositionInRange <= 0.4
  );
}

export function isBullishEngulfing(prev, curr) {
  return (
    prev.close < prev.open &&
    curr.close > curr.open &&
    curr.open <= prev.close &&
    curr.close >= prev.open
  );
}

export function isHammer(candle) {
  return isBullishRejection(candle);
}

export function hasConfirmationPattern(candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return (
    isBullishRejection(last) ||
    isHammer(last) ||
    (prev && isBullishEngulfing(prev, last))
  );
}
