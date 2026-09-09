import { calcEMA, calcATR } from './indicators.js';
import type { Candle, MarketRegime, RegimeResult } from '../types/index.js';

// Thresholds are on the same scale as the rest of the engine's config
// (percent values, not fractions) to stay consistent with signal.ts.
const SLOPE_STRONG = 1.5;   // % EMA50 change over the lookback window
const SLOPE_WEAK = 0.4;
const EMA_DIST_TREND_MIN = 0.8; // % — below this, EMA50/200 are too close to call a trend
const COMPRESSION_ATR_PCT = 0.8; // % ATR relative to price — below this, volatility is contracting
const HIGH_VOL_ATR_PCT = 4.0;    // % ATR relative to price — above this, volatility itself is the regime

export function detectRegime(candles: Candle[], lookback = 20): RegimeResult {
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1]!;

  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const atr = calcATR(candles, 14);
  const atrPct = atr ? (atr / price) * 100 : 0;

  const priorCloses = closes.slice(0, -lookback);
  const ema50Prior = priorCloses.length >= 50 ? calcEMA(priorCloses, 50) : null;
  const emaSlope = ema50 && ema50Prior ? ((ema50 - ema50Prior) / ema50Prior) * 100 : 0;
  const emaDistPct = ema50 && ema200 ? ((ema50 - ema200) / ema200) * 100 : 0;
  // Survives even when slope-based classification falls through to RANGE —
  // a pullback flattens/dips the recent EMA50 slope without the underlying
  // EMA alignment (the actual trend) having changed. Fixes a real conflict
  // with the pullback setup (Phase 5): that setup specifically targets a
  // pullback inside an uptrend, but the regime gate was rejecting exactly
  // that condition because slope alone can't distinguish "pullback" from
  // "no longer trending".
  const emaBullish = ema50 !== null && ema200 !== null && ema50 > ema200 && emaDistPct >= EMA_DIST_TREND_MIN;

  // Volatility-driven regimes take priority: a compression or high-vol regime
  // makes trend direction unreliable regardless of where EMAs sit.
  if (atr && atrPct <= COMPRESSION_ATR_PCT) {
    return build('COMPRESSION', strengthFromDistance(COMPRESSION_ATR_PCT, atrPct, COMPRESSION_ATR_PCT), atrPct, emaSlope, emaDistPct, emaBullish);
  }
  if (atr && atrPct >= HIGH_VOL_ATR_PCT) {
    return build('HIGH_VOLATILITY', strengthFromDistance(HIGH_VOL_ATR_PCT, atrPct, HIGH_VOL_ATR_PCT * 1.5), atrPct, emaSlope, emaDistPct, emaBullish);
  }

  if (!ema50 || !ema200) {
    return build('RANGE', 30, atrPct, emaSlope, emaDistPct, false);
  }

  const bullish = emaBullish;
  const bearish = ema50 < ema200 && emaDistPct <= -EMA_DIST_TREND_MIN;

  if (bullish && emaSlope >= SLOPE_STRONG) {
    return build('STRONG_UPTREND', strengthFromDistance(SLOPE_STRONG, emaSlope, SLOPE_STRONG * 2), atrPct, emaSlope, emaDistPct, emaBullish);
  }
  if (bullish && emaSlope >= SLOPE_WEAK) {
    return build('WEAK_UPTREND', strengthFromDistance(SLOPE_WEAK, emaSlope, SLOPE_STRONG), atrPct, emaSlope, emaDistPct, emaBullish);
  }
  if (bearish && emaSlope <= -SLOPE_STRONG) {
    return build('STRONG_DOWNTREND', strengthFromDistance(SLOPE_STRONG, -emaSlope, SLOPE_STRONG * 2), atrPct, emaSlope, emaDistPct, emaBullish);
  }
  if (bearish && emaSlope <= -SLOPE_WEAK) {
    return build('WEAK_DOWNTREND', strengthFromDistance(SLOPE_WEAK, -emaSlope, SLOPE_STRONG), atrPct, emaSlope, emaDistPct, emaBullish);
  }

  return build('RANGE', strengthFromDistance(0, EMA_DIST_TREND_MIN - Math.abs(emaDistPct), EMA_DIST_TREND_MIN), atrPct, emaSlope, emaDistPct, emaBullish);
}

/** Maps how far a value sits past a threshold into a 0-100 confidence score, clamped. */
function strengthFromDistance(threshold: number, value: number, saturateAt: number): number {
  if (saturateAt === threshold) return 50;
  const span = saturateAt - threshold;
  const progress = (value - threshold) / span;
  return Math.round(Math.min(100, Math.max(30, 50 + progress * 50)));
}

function build(regime: MarketRegime, strength: number, atrPct: number, emaSlope: number, emaDistPct: number, emaBullish: boolean): RegimeResult {
  return { regime, strength, atrPct: round2(atrPct), emaSlope: round2(emaSlope), emaDistPct: round2(emaDistPct), emaBullish };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Filters for downstream use (Phase 3 TODO: "use regime as a trade filter") ──

const TRADABLE_LONG_REGIMES: MarketRegime[] = ['STRONG_UPTREND', 'WEAK_UPTREND'];

/**
 * A RANGE read with underlying bullish EMA alignment is treated as tradable
 * too — this is what lets a pullback (which flattens short-term slope
 * without breaking the actual trend) through the gate instead of being
 * hard-rejected before the pullback setup logic ever runs.
 */
export function isTradableForLong(result: RegimeResult): boolean {
  return TRADABLE_LONG_REGIMES.includes(result.regime) || (result.regime === 'RANGE' && result.emaBullish);
}

/** 0-1 multiplier for entry scoring (Phase 3 TODO: "use regime in entry scoring"). */
export function regimeScoreMultiplier(result: RegimeResult): number {
  switch (result.regime) {
    case 'STRONG_UPTREND': return 1.0;
    case 'WEAK_UPTREND': return 0.7 + (result.strength / 100) * 0.3;
    case 'RANGE': return result.emaBullish ? 0.5 : 0.3; // bullish-aligned pullback scores higher than a genuine range
    case 'COMPRESSION': return 0.4; // pre-breakout, not yet directional
    case 'WEAK_DOWNTREND':
    case 'STRONG_DOWNTREND':
    case 'HIGH_VOLATILITY':
      return 0;
  }
}
