import { calcEMA, calcATR, calcVWAP, calcValueArea, calcFibLevels } from './indicators.js';
import { findSupports, findResistances } from './structure.js';
import type { Candle, EntryLocationResult, EntryZone } from '../types/index.js';

/** Maps a % distance to a 0-1 score: 1 at distance=0, decaying to 0 at maxDistancePct. */
function proximityScore(distancePct: number, maxDistancePct: number): number {
  if (distancePct >= maxDistancePct) return 0;
  return 1 - distancePct / maxDistancePct;
}

function pctDistance(price: number, level: number): number {
  return Math.abs((price - level) / level) * 100;
}

/**
 * Composite entry-location score (0-100) plus three concrete entry zones.
 * `stopLoss` and `takeProfit` are optional — when supplied, current RR
 * factors into the score; omit them to score location alone.
 */
export function scoreEntryLocation(
  candles: Candle[],
  opts: { lookback?: number; stopLoss?: number; takeProfit?: number } = {},
): EntryLocationResult | null {
  const lookback = opts.lookback ?? 80;
  if (candles.length < Math.max(lookback, 60)) return null;

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1]!;
  const window = candles.slice(-lookback);

  const recentHigh = Math.max(...window.map(c => c.high));
  const recentLow = Math.min(...window.map(c => c.low));

  const support = findSupports(candles, lookback).filter(s => s.price <= price).sort((a, b) => b.price - a.price)[0] ?? null;
  const resistance = findResistances(candles, lookback).filter(r => r.price >= price).sort((a, b) => a.price - b.price)[0] ?? null;
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const vwap = calcVWAP(window);
  const valueArea = calcValueArea(window);
  const fib = calcFibLevels(recentLow, recentHigh);

  const supportProximity = support ? proximityScore(pctDistance(price, support.price), 3) : 0;
  const resistanceProximity = resistance ? proximityScore(pctDistance(price, resistance.price), 3) : 0;
  const ema20Proximity = ema20 ? proximityScore(pctDistance(price, ema20), 2) : 0;
  const ema50Proximity = ema50 ? proximityScore(pctDistance(price, ema50), 2.5) : 0;

  const fibDistances = Object.values(fib).map(level => pctDistance(price, level));
  const fibProximity = proximityScore(Math.min(...fibDistances), 1.5);

  // Value-area context: reward sitting inside the value area or right at the
  // low (support-like); the POC itself is the single strongest reference.
  let valueAreaContext = 0;
  if (valueArea) {
    if (price >= valueArea.vaLow && price <= valueArea.vaHigh) valueAreaContext = 0.6;
    const pocProx = proximityScore(pctDistance(price, valueArea.poc), 2);
    valueAreaContext = Math.max(valueAreaContext, pocProx);
  }

  const distFromRecentHighPct = pctDistance(price, recentHigh);
  const distFromRecentLowPct = pctDistance(price, recentLow);

  let riskRewardScore = 0;
  if (opts.stopLoss !== undefined && opts.takeProfit !== undefined) {
    const risk = price - opts.stopLoss;
    const reward = opts.takeProfit - price;
    if (risk > 0) riskRewardScore = Math.min(1, Math.max(0, (reward / risk) / 3)); // saturates at RR=3
  }

  // Weighted composite — support/resistance and RR carry the most weight
  // since they're the most decision-relevant for where to actually enter.
  const score =
    supportProximity * 22 +
    resistanceProximity * 8 + // being near resistance is a mild negative context, not scored as a positive elsewhere
    ema20Proximity * 15 +
    ema50Proximity * 10 +
    fibProximity * 12 +
    valueAreaContext * 13 +
    (1 - Math.min(1, distFromRecentHighPct / 15)) * 5 +
    riskRewardScore * 15;

  const atr = calcATR(candles, 14) ?? price * 0.02;
  const zones = generateEntryZones(price, support, atr);

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    components: {
      supportProximity: round2(supportProximity * 100),
      resistanceProximity: round2(resistanceProximity * 100),
      ema20Proximity: round2(ema20Proximity * 100),
      ema50Proximity: round2(ema50Proximity * 100),
      fibProximity: round2(fibProximity * 100),
      valueAreaContext: round2(valueAreaContext * 100),
      distFromRecentHighPct: round2(distFromRecentHighPct),
      distFromRecentLowPct: round2(distFromRecentLowPct),
      riskRewardScore: round2(riskRewardScore * 100),
    },
    zones,
  };
}

/**
 * Three entry zones at increasing distance from current price:
 * - AGGRESSIVE: current price — enter now, no pullback wait
 * - BALANCED: partway toward the nearest support (~1x ATR back)
 * - CONSERVATIVE: at or near the nearest support itself
 */
function generateEntryZones(price: number, support: { price: number } | null, atr: number): EntryZone[] {
  const aggressive: EntryZone = { name: 'AGGRESSIVE', price, distanceFromPricePct: 0 };

  const balancedPrice = support
    ? Math.max(support.price, price - atr)
    : price - atr;
  const balanced: EntryZone = {
    name: 'BALANCED', price: round2(balancedPrice), distanceFromPricePct: round2(pctDistance(price, balancedPrice)),
  };

  const conservativePrice = support ? support.price : price - atr * 2;
  const conservative: EntryZone = {
    name: 'CONSERVATIVE', price: round2(conservativePrice), distanceFromPricePct: round2(pctDistance(price, conservativePrice)),
  };

  return [aggressive, balanced, conservative];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
