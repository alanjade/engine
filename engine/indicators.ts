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
