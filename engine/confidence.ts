export interface ConfidenceInput {
  trendAligned: boolean;
  dailyTrendAligned: boolean;
  supportScore: number;
  volumeRatio: number;
  rsi: number;
  cleanStructure: boolean;
  hasRejectionCandle: boolean;
}

/**
 * Confidence model — max 100 points, threshold 75.
 *
 * Component         | Max
 * ------------------|----
 * 4H Trend          |  30
 * Daily Trend       |  10
 * Support Quality   |  20
 * Volume            |  15
 * RSI               |  10
 * Clean Structure   |  10
 * Rejection candle  |   5
 */
export function calcConfidence(input: ConfidenceInput): number {
  const { trendAligned, dailyTrendAligned, supportScore, volumeRatio, rsi, cleanStructure, hasRejectionCandle } = input;
  let score = 0;

  if (trendAligned) score += 30;
  if (dailyTrendAligned) score += 10;

  if (supportScore >= 3) score += 20;
  else if (supportScore >= 2) score += 10;

  if (volumeRatio > 1.5) score += 15;
  else if (volumeRatio >= 1.2) score += 10;

  if (rsi >= 60 && rsi <= 70) score += 10;
  else if (rsi >= 50 && rsi < 60) score += 7;

  if (cleanStructure) score += 10;
  if (hasRejectionCandle) score += 5;

  return score;
}
