import { calcEMA, calcATR, calcVolumeSMA } from './indicators.js';
import { findSupports, findResistances, analyzeStructure } from './structure.js';
import { isBullishRejection, hasConfirmationPattern, isDisplacementCandle } from './candles.js';
import type { Candle, SetupResult } from '../types/index.js';

function notDetected(kind: SetupResult['kind'], reason: string): SetupResult {
  return { kind, detected: false, quality: 0, reason };
}

function clampScore(n: number): number {
  return Math.round(Math.min(100, Math.max(0, n)));
}

// ── Pullback Setup ──────────────────────────────────────────────────────────
//
// Established uptrend pulls back to a moving average or prior support,
// holds structure, and shows a rejection candle back in the trend direction.

export function detectPullback(candles: Candle[]): SetupResult {
  const kind = 'PULLBACK' as const;
  if (candles.length < 210) return notDetected(kind, 'Insufficient candles for EMA200.');

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1]!;
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  if (!ema20 || !ema50 || !ema200) return notDetected(kind, 'EMA calculation failed.');

  const establishedTrend = ema50 > ema200 && ema20 > ema50 * 0.98;
  if (!establishedTrend) return notDetected(kind, 'No established uptrend (EMA50/200 not aligned).');

  const recentHigh = Math.max(...candles.slice(-20).map(c => c.high));
  const pulledBack = price < recentHigh * 0.995 && price > recentHigh * 0.85;
  if (!pulledBack) return notDetected(kind, 'Price not in a pullback range from recent high.');

  const distFromEma20 = Math.abs((price - ema20) / ema20) * 100;
  const distFromEma50 = Math.abs((price - ema50) / ema50) * 100;
  const nearEma = distFromEma20 <= 2.5 || distFromEma50 <= 2.5;
  const supports = findSupports(candles, 60);
  const nearSupport = supports.some(s => Math.abs((price - s.price) / s.price) * 100 <= 2.5);
  if (!nearEma && !nearSupport) return notDetected(kind, 'Price not interacting with EMA20/50 or a support level.');

  const structure = analyzeStructure(candles, 2);
  const structureIntact = structure.bias !== 'BEARISH' && structure.lastEvent !== 'BEARISH_CHOCH';
  if (!structureIntact) return notDetected(kind, 'Structure broken (bearish CHoCH) — pullback invalidated.');

  const lastCandle = candles[candles.length - 1]!;
  const hasRejection = isBullishRejection(lastCandle) || hasConfirmationPattern(candles);
  if (!hasRejection) return notDetected(kind, 'No rejection candle at pullback zone yet.');

  let quality = 40;
  if (nearEma) quality += 15;
  if (nearSupport) quality += 15;
  if (structure.bias === 'BULLISH') quality += 15;
  if (distFromEma20 <= 1) quality += 10;
  if (isBullishRejection(lastCandle)) quality += 5;

  return { kind, detected: true, quality: clampScore(quality), reason: 'Pullback to EMA/support with rejection in an established uptrend.' };
}

// ── Breakout + Retest ─────────────────────────────────────────────────────────
//
// Resistance breaks on a displacement candle with volume expansion, price
// comes back to retest the broken level, and the retest holds.

export function detectBreakoutRetest(candles: Candle[]): SetupResult {
  const kind = 'BREAKOUT_RETEST' as const;
  if (candles.length < 60) return notDetected(kind, 'Insufficient candles.');

  const resistances = findResistances(candles.slice(0, -10), 60); // level established before the recent window
  if (!resistances.length) return notDetected(kind, 'No prior resistance level found.');

  // The level actually broken is the highest overhead resistance that price
  // genuinely closed above within the recent window — not the single
  // highest resistance ever found (wrong with multiple stacked levels), not
  // "nearest by raw distance" (wrong when price sits far below every
  // candidate), and not "most-touched overhead level" either (a heavily-
  // touched level price hasn't actually reached yet is still the wrong
  // pick). Filtering to genuinely-broken overhead levels and taking the
  // highest of those is what "the breakout level" actually means: the
  // ceiling price demonstrably overcame, not just any level historically
  // above it or one that merely has a lot of touches.
  const priceBeforeWindow = candles[candles.length - 11]!.close;
  const recentMaxClose = Math.max(...candles.slice(-10).map(c => c.close));
  const overhead = resistances.filter(r => r.price > priceBeforeWindow);
  const broken = overhead.filter(r => r.price < recentMaxClose);
  const level = broken.length
    ? broken.reduce((max, r) => (r.price > max.price ? r : max))
    : overhead.length
      ? overhead.reduce((min, r) => (r.price < min.price ? r : min)) // fallback: nothing confirmed broken yet — nearest candidate
      : resistances.reduce((max, r) => (r.price > max.price ? r : max)); // fallback: nothing was overhead (shouldn't normally happen)
  const recent = candles.slice(-10);

  // Find the breakout candle: first close in the recent window above the level.
  const breakoutIdx = recent.findIndex(c => c.close > level.price);
  if (breakoutIdx === -1) return notDetected(kind, 'No breakout above resistance in the recent window.');
  const breakoutCandle = recent[breakoutIdx]!;

  const body = Math.abs(breakoutCandle.close - breakoutCandle.open);
  const range = breakoutCandle.high - breakoutCandle.low;
  if (!isDisplacementCandle(breakoutCandle, 0.6)) return notDetected(kind, 'Breakout candle lacks displacement (body too small vs range).');

  const volSMA = calcVolumeSMA(candles.slice(0, candles.length - (10 - breakoutIdx)), 20);
  const volumeExpanded = !!volSMA && breakoutCandle.volume / volSMA >= 1.3;
  if (!volumeExpanded) return notDetected(kind, 'No volume expansion on breakout candle.');

  const afterBreakout = recent.slice(breakoutIdx + 1);
  if (!afterBreakout.length) return notDetected(kind, 'Breakout just occurred — no retest candles yet.');

  const retested = afterBreakout.some(c => c.low <= level.price * 1.005 && c.low >= level.price * 0.98);
  if (!retested) return notDetected(kind, 'Price has not retested the breakout level yet.');

  const lastCandle = candles[candles.length - 1]!;
  const retestHolds = lastCandle.close > level.price * 0.995 && (isBullishRejection(lastCandle) || lastCandle.close > lastCandle.open);
  if (!retestHolds) return notDetected(kind, 'Retest has not held — price below breakout level without reclaim.');

  let quality = 45;
  if (body / range >= 0.75) quality += 10;
  if (volSMA && breakoutCandle.volume / volSMA >= 1.8) quality += 15;
  if (isBullishRejection(lastCandle)) quality += 15;
  quality += Math.min(15, afterBreakout.length * 3); // more time holding = more confirmed

  return { kind, detected: true, quality: clampScore(quality), reason: `Breakout above ${level.price.toFixed(4)} retested and held.` };
}

// ── Liquidity Sweep ───────────────────────────────────────────────────────────
//
// Price wicks through a liquidity pool (equal highs/lows or a swing extreme),
// then reclaims back inside — a stop-hunt followed by reversal.

export function detectLiquiditySweep(candles: Candle[]): SetupResult {
  const kind = 'LIQUIDITY_SWEEP' as const;
  if (candles.length < 60) return notDetected(kind, 'Insufficient candles.');

  const priorCandles = candles.slice(0, -5);
  const supports = findSupports(priorCandles, 60);
  if (!supports.length) return notDetected(kind, 'No swing-low liquidity pool found.');

  const recent = candles.slice(-5);
  // Mirrors the resistance fix above: the pool actually swept is the
  // lowest underfoot support that price genuinely wicked below within the
  // recent window — not the globally lowest support, and not just any
  // level below price that hasn't actually been touched yet.
  const priceBeforeWindow = candles[candles.length - 6]!.close;
  const recentMinLow = Math.min(...candles.slice(-5).map(c => c.low));
  const underfoot = supports.filter(s => s.price < priceBeforeWindow);
  const swept = underfoot.filter(s => s.price > recentMinLow);
  const pool = swept.length
    ? swept.reduce((min, s) => (s.price < min.price ? s : min))
    : underfoot.length
      ? underfoot.reduce((max, s) => (s.price > max.price ? s : max)) // fallback: nothing confirmed swept yet — nearest candidate
      : supports.reduce((min, s) => (s.price < min.price ? s : min)); // fallback: nothing was underfoot (shouldn't normally happen)

  const sweepCandle = recent.find(c => c.low < pool.price);
  if (!sweepCandle) return notDetected(kind, 'No wick below the liquidity pool in the recent window.');

  const wickPenetration = ((pool.price - sweepCandle.low) / pool.price) * 100;
  if (wickPenetration <= 0 || wickPenetration > 3) return notDetected(kind, 'Wick penetration out of range (0-3%) for a clean sweep.');

  const reclaimed = candles[candles.length - 1]!.close > pool.price;
  if (!reclaimed) return notDetected(kind, 'Price swept liquidity but has not reclaimed the level yet.');

  const range = sweepCandle.high - sweepCandle.low;
  const bodyPos = range > 0 ? (sweepCandle.close - sweepCandle.low) / range : 0;
  const rejectionStrength = bodyPos; // higher = closed further from the wick, stronger rejection
  const cleanRejection = isBullishRejection(sweepCandle) || rejectionStrength >= 0.6;
  if (!cleanRejection) return notDetected(kind, 'No clear rejection off the swept level.');

  let quality = 40;
  quality += Math.min(20, pool.count * 5); // more equal-low touches = stronger liquidity pool
  if (wickPenetration >= 0.3 && wickPenetration <= 1.5) quality += 15; // clean sweep, not a crash-through
  quality += Math.round(rejectionStrength * 20);
  if (isBullishRejection(sweepCandle)) quality += 10;

  return {
    kind, detected: true, quality: clampScore(quality),
    reason: `Swept liquidity below ${pool.price.toFixed(4)} (${wickPenetration.toFixed(2)}% wick), reclaimed with rejection.`,
  };
}

// ── Compression Breakout ──────────────────────────────────────────────────────
//
// Volatility contracts into a tight range, pressure builds (declining ATR),
// then price breaks the range with volume expansion.

export function detectCompressionBreakout(candles: Candle[]): SetupResult {
  const kind = 'COMPRESSION_BREAKOUT' as const;
  if (candles.length < 60) return notDetected(kind, 'Insufficient candles.');

  const price = candles[candles.length - 1]!.close;
  const atrNow = calcATR(candles, 14);
  const atrPrior = calcATR(candles.slice(0, -10), 14);
  if (!atrNow || !atrPrior) return notDetected(kind, 'ATR calculation failed.');

  const contracting = atrNow < atrPrior * 0.85;
  const atrPctNow = (atrNow / price) * 100;
  const tight = atrPctNow <= 1.2;
  if (!contracting && !tight) return notDetected(kind, 'No volatility contraction detected.');

  const rangeWindow = candles.slice(-15, -1); // exclude the current (potential breakout) candle
  const rangeHigh = Math.max(...rangeWindow.map(c => c.high));
  const rangeLow = Math.min(...rangeWindow.map(c => c.low));
  const rangeWidthPct = ((rangeHigh - rangeLow) / rangeLow) * 100;
  const isTightRange = rangeWidthPct <= 6;
  if (!isTightRange) return notDetected(kind, `Range too wide (${rangeWidthPct.toFixed(2)}%) to call compression.`);

  const lastCandle = candles[candles.length - 1]!;
  const brokeOut = lastCandle.close > rangeHigh;
  if (!brokeOut) return notDetected(kind, 'No breakout beyond the compressed range yet.');

  const volSMA = calcVolumeSMA(candles.slice(0, -1), 20);
  const volumeExpanded = !!volSMA && lastCandle.volume / volSMA >= 1.4;
  if (!volumeExpanded) return notDetected(kind, 'Breakout lacks volume expansion.');

  let quality = 40;
  if (contracting) quality += 15;
  if (atrPctNow <= 0.8) quality += 10;
  if (rangeWidthPct <= 3) quality += 15;
  if (volSMA && lastCandle.volume / volSMA >= 2) quality += 15;
  quality += Math.min(5, Math.round((atrPrior / atrNow - 1) * 10));

  return {
    kind, detected: true, quality: clampScore(quality),
    reason: `Compression breakout above ${rangeHigh.toFixed(4)} (range ${rangeWidthPct.toFixed(2)}%) with volume expansion.`,
  };
}

// ── Convenience: run all four and return only what fired ───────────────────────

export function detectAllSetups(candles: Candle[]): SetupResult[] {
  return [
    detectPullback(candles),
    detectBreakoutRetest(candles),
    detectLiquiditySweep(candles),
    detectCompressionBreakout(candles),
  ].filter(r => r.detected);
}
