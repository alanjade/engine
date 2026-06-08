import {
  EMA as TIema,
  RSI as TIrsi,
  ATR as TIatr,
} from 'technicalindicators';

export function calcEMA(closes, period) {
  const result = TIema.calculate({ period, values: closes });
  return result[result.length - 1] ?? null;
}

export function calcRSI(closes, period = 14) {
  const result = TIrsi.calculate({ period, values: closes });
  return result[result.length - 1] ?? null;
}

export function calcATR(candles, period = 14) {
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const result = TIatr.calculate({ period, high: highs, low: lows, close: closes });
  return result[result.length - 1] ?? null;
}

export function calcVolumeSMA(candles, period = 20) {
  const vols = candles.map(c => c.volume).slice(-period);
  if (vols.length < period) return null;
  return vols.reduce((a, b) => a + b, 0) / period;
}

export function emaCrossCount(candles, period1 = 50, period2 = 200, lookback = 20) {
  const recent = candles.slice(-lookback - period2);
  const closes = recent.map(c => c.close);
  let crosses = 0;
  let prev = null;
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
