/**
 * Confidence model — max 100 points, threshold 75.
 *
 * Component         | Max
 * ——————————————————|————
 * 4H Trend          |  30
 * Daily Trend       |  10
 * Support Quality   |  20
 * Volume            |  15
 * RSI               |  10
 * Clean Structure   |  10
 * Rejection candle  |   5
 */

export function calcConfidence({
  trendAligned,       // bool: 4H EMA50 > EMA200 && price above EMA50
  dailyTrendAligned,  // bool: 1D EMA50 > 1D EMA200
  supportScore,       // int: 1/2/3+
  volumeRatio,        // float
  rsi,                // float
  cleanStructure,     // bool: no EMA crosses in 20c AND clear swing structure
  hasRejectionCandle, // bool
}) {
  let score = 0;

  if (trendAligned)      score += 30;
  if (dailyTrendAligned) score += 10;

  if (supportScore >= 3)      score += 20;
  else if (supportScore >= 2) score += 10;

  if (volumeRatio > 1.5)      score += 15;
  else if (volumeRatio >= 1.2) score += 10;

  if (rsi >= 65 && rsi <= 70)      score += 10;
  else if (rsi >= 55 && rsi < 65)  score += 7;

  if (cleanStructure)      score += 10;
  if (hasRejectionCandle)  score += 5;

  return score;
}
