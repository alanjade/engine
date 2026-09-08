import { calcVolumeSMA } from './indicators.js';
import type { Candle, VolumeAnalysis } from '../types/index.js';

const EXPANSION_THRESHOLD = 1.5;
const CONTRACTION_THRESHOLD = 0.7;
const DIVERGENCE_LOOKBACK = 10;

export function calcRelativeVolume(candles: Candle[], period = 20): number | null {
  if (candles.length < period + 1) return null;
  const sma = calcVolumeSMA(candles.slice(0, -1), period); // SMA excludes current candle so it isn't self-referential
  const current = candles[candles.length - 1]!.volume;
  return sma && sma > 0 ? current / sma : null;
}

export function detectVolumeExpansion(candles: Candle[], period = 20, threshold = EXPANSION_THRESHOLD): boolean {
  const rv = calcRelativeVolume(candles, period);
  return rv !== null && rv >= threshold;
}

export function detectVolumeContraction(candles: Candle[], period = 20, threshold = CONTRACTION_THRESHOLD): boolean {
  const rv = calcRelativeVolume(candles, period);
  return rv !== null && rv <= threshold;
}

/** True when a volume-expansion candle moves price in a clear direction (not a doji/indecision candle on high volume). */
export function detectVolumeConfirmation(candles: Candle[], period = 20): boolean {
  if (!candles.length) return false;
  const last = candles[candles.length - 1]!;
  const expanded = detectVolumeExpansion(candles, period);
  if (!expanded) return false;
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  return range > 0 && body / range >= 0.4;
}

/**
 * True when price sets a new local high/low over the lookback window while
 * volume on that extending candle is below its own recent average — the
 * move isn't backed by participation.
 */
export function detectVolumeDivergence(candles: Candle[], lookback = DIVERGENCE_LOOKBACK, period = 20): boolean {
  if (candles.length < lookback + period) return false;
  const window = candles.slice(-lookback);
  const last = window[window.length - 1]!;
  const priorHigh = Math.max(...window.slice(0, -1).map(c => c.high));
  const priorLow = Math.min(...window.slice(0, -1).map(c => c.low));
  const madeNewExtreme = last.high > priorHigh || last.low < priorLow;
  if (!madeNewExtreme) return false;

  const rv = calcRelativeVolume(candles, period);
  return rv !== null && rv < 1.0;
}

export function analyzeVolume(candles: Candle[], period = 20): VolumeAnalysis | null {
  const rv = calcRelativeVolume(candles, period);
  if (rv === null) return null;
  return {
    relativeVolume: Math.round(rv * 100) / 100,
    expansion: rv >= EXPANSION_THRESHOLD,
    contraction: rv <= CONTRACTION_THRESHOLD,
    confirmsMove: detectVolumeConfirmation(candles, period),
    divergence: detectVolumeDivergence(candles, DIVERGENCE_LOOKBACK, period),
  };
}
