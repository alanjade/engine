import { calcEMA, calcATR, calcRSI } from './indicators.js';
import type { Candle, ChaseAnalysis, ChaseFlags } from '../types/index.js';

const MAX_EMA20_DIST_PCT = 6;
const MAX_EMA50_DIST_PCT = 10;
const MAX_SUPPORT_DIST_PCT = 8;
const MAX_BREAKOUT_DIST_PCT = 5;
const LARGE_CANDLE_ATR_MULTIPLE = 2.5;
const MAX_24H_MOVE_PCT = 15;
const RSI_OVEREXTENDED = 78;
const RR_DETERIORATION_RATIO = 0.7; // current RR below 70% of the RR at signal time counts as deteriorating

function pctDistance(price: number, level: number): number {
  return Math.abs((price - level) / level) * 100;
}

export function detectExcessiveEmaDistance(price: number, ema: number, maxPct: number): boolean {
  return pctDistance(price, ema) > maxPct && price > ema; // only chasing if price has run away above the EMA
}

export function detectExcessiveSupportDistance(price: number, supportPrice: number, maxPct = MAX_SUPPORT_DIST_PCT): boolean {
  return price > supportPrice && pctDistance(price, supportPrice) > maxPct;
}

export function detectExcessiveBreakoutDistance(price: number, breakoutLevel: number, maxPct = MAX_BREAKOUT_DIST_PCT): boolean {
  return price > breakoutLevel && pctDistance(price, breakoutLevel) > maxPct;
}

/** The most recent candle's range is unusually large relative to typical volatility — a blow-off/FOMO candle. */
export function detectLargeCandle(candles: Candle[], multiple = LARGE_CANDLE_ATR_MULTIPLE): boolean {
  if (candles.length < 15) return false;
  const atr = calcATR(candles, 14);
  if (!atr) return false;
  const last = candles[candles.length - 1]!;
  return (last.high - last.low) > atr * multiple;
}

/** Cumulative % move over the given number of candles (e.g. 6 candles of 4H = 24H). */
export function detectExcessive24hMove(candles: Candle[], candlesPerDay: number, maxPct = MAX_24H_MOVE_PCT): boolean {
  if (candles.length < candlesPerDay + 1) return false;
  const window = candles.slice(-(candlesPerDay + 1));
  const start = window[0]!.close;
  const end = window[window.length - 1]!.close;
  const movePct = ((end - start) / start) * 100;
  return movePct > maxPct;
}

export function detectOverextendedRSI(rsi: number, threshold = RSI_OVEREXTENDED): boolean {
  return rsi >= threshold;
}

/** RR has shrunk meaningfully since the setup was first identified — price has already run, less edge left. */
export function detectDeterioratingRR(currentRR: number, originalRR: number, ratio = RR_DETERIORATION_RATIO): boolean {
  if (originalRR <= 0) return false;
  return currentRR < originalRR * ratio;
}

export interface ChaseInput {
  candles: Candle[];
  candlesPerDay: number; // e.g. 6 for 4H candles, 1 for 1D
  support?: number;
  breakoutLevel?: number;
  currentRR?: number;
  originalRR?: number;
}

const FLAG_WEIGHTS: Record<keyof ChaseFlags, number> = {
  excessiveEma20Distance: 15,
  excessiveEma50Distance: 15,
  excessiveSupportDistance: 15,
  excessiveBreakoutDistance: 15,
  largeRecentCandle: 15,
  excessive24hMove: 15,
  overextendedRSI: 15,
  deterioratingRR: 15,
};

const BLOCK_THRESHOLD = 45; // 3+ flags firing simultaneously blocks the entry

export function analyzeChase(input: ChaseInput): ChaseAnalysis | null {
  const { candles, candlesPerDay, support, breakoutLevel, currentRR, originalRR } = input;
  if (candles.length < 60) return null;

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1]!;
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes, 14);

  const flags: ChaseFlags = {
    excessiveEma20Distance: ema20 !== null && detectExcessiveEmaDistance(price, ema20, MAX_EMA20_DIST_PCT),
    excessiveEma50Distance: ema50 !== null && detectExcessiveEmaDistance(price, ema50, MAX_EMA50_DIST_PCT),
    excessiveSupportDistance: support !== undefined && detectExcessiveSupportDistance(price, support),
    excessiveBreakoutDistance: breakoutLevel !== undefined && detectExcessiveBreakoutDistance(price, breakoutLevel),
    largeRecentCandle: detectLargeCandle(candles),
    excessive24hMove: detectExcessive24hMove(candles, candlesPerDay),
    overextendedRSI: rsi !== null && detectOverextendedRSI(rsi),
    deterioratingRR: currentRR !== undefined && originalRR !== undefined && detectDeterioratingRR(currentRR, originalRR),
  };

  const reasons: string[] = [];
  let score = 0;
  for (const key of Object.keys(flags) as (keyof ChaseFlags)[]) {
    if (flags[key]) {
      score += FLAG_WEIGHTS[key];
      reasons.push(key);
    }
  }
  score = Math.min(100, score);

  return { flags, score, blocked: score >= BLOCK_THRESHOLD, reasons };
}

export function chaseLabel(analysis: ChaseAnalysis): string {
  return analysis.blocked ? 'DO NOT CHASE' : analysis.score > 0 ? 'CAUTION' : 'CLEAR';
}
