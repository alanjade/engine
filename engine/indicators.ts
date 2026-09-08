import { EMA as TIema, RSI as TIrsi, ATR as TIatr } from 'technicalindicators';
import type { Candle } from '../types/index.js';

export function calcEMA(closes: number[], period: number): number | null {
  const result = TIema.calculate({ period, values: closes });
  return result[result.length - 1] ?? null;
}

export function calcRSI(closes: number[], period = 14): number | null {
  const result = TIrsi.calculate({ period, values: closes });
  return result[result.length - 1] ?? null;
}

export function calcATR(candles: Candle[], period = 14): number | null {
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const close = candles.map(c => c.close);
  const result = TIatr.calculate({ period, high, low, close });
  return result[result.length - 1] ?? null;
}

export function calcVolumeSMA(candles: Candle[], period = 20): number | null {
  const vols = candles.map(c => c.volume).slice(-period);
  if (vols.length < period) return null;
  return vols.reduce((a, b) => a + b, 0) / period;
}

export function emaCrossCount(
  candles: Candle[],
  period1 = 50,
  period2 = 200,
  lookback = 20,
): number {
  const recent = candles.slice(-lookback - period2);
  const closes = recent.map(c => c.close);
  let crosses = 0;
  let prev: boolean | null = null;
  for (let i = period2; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const e1 = calcEMA(slice, period1);
    const e2 = calcEMA(slice, period2);
    if (e1 === null || e2 === null) continue;
    const above = e1 > e2;
    if (prev !== null && above !== prev) crosses++;
    prev = above;
  }
  return crosses;
}

/** Volume-weighted average price over the given candles (not anchored to a session — caller controls the window). */
export function calcVWAP(candles: Candle[]): number | null {
  if (!candles.length) return null;
  let pvSum = 0, vSum = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pvSum += typical * c.volume;
    vSum += c.volume;
  }
  return vSum > 0 ? pvSum / vSum : null;
}

export interface ValueArea {
  poc: number;      // point of control — the price bucket with the most volume
  vaHigh: number;   // value area high
  vaLow: number;    // value area low
}

/**
 * Simplified volume profile: buckets the lookback window's price range into
 * `bins` buckets, distributes each candle's volume across the buckets its
 * high-low range touches, then finds POC and the ~70% value area around it.
 */
export function calcValueArea(candles: Candle[], bins = 24): ValueArea | null {
  if (candles.length < 5) return null;
  const high = Math.max(...candles.map(c => c.high));
  const low = Math.min(...candles.map(c => c.low));
  if (high <= low) return null;

  const binSize = (high - low) / bins;
  const volumes = new Array(bins).fill(0);

  for (const c of candles) {
    const startBin = Math.max(0, Math.floor((c.low - low) / binSize));
    const endBin = Math.min(bins - 1, Math.floor((c.high - low) / binSize));
    const span = Math.max(1, endBin - startBin + 1);
    const perBin = c.volume / span;
    for (let b = startBin; b <= endBin; b++) volumes[b] += perBin;
  }

  let pocBin = 0;
  for (let b = 1; b < bins; b++) if (volumes[b] > volumes[pocBin]) pocBin = b;

  const totalVolume = volumes.reduce((a: number, b: number) => a + b, 0);
  const targetVolume = totalVolume * 0.70;

  let loBin = pocBin, hiBin = pocBin, covered = volumes[pocBin];
  while (covered < targetVolume && (loBin > 0 || hiBin < bins - 1)) {
    const nextLo = loBin > 0 ? volumes[loBin - 1] : -1;
    const nextHi = hiBin < bins - 1 ? volumes[hiBin + 1] : -1;
    if (nextHi >= nextLo) { hiBin++; covered += nextHi; }
    else { loBin--; covered += nextLo; }
  }

  return {
    poc: low + (pocBin + 0.5) * binSize,
    vaLow: low + loBin * binSize,
    vaHigh: low + (hiBin + 1) * binSize,
  };
}

/** Standard retracement levels between a swing low and swing high. */
export function calcFibLevels(swingLow: number, swingHigh: number): Record<string, number> {
  const range = swingHigh - swingLow;
  return {
    '0.236': swingHigh - range * 0.236,
    '0.382': swingHigh - range * 0.382,
    '0.5': swingHigh - range * 0.5,
    '0.618': swingHigh - range * 0.618,
    '0.786': swingHigh - range * 0.786,
  };
}
