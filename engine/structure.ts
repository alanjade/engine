import type { Candle, Level, SwingPoint, SwingType, StructureAnalysis, StructureBias, StructureEvent } from '../types/index.js';

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

// ── Phase 4: swing structure, BOS/CHoCH, quality score ─────────────────────────

/** Raw alternating swing highs/lows using a symmetric pivot window. */
function findRawSwings(candles: Candle[], pivotStrength = 2): { index: number; timestamp: number; price: number; kind: 'high' | 'low' }[] {
  const points: { index: number; timestamp: number; price: number; kind: 'high' | 'low' }[] = [];

  for (let i = pivotStrength; i < candles.length - pivotStrength; i++) {
    const c = candles[i]!;
    let isHigh = true, isLow = true;
    for (let j = i - pivotStrength; j <= i + pivotStrength; j++) {
      if (j === i) continue;
      const other = candles[j]!;
      if (other.high >= c.high) isHigh = false;
      if (other.low <= c.low) isLow = false;
    }
    if (isHigh) points.push({ index: i, timestamp: c.timestamp, price: c.high, kind: 'high' });
    if (isLow) points.push({ index: i, timestamp: c.timestamp, price: c.low, kind: 'low' });
  }

  // Enforce strict alternation: when two same-kind pivots occur back-to-back
  // (common with noisy data), keep only the more extreme one.
  points.sort((a, b) => a.index - b.index);
  const alternating: typeof points = [];
  for (const p of points) {
    const last = alternating[alternating.length - 1];
    if (last && last.kind === p.kind) {
      const keepNew = p.kind === 'high' ? p.price > last.price : p.price < last.price;
      if (keepNew) alternating[alternating.length - 1] = p;
    } else {
      alternating.push(p);
    }
  }
  return alternating;
}

/** Labels each swing HH/HL/LH/LL relative to the previous swing of the same kind. */
export function findSwingPoints(candles: Candle[], pivotStrength = 2): SwingPoint[] {
  const raw = findRawSwings(candles, pivotStrength);
  const result: SwingPoint[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;

  for (const p of raw) {
    let label: SwingType;
    if (p.kind === 'high') {
      label = lastHigh === null || p.price > lastHigh ? 'HH' : 'LH';
      lastHigh = p.price;
    } else {
      label = lastLow === null || p.price > lastLow ? 'HL' : 'LL';
      lastLow = p.price;
    }
    result.push({ index: p.index, timestamp: p.timestamp, price: p.price, kind: p.kind, label });
  }
  return result;
}

/**
 * Full structure read: bias, most recent BOS/CHoCH, invalidation level,
 * swing strength, structure age, and a composite quality score.
 *
 * BOS (break of structure) = a close beyond the prior major swing point
 * *in the direction of the established bias* — continuation.
 * CHoCH (change of character) = a close beyond the prior major swing point
 * *against* the established bias — the first sign of reversal.
 */
export function analyzeStructure(candles: Candle[], pivotStrength = 2): StructureAnalysis {
  const swings = findSwingPoints(candles, pivotStrength);

  if (swings.length < 4) {
    return {
      swings, bias: 'UNDEFINED', lastEvent: 'NONE', lastEventIndex: null,
      structureAge: candles.length, invalidationLevel: null, swingStrength: 0, qualityScore: 0,
    };
  }

  // Establish bias from the two most recent swings of each kind.
  const highs = swings.filter(s => s.kind === 'high');
  const lows = swings.filter(s => s.kind === 'low');
  const lastHigh = highs[highs.length - 1]!;
  const lastLow = lows[lows.length - 1]!;

  let bias: StructureBias = 'UNDEFINED';
  if (lastHigh.label === 'HH' && lastLow.label === 'HL') bias = 'BULLISH';
  else if (lastHigh.label === 'LH' && lastLow.label === 'LL') bias = 'BEARISH';

  // Walk forward through candles after the last two swings to find the most
  // recent close that broke the relevant swing level (BOS in bias direction,
  // CHoCH against it).
  let lastEvent: StructureEvent = 'NONE';
  let lastEventIndex: number | null = null;
  const refIndex = Math.max(lastHigh.index, lastLow.index);

  for (let i = refIndex + 1; i < candles.length; i++) {
    const close = candles[i]!.close;
    if (bias === 'BULLISH') {
      if (close > lastHigh.price) { lastEvent = 'BULLISH_BOS'; lastEventIndex = i; }
      else if (close < lastLow.price) { lastEvent = 'BEARISH_CHOCH'; lastEventIndex = i; break; }
    } else if (bias === 'BEARISH') {
      if (close < lastLow.price) { lastEvent = 'BEARISH_BOS'; lastEventIndex = i; }
      else if (close > lastHigh.price) { lastEvent = 'BULLISH_CHOCH'; lastEventIndex = i; break; }
    }
  }

  const invalidationLevel = bias === 'BULLISH' ? lastLow.price : bias === 'BEARISH' ? lastHigh.price : null;
  const swingStrength = lastLow.price > 0 ? Math.abs((lastHigh.price - lastLow.price) / lastLow.price) * 100 : 0;
  const structureAge = candles.length - 1 - (lastEventIndex ?? refIndex);

  const qualityScore = calcStructureQuality({ bias, lastEvent, structureAge, swingStrength, swingCount: swings.length });

  return {
    swings, bias, lastEvent, lastEventIndex,
    structureAge, invalidationLevel,
    swingStrength: Math.round(swingStrength * 100) / 100,
    qualityScore,
  };
}

function calcStructureQuality(input: {
  bias: StructureBias; lastEvent: StructureEvent; structureAge: number; swingStrength: number; swingCount: number;
}): number {
  const { bias, lastEvent, structureAge, swingStrength, swingCount } = input;
  let score = 0;

  if (bias !== 'UNDEFINED') score += 30;
  if (lastEvent === 'BULLISH_BOS' || lastEvent === 'BEARISH_BOS') score += 25; // continuation confirms the bias
  if (lastEvent === 'BULLISH_CHOCH' || lastEvent === 'BEARISH_CHOCH') score -= 15; // reversal undermines confidence in the old bias

  // Fresher structure scores higher; decays over ~40 candles.
  score += Math.max(0, 25 - structureAge * 0.6);

  // Reasonable leg amplitude (2-15%) scores higher than near-zero or extreme swings.
  if (swingStrength >= 2 && swingStrength <= 15) score += 20;
  else if (swingStrength > 0) score += 8;

  score += Math.min(10, swingCount); // more confirmed swings = more reliable read

  return Math.round(Math.min(100, Math.max(0, score)));
}
