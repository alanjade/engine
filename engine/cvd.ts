import { findBullishDivergence, findBearishDivergence } from './momentum.js';
import type { Candle, CVDAnalysis } from '../types/index.js';

/**
 * IMPORTANT: this is an APPROXIMATION, not true CVD.
 *
 * Real cumulative volume delta needs trade-level buy/sell-side volume,
 * which plain OHLCV candles don't carry — there's no data source decision
 * that fixes this without switching to a tick/trade feed. What's computed
 * here is a standard OHLCV proxy: each candle's volume is split into
 * "buy" and "sell" pressure based on where the close landed within the
 * candle's high-low range (close near the high → mostly buy pressure,
 * close near the low → mostly sell pressure). This is a reasonable and
 * widely-used approximation (similar to Chaikin Money Flow's premise),
 * but it is not order-flow-accurate and can be wrong on candles with long
 * wicks in both directions. Treat it as directional context, not as
 * ground truth about actual buy/sell order flow.
 */
export function calcApproxDelta(candle: Candle): number {
  const range = candle.high - candle.low;
  if (range === 0) return 0;
  const closePosition = (candle.close - candle.low) / range; // 0 (at low) .. 1 (at high)
  const bias = closePosition * 2 - 1; // -1 (all sell pressure) .. +1 (all buy pressure)
  return bias * candle.volume;
}

export function calcCVDSeries(candles: Candle[]): number[] {
  const series: number[] = [];
  let cumulative = 0;
  for (const c of candles) {
    cumulative += calcApproxDelta(c);
    series.push(cumulative);
  }
  return series;
}

export function detectBullishCVD(candles: Candle[], lookback = 20): boolean {
  const cvd = calcCVDSeries(candles.slice(-lookback));
  if (cvd.length < 2) return false;
  return cvd[cvd.length - 1]! > cvd[0]!;
}

export function detectBearishCVD(candles: Candle[], lookback = 20): boolean {
  const cvd = calcCVDSeries(candles.slice(-lookback));
  if (cvd.length < 2) return false;
  return cvd[cvd.length - 1]! < cvd[0]!;
}

/** Price makes a lower low while CVD makes a higher low — selling pressure is drying up despite the new low. */
export function detectBullishCVDDivergence(candles: Candle[], lookback = 30): boolean {
  if (candles.length < lookback) return false;
  const window = candles.slice(-lookback);
  const cvd = calcCVDSeries(window);
  return findBullishDivergence(window.map(c => c.low), cvd);
}

/** Price makes a higher high while CVD makes a lower high — buying pressure is drying up despite the new high. */
export function detectBearishCVDDivergence(candles: Candle[], lookback = 30): boolean {
  if (candles.length < lookback) return false;
  const window = candles.slice(-lookback);
  const cvd = calcCVDSeries(window);
  return findBearishDivergence(window.map(c => c.high), cvd);
}

export function analyzeCVD(candles: Candle[], lookback = 20): CVDAnalysis | null {
  if (candles.length < lookback) return null;
  const window = candles.slice(-lookback);
  const cvd = calcCVDSeries(window);
  const priceUp = window[window.length - 1]!.close > window[0]!.close;
  const cvdUp = cvd[cvd.length - 1]! > cvd[0]!;

  let trend: CVDAnalysis['trend'] = 'FLAT';
  const cvdRange = Math.max(...cvd) - Math.min(...cvd);
  const cvdChangePct = cvdRange > 0 ? Math.abs(cvd[cvd.length - 1]! - cvd[0]!) / cvdRange : 0;
  if (cvdChangePct > 0.15) trend = cvdUp ? 'BULLISH' : 'BEARISH';

  return {
    cvd: cvd.map(v => Math.round(v)),
    trend,
    bullishDivergence: detectBullishCVDDivergence(candles),
    bearishDivergence: detectBearishCVDDivergence(candles),
    confirmsPrice: priceUp === cvdUp,
  };
}

/** 0-1 multiplier for Phase 10's entry score ("Add CVD to entry score"). */
export function cvdScoreMultiplier(analysis: CVDAnalysis | null): number {
  if (!analysis) return 0.5; // neutral when unavailable — don't penalize for missing data
  if (analysis.bullishDivergence) return 1.0;
  if (analysis.bearishDivergence) return 0.1;
  if (analysis.trend === 'BULLISH' && analysis.confirmsPrice) return 0.9;
  if (analysis.trend === 'BEARISH') return 0.2;
  return 0.5;
}
