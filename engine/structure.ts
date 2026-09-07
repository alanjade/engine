import type { Candle, Level } from '../types/index.js';

const TOLERANCE = 0.005;

function cluster(levels: number[]): Level[] {
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: Level[] = [];
  for (const price of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(price - last.price) / last.price < TOLERANCE) {
      last.count++;
      last.price = (last.price * (last.count - 1) + price) / last.count;
    } else clusters.push({ price, count: 1 });
  }
  return clusters;
}

export function findSupports(candles: Candle[], lookback = 50): Level[] {
  const slice = candles.slice(-lookback);
  const pivots: number[] = [];
  for (let i = 1; i < slice.length - 1; i++) {
    const cur = slice[i]!, before = slice[i - 1]!, after = slice[i + 1]!;
    if (cur.low < before.low && cur.low < after.low) pivots.push(cur.low);
  }
  return cluster(pivots).filter(s => s.count >= 2);
}

export function findResistances(candles: Candle[], lookback = 50): Level[] {
  const slice = candles.slice(-lookback);
  const pivots: number[] = [];
  for (let i = 1; i < slice.length - 1; i++) {
    const cur = slice[i]!, before = slice[i - 1]!, after = slice[i + 1]!;
    if (cur.high > before.high && cur.high > after.high) pivots.push(cur.high);
  }
  return cluster(pivots).filter(r => r.count >= 2);
}

export function nearestSupport(candles: Candle[], currentPrice: number, lookback = 50): Level | null {
  const below = findSupports(candles, lookback).filter(s => s.price <= currentPrice * 1.02);
  below.sort((a, b) => b.price - a.price);
  return below[0] ?? null;
}

export function nearestResistance(candles: Candle[], currentPrice: number, lookback = 50): Level | null {
  const above = findResistances(candles, lookback).filter(r => r.price > currentPrice);
  above.sort((a, b) => a.price - b.price);
  return above[0] ?? null;
}

export const supportScore = (support: Level | null): number => support?.count ?? 0;
export const resistanceScore = (resistance: Level | null): number => resistance?.count ?? 0;
