import { calcEMA, calcRSI, calcATR, calcVolumeSMA, emaCrossCount } from './indicators.js';
import { nearestSupport, nearestResistance, supportScore, resistanceScore } from './structure.js';
import { hasConfirmationPattern, isBearishRejection } from './candles.js';
import { calcConfidence } from './confidence.js';
import { calcStopLoss, calcPositionSize } from './risk.js';
import { ENV } from '../utils/env.js';
import type {
  Candle, SymbolConfig, Position, EvaluateInput, EvaluateResult, SellEvaluateResult,
} from '../types/index.js';

// ── Per-symbol configuration ──────────────────────────────────────────────────
const SYMBOL_CONFIG: Record<string, SymbolConfig> = {
  'BTC/USDT':  { atrMin: 0.6, emaDistMin: 1.2, rsiMin: 52, rsiMax: 72, supportLookback: 120, supProximity: 2.5, minRR: 1.5, volRatioMin: 1.2,  maxRiskPct: 0.05 },
  'ETH/USDT':  { atrMin: 0.8, emaDistMin: 1.0, rsiMin: 50, rsiMax: 73, supportLookback: 100, supProximity: 2.8, minRR: 1.5, volRatioMin: 1.15, maxRiskPct: 0.06 },
  'BNB/USDT':  { atrMin: 0.9, emaDistMin: 1.0, rsiMin: 50, rsiMax: 73, supportLookback: 100, supProximity: 3.0, minRR: 1.4, volRatioMin: 1.1,  maxRiskPct: 0.06 },
  'XRP/USDT':  { atrMin: 1.0, emaDistMin: 0.8, rsiMin: 48, rsiMax: 74, supportLookback: 100, supProximity: 3.0, minRR: 1.5, volRatioMin: 1.15, maxRiskPct: 0.07 },
  'DOGE/USDT': { atrMin: 1.5, emaDistMin: 0.7, rsiMin: 46, rsiMax: 74, supportLookback: 80,  supProximity: 4.0, minRR: 1.6, volRatioMin: 1.2,  maxRiskPct: 0.09 },
  'ADA/USDT':  { atrMin: 1.0, emaDistMin: 0.8, rsiMin: 48, rsiMax: 73, supportLookback: 100, supProximity: 3.0, minRR: 1.5, volRatioMin: 1.1,  maxRiskPct: 0.07 },
  'AVAX/USDT': { atrMin: 1.5, emaDistMin: 0.8, rsiMin: 48, rsiMax: 74, supportLookback: 80,  supProximity: 3.5, minRR: 1.5, volRatioMin: 1.1,  maxRiskPct: 0.08 },
  'GRAM/USDT': { atrMin: 1.5, emaDistMin: 0.6, rsiMin: 46, rsiMax: 75, supportLookback: 70,  supProximity: 4.0, minRR: 1.6, volRatioMin: 1.1,  maxRiskPct: 0.09 },
  'NEAR/USDT': { atrMin: 2.0, emaDistMin: 0.6, rsiMin: 45, rsiMax: 75, supportLookback: 70,  supProximity: 4.0, minRR: 1.6, volRatioMin: 1.1,  maxRiskPct: 0.10 },
};

const DEFAULT_CONFIG: SymbolConfig = {
  atrMin: 1.0, emaDistMin: 1.0, rsiMin: 50, rsiMax: 73,
  supportLookback: 80, supProximity: 3.0, minRR: 1.5, volRatioMin: 1.15, maxRiskPct: 0.08,
};

function cfg(symbol: string): SymbolConfig {
  return SYMBOL_CONFIG[symbol] ?? DEFAULT_CONFIG;
}

function signalId(symbol: string, now: Date): string {
  const clean = symbol.replace('/', '');
  const d = now.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${clean}_${d.slice(0, 8)}_${d.slice(8, 12)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function none(symbol: string, reason: string): EvaluateResult {
  return {
    signal_id: null,
    timestamp: new Date().toISOString(),
    symbol,
    timeframe: '4H',
    signal: 'NONE',
    reason,
  };
}

// ── Main evaluate ─────────────────────────────────────────────────────────────

export function evaluate(input: EvaluateInput): EvaluateResult | SellEvaluateResult {
  const { symbol, candles4h, candles1d, position, openPositionCount } = input;
  const now = new Date();
  const c = cfg(symbol);
  if (!candles4h?.length || !candles1d?.length || candles4h.length < 100 || candles1d.length < 100)
    return none(symbol, 'Insufficient candle data.');

  const closes4h = candles4h.map(x => x.close);
  const price = closes4h[closes4h.length - 1]!; // safe: length checked above

  if (position.status !== 'OPEN' && openPositionCount >= 2)
    return none(symbol, 'Max open positions reached (2).');

  if (position.status === 'OPEN')
    return evaluateSell({ symbol, candles4h, position, price, now });

  const closes1d = candles1d.map(x => x.close);
  const d_ema50 = calcEMA(closes1d, 50);
  const d_ema200 = calcEMA(closes1d, 200);
  if (!d_ema50 || !d_ema200) return none(symbol, 'Insufficient 1D data for EMA.');
  const dailyBull = d_ema50 > d_ema200;
  if (!dailyBull) return none(symbol, 'Daily trend bearish — no BUY.');

  const ema50 = calcEMA(closes4h, 50);
  const ema200 = calcEMA(closes4h, 200);
  if (!ema50 || !ema200) return none(symbol, 'Insufficient 4H data for EMA.');

  const emaDistPct = ((ema50 - ema200) / ema200) * 100;
  if (ema50 < ema200) return none(symbol, '4H EMA50 below EMA200.');
  if (price < ema50) return none(symbol, 'Price below 4H EMA50.');
  if (emaDistPct <= c.emaDistMin) return none(symbol, `EMA distance ${round2(emaDistPct)}% ≤ ${c.emaDistMin}% threshold.`);

  const crosses = emaCrossCount(candles4h, 50, 200, 20);
  if (crosses >= 2) return none(symbol, 'Multiple EMA crosses in last 20 candles — sideways market.');

  const support = nearestSupport(candles4h, price, c.supportLookback);
  if (!support) return none(symbol, `No valid support found (lookback ${c.supportLookback}).`);
  const supScore = supportScore(support);
  if (supScore < 2) return none(symbol, `Support score ${supScore} < 2.`);

  const resistance = nearestResistance(candles4h, price, c.supportLookback);
  if (!resistance) return none(symbol, `No valid resistance found (lookback ${c.supportLookback}).`);
  const resScore = resistanceScore(resistance);
  if (resScore < 2) return none(symbol, `Resistance score ${resScore} < 2.`);

  const lastCandle = candles4h[candles4h.length - 1]!; // safe: length checked above
  const volSMA = calcVolumeSMA(candles4h, 20);
  const volumeRatio = volSMA ? lastCandle.volume / volSMA : 0;
  if (volumeRatio < c.volRatioMin) return none(symbol, `Volume ratio ${round2(volumeRatio)} < ${c.volRatioMin}.`);

  const rsi = calcRSI(closes4h, 14);
  if (rsi === null) return none(symbol, 'RSI calculation failed.');
  if (rsi < c.rsiMin || rsi > c.rsiMax) return none(symbol, `RSI ${round2(rsi)} outside ${c.rsiMin}–${c.rsiMax} buy zone.`);

  const atr = calcATR(candles4h, 14);
  const atrPct = atr ? (atr / price) * 100 : 0;
  if (!atr || atrPct < c.atrMin) return none(symbol, `ATR% ${round2(atrPct)} < ${c.atrMin}% minimum.`);

  const distFromSupport = ((price - support.price) / support.price) * 100;
  if (distFromSupport < 0 || distFromSupport > c.supProximity)
    return none(symbol, `Price ${round2(distFromSupport)}% from support — outside 0–${c.supProximity}% window.`);

  // ── Stop-loss (fixed: see engine/risk.ts) ──────────────────────────────────
  const entry = price;
  const slResult = calcStopLoss(entry, support, atr, c);
  if (!slResult.ok || slResult.stopLoss === null) return none(symbol, slResult.reason ?? 'Stop-loss invalid.');
  const stop_loss = slResult.stopLoss;

  const take_profit = resistance.price;
  const risk = entry - stop_loss;
  const reward = take_profit - entry;
  const rr = reward / risk;
  if (rr < c.minRR) return none(symbol, `RR ${round2(rr)} < ${c.minRR} minimum.`);

  const hasPattern = hasConfirmationPattern(candles4h);
  if (!hasPattern) return none(symbol, 'No confirmation candle pattern present.');

  const cleanStructure = crosses === 0;
  const confidence = calcConfidence({
    trendAligned: true,
    dailyTrendAligned: dailyBull,
    supportScore: supScore,
    volumeRatio,
    rsi,
    cleanStructure,
    hasRejectionCandle: hasPattern,
  });
  if (confidence < 75) return none(symbol, `Confidence ${confidence} below 75 threshold.`);

  const position_size = calcPositionSize(ENV.ACCOUNT_EQUITY, entry, stop_loss, 0.01);

  return {
    signal_id: signalId(symbol, now),
    timestamp: now.toISOString(),
    symbol,
    timeframe: '4H',
    trend: 'BULLISH',
    signal: 'BUY',
    status: 'NEW',
    price: round2(price),
    entry: round2(entry),
    stop_loss: round2(stop_loss),
    take_profit: round2(take_profit),
    risk_reward: round2(rr),
    atr: round2(atr),
    rsi: round2(rsi),
    volume_ratio: round2(volumeRatio),
    support: round2(support.price),
    resistance: round2(resistance.price),
    confidence,
    position_size,
    reason: `Bullish trend on 4H+1D. Support score ${supScore} (lookback ${c.supportLookback}). ` +
            `Vol ratio ${round2(volumeRatio)}. RSI ${round2(rsi)}. RR ${round2(rr)}.`,
  };
}

// ── Sell evaluator ────────────────────────────────────────────────────────────

function evaluateSell({
  symbol, candles4h, position, price, now,
}: { symbol: string; candles4h: Candle[]; position: Position; price: number; now: Date }): SellEvaluateResult {
  const closes4h = candles4h.map(x => x.close);
  const ema50 = calcEMA(closes4h, 50);
  const ema200 = calcEMA(closes4h, 200);
  const rsi = calcRSI(closes4h, 14);
  const lastCandle = candles4h[candles4h.length - 1];
  if (!lastCandle) {
    return {
      signal_id: null, timestamp: now.toISOString(), symbol, timeframe: '4H', signal: 'HOLD',
      price: round2(price), stop_loss: round2(position.stop_loss), take_profit: round2(position.take_profit),
      remaining_percent: position.remaining ?? 100, reason: 'No candle data.',
    };
  }

  const reasons: string[] = [];

  if (price <= position.stop_loss) reasons.push('Stop-loss triggered.');
  if (price >= position.take_profit) reasons.push('Take-profit reached.');
  if (ema50 && ema200 && ema50 < ema200) reasons.push('EMA50 crossed below EMA200 — trend reversal.');
  if (rsi !== null && rsi > 75 && isBearishRejection(lastCandle))
    reasons.push(`Overbought RSI ${round2(rsi)} with bearish rejection candle.`);
  if (position.resistance && price >= position.resistance * 0.99 && price <= position.resistance * 1.01)
    reasons.push('Price reached resistance level.');

  if (!reasons.length) {
    return {
      signal_id: null,
      timestamp: now.toISOString(),
      symbol,
      timeframe: '4H',
      signal: 'HOLD',
      price: round2(price),
      stop_loss: round2(position.stop_loss),
      take_profit: round2(position.take_profit),
      remaining_percent: position.remaining ?? 100,
      reason: 'No exit conditions met.',
    };
  }

  return {
    signal_id: signalId(symbol, now),
    timestamp: now.toISOString(),
    symbol,
    timeframe: '4H',
    signal: 'SELL',
    status: 'NEW',
    price: round2(price),
    reason: reasons.join(' '),
  };
}