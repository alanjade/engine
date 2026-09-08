import { calcRSI } from './indicators.js';
import type { Candle, MomentumAnalysis, MomentumState } from '../types/index.js';

const OVERBOUGHT = 70;
const OVERSOLD = 30;
const DIVERGENCE_LOOKBACK = 20;

function rsiSeries(closes: number[], period = 14, count = 10): number[] {
  const series: number[] = [];
  for (let i = closes.length - count; i < closes.length; i++) {
    if (i < period + 1) continue;
    const r = calcRSI(closes.slice(0, i + 1), period);
    if (r !== null) series.push(r);
  }
  return series;
}

export function classifyMomentum(rsi: number): MomentumState {
  if (rsi >= OVERBOUGHT) return 'OVERBOUGHT';
  if (rsi <= OVERSOLD) return 'OVERSOLD';
  return 'NEUTRAL';
}

/** RSI accelerating away from 50 — trend momentum building, not just present. */
export function detectMomentumExpansion(candles: Candle[], period = 14): boolean {
  const closes = candles.map(c => c.close);
  const series = rsiSeries(closes, period, 6);
  if (series.length < 4) return false;
  const distances = series.map(r => Math.abs(r - 50));
  // Rising distance-from-50 over the last few readings = expansion.
  return distances[distances.length - 1]! > distances[0]! &&
    distances[distances.length - 1]! > distances[distances.length - 2]!;
}

/** RSI held an extreme reading, then started pulling back toward 50 — the move is losing steam. */
export function detectMomentumExhaustion(candles: Candle[], period = 14): boolean {
  const closes = candles.map(c => c.close);
  const series = rsiSeries(closes, period, 8);
  if (series.length < 5) return false;

  const hadExtreme = series.some(r => r >= OVERBOUGHT || r <= OVERSOLD);
  if (!hadExtreme) return false;

  const last = series[series.length - 1]!;
  const peak = series.reduce((max, r) => (Math.abs(r - 50) > Math.abs(max - 50) ? r : max));
  // Exhaustion: the peak was extreme, and the latest reading has pulled back meaningfully from it.
  const peakWasExtreme = peak >= OVERBOUGHT || peak <= OVERSOLD;
  const pulledBack = Math.abs(peak - 50) - Math.abs(last - 50) >= 5;
  return peakWasExtreme && pulledBack;
}

function findSwingLows(values: number[]): { index: number; value: number }[] {
  const swings: { index: number; value: number }[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i]! < values[i - 1]! && values[i]! < values[i + 1]!) swings.push({ index: i, value: values[i]! });
  }
  return swings;
}

function findSwingHighs(values: number[]): { index: number; value: number }[] {
  const swings: { index: number; value: number }[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i]! > values[i - 1]! && values[i]! > values[i + 1]!) swings.push({ index: i, value: values[i]! });
  }
  return swings;
}

/**
 * Pure comparison: given two parallel series (e.g. price lows and an
 * indicator's values over the same window), does the second series show
 * bullish divergence against the first — a lower low in `primary` paired
 * with a higher low in `indicator`? Exposed standalone so divergence logic
 * is testable without depending on RSI's specific numeric behavior, which
 * is sensitive to smoothing and doesn't reliably diverge on deterministic
 * synthetic price paths the way real, noisy market data does.
 */
export function findBullishDivergence(primary: number[], indicator: number[]): boolean {
  const primaryLows = findSwingLows(primary);
  const indicatorLows = findSwingLows(indicator);
  if (primaryLows.length < 2 || indicatorLows.length < 2) return false;
  const lastP = primaryLows[primaryLows.length - 1]!, prevP = primaryLows[primaryLows.length - 2]!;
  const lastI = indicatorLows[indicatorLows.length - 1]!, prevI = indicatorLows[indicatorLows.length - 2]!;
  return lastP.value < prevP.value && lastI.value > prevI.value;
}

/** Same as findBullishDivergence but for highs (higher high in `primary`, lower high in `indicator`). */
export function findBearishDivergence(primary: number[], indicator: number[]): boolean {
  const primaryHighs = findSwingHighs(primary);
  const indicatorHighs = findSwingHighs(indicator);
  if (primaryHighs.length < 2 || indicatorHighs.length < 2) return false;
  const lastP = primaryHighs[primaryHighs.length - 1]!, prevP = primaryHighs[primaryHighs.length - 2]!;
  const lastI = indicatorHighs[indicatorHighs.length - 1]!, prevI = indicatorHighs[indicatorHighs.length - 2]!;
  return lastP.value > prevP.value && lastI.value < prevI.value;
}

/** Price makes a lower low while RSI makes a higher low — bullish divergence. */
export function detectBullishDivergence(candles: Candle[], period = 14, lookback = DIVERGENCE_LOOKBACK): boolean {
  if (candles.length < lookback + period) return false;
  const window = candles.slice(-lookback);
  const closes = candles.map(c => c.close);
  const rsiWindow = window.map((_, i) => calcRSI(closes.slice(0, closes.length - lookback + i + 1), period)).filter((r): r is number => r !== null);
  if (rsiWindow.length < lookback - 2) return false;
  return findBullishDivergence(window.map(c => c.low), rsiWindow);
}

/** Price makes a higher high while RSI makes a lower high — bearish divergence. */
export function detectBearishDivergence(candles: Candle[], period = 14, lookback = DIVERGENCE_LOOKBACK): boolean {
  if (candles.length < lookback + period) return false;
  const window = candles.slice(-lookback);
  const closes = candles.map(c => c.close);
  const rsiWindow = window.map((_, i) => calcRSI(closes.slice(0, closes.length - lookback + i + 1), period)).filter((r): r is number => r !== null);
  if (rsiWindow.length < lookback - 2) return false;
  return findBearishDivergence(window.map(c => c.high), rsiWindow);
}

export function analyzeMomentum(candles: Candle[], period = 14): MomentumAnalysis | null {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, period);
  if (rsi === null) return null;
  return {
    rsi: Math.round(rsi * 100) / 100,
    state: classifyMomentum(rsi),
    expansion: detectMomentumExpansion(candles, period),
    exhaustion: detectMomentumExhaustion(candles, period),
    bullishDivergence: detectBullishDivergence(candles, period),
    bearishDivergence: detectBearishDivergence(candles, period),
  };
}
