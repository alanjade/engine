import { calcEMA, calcRSI, calcATR, calcVolumeSMA, emaCrossCount } from './indicators.js';
import { nearestSupport, nearestResistance, supportScore, resistanceScore } from './structure.js';
import { hasConfirmationPattern, isBearishRejection } from './candles.js';
import { calcConfidence } from './confidence.js';
import { ENV } from '../utils/env.js';

const ATR_MIN = {
  'BTC/USDT':  0.8,
  'ETH/USDT':  1.0,
  'BNB/USDT':  1.2,
  'SOL/USDT':  1.5,
  'TON/USDT':  2.0,
  'NEAR/USDT': 2.5,
};

function signalId(symbol, now) {
  const clean = symbol.replace('/', '');
  const d = now.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${clean}_${d.slice(0, 8)}_${d.slice(8, 12)}`;
}

function round2(n) { return Math.round(n * 100) / 100; }

function none(symbol, reason) {
  return {
    signal_id: null,
    timestamp: new Date().toISOString(),
    symbol,
    timeframe: '4H',
    signal: 'NONE',
    reason,
  };
}

export function evaluate({
  symbol,
  candles4h,
  candles1d,
  position,
  openPositionCount,
}) {
  const now      = new Date();
  const closes4h = candles4h.map(c => c.close);
  const price    = closes4h[closes4h.length - 1];

  // ── 1. Data validity ──────────────────────────────────────────────────────
  if (!candles4h?.length || !candles1d?.length || candles4h.length < 250 || candles1d.length < 250)
    return none(symbol, 'Insufficient candle data.');

  // ── 2. Portfolio risk limits ──────────────────────────────────────────────
  if (position.status !== 'OPEN' && openPositionCount >= 2)
    return none(symbol, 'Max open positions reached (2).');

  // ── 3. Open position check ────────────────────────────────────────────────
  if (position.status === 'OPEN') {
    return evaluateSell({ symbol, candles4h, position, price, now });
  }

  // ── 4. Daily trend filter ─────────────────────────────────────────────────
  const closes1d  = candles1d.map(c => c.close);
  const d_ema50   = calcEMA(closes1d, 50);
  const d_ema200  = calcEMA(closes1d, 200);
  if (!d_ema50 || !d_ema200) return none(symbol, 'Insufficient 1D data for EMA.');
  const dailyBull = d_ema50 > d_ema200;
  if (!dailyBull) return none(symbol, 'Daily trend bearish — no BUY.');

  // ── 5. 4H EMA trend strength ──────────────────────────────────────────────
  const ema50  = calcEMA(closes4h, 50);
  const ema200 = calcEMA(closes4h, 200);
  if (!ema50 || !ema200) return none(symbol, 'Insufficient 4H data for EMA.');

  const emaDistPct = ((ema50 - ema200) / ema200) * 100;
  if (emaDistPct <= 1.5) return none(symbol, `EMA distance ${round2(emaDistPct)}% < 1.5% threshold.`);
  if (ema50 < ema200)    return none(symbol, '4H EMA50 below EMA200.');
  if (price < ema50)     return none(symbol, 'Price below 4H EMA50.');

  // ── 6. Sideways filter ────────────────────────────────────────────────────
  const crosses = emaCrossCount(candles4h, 50, 200, 20);
  if (crosses >= 2) return none(symbol, 'Multiple EMA crosses in last 20 candles — sideways market.');

  // ── 7. Support quality ────────────────────────────────────────────────────
  const support = nearestSupport(candles4h, price);
  if (!support) return none(symbol, 'No valid support found.');
  const supScore = supportScore(support);
  if (supScore < 2) return none(symbol, `Support score ${supScore} < 2.`);

  // ── 8. Resistance quality ─────────────────────────────────────────────────
  const resistance = nearestResistance(candles4h, price);
  if (!resistance) return none(symbol, 'No valid resistance found.');
  const resScore = resistanceScore(resistance);
  if (resScore < 2) return none(symbol, `Resistance score ${resScore} < 2.`);

  // ── 9. Volume confirmation ────────────────────────────────────────────────
  const lastCandle  = candles4h[candles4h.length - 1];
  const volSMA      = calcVolumeSMA(candles4h, 20);
  const volumeRatio = volSMA ? lastCandle.volume / volSMA : 0;
  if (volumeRatio < 1.2) return none(symbol, `Volume ratio ${round2(volumeRatio)} < 1.2.`);

  // ── 10. RSI confirmation ──────────────────────────────────────────────────
  const rsi = calcRSI(closes4h, 14);
  if (rsi === null) return none(symbol, 'RSI calculation failed.');
  if (rsi < 55 || rsi > 70) return none(symbol, `RSI ${round2(rsi)} outside 55–70 buy zone.`);

  // ── 11. ATR filter ────────────────────────────────────────────────────────
  const atr      = calcATR(candles4h, 14);
  const atrMin   = ATR_MIN[symbol] ?? 1.0;
  const atrPct   = atr ? (atr / price) * 100 : 0;
  if (!atr || atrPct < atrMin)
    return none(symbol, `ATR% ${round2(atrPct)} below ${atrMin}% minimum for ${symbol}.`);

  // ── 12. Price at/near support ─────────────────────────────────────────────
  const distFromSupport = (price - support.price) / support.price * 100;
  if (distFromSupport < 0 || distFromSupport > 2.0)
    return none(symbol, `Price ${round2(distFromSupport)}% from support — outside 0–2% window.`);

  // ── 12. Stop-loss validity ────────────────────────────────────────────────
  const sl_raw     = support.price - (0.5 * atr);
  const sl_floor   = support.price * 0.99;
  const sl_ceiling = support.price - (2 * atr);

  if (sl_floor > sl_ceiling)
    return none(symbol, 'ATR too large — SL range invalid (floor > ceiling).');

  const stop_loss = Math.min(sl_floor, Math.max(sl_ceiling, sl_raw));

  if (stop_loss >= price)
    return none(symbol, 'Stop-loss at or above entry — invalid setup.');

  // ── 13. Risk/reward ───────────────────────────────────────────────────────
  const entry      = price;
  const take_profit = resistance.price;
  const risk       = entry - stop_loss;
  const reward     = take_profit - entry;
  const rr         = reward / risk;

  if (rr < 1.5)
    return none(symbol, `RR ${round2(rr)} < 1.5 minimum.`);

  // ── 14. Confirmation candle ───────────────────────────────────────────────
  const hasPattern = hasConfirmationPattern(candles4h);
  if (!hasPattern)
    return none(symbol, 'No confirmation candle pattern present.');

  // ── 16. Confidence score ──────────────────────────────────────────────────
  const cleanStructure = crosses === 0;
  const confidence = calcConfidence({
    trendAligned:       true,
    dailyTrendAligned:  dailyBull,
    supportScore:       supScore,
    volumeRatio,
    rsi,
    cleanStructure,
    hasRejectionCandle: hasPattern,
  });

  if (confidence < 75)
    return none(symbol, `Confidence ${confidence} below 75 threshold.`);

  // ── 17. Signal ────────────────────────────────────────────────────────────
  const position_size = round2((ENV.ACCOUNT_EQUITY * 0.01) / risk);

  return {
    signal_id:     signalId(symbol, now),
    timestamp:     now.toISOString(),
    symbol,
    timeframe:     '4H',
    trend:         'BULLISH',
    signal:        'BUY',
    status:        'NEW',
    price:         round2(price),
    entry:         round2(entry),
    stop_loss:     round2(stop_loss),
    take_profit:   round2(take_profit),
    risk_reward:   round2(rr),
    atr:           round2(atr),
    rsi:           round2(rsi),
    volume_ratio:  round2(volumeRatio),
    support:       round2(support.price),
    resistance:    round2(resistance.price),
    confidence,
    position_size,
    reason: `Bullish trend confirmed on 4H and 1D. Price at support (score ${supScore}) with volume ratio ${round2(volumeRatio)}. RSI ${round2(rsi)}. RR ${round2(rr)}.`,
  };
}

function evaluateSell({ symbol, candles4h, position, price, now }) {
  const closes4h  = candles4h.map(c => c.close);
  const ema50     = calcEMA(closes4h, 50);
  const ema200    = calcEMA(closes4h, 200);
  const rsi       = calcRSI(closes4h, 14);
  const lastCandle = candles4h[candles4h.length - 1];

  const reasons = [];

  if (price <= position.stop_loss)
    reasons.push('Stop-loss triggered.');

  if (price >= position.take_profit)
    reasons.push('Take-profit reached.');

  if (ema50 && ema200 && ema50 < ema200)
    reasons.push('EMA50 crossed below EMA200 — trend reversal.');

  if (rsi > 70 && isBearishRejection(lastCandle))
    reasons.push(`Overbought RSI ${round2(rsi)} with bearish rejection candle.`);

  if (price >= position.resistance * 0.99 && price <= position.resistance * 1.01)
    reasons.push('Price reached resistance level.');

  if (!reasons.length) {
    return {
      signal_id:  null,
      timestamp:  now.toISOString(),
      symbol,
      timeframe:  '4H',
      signal:     'HOLD',
      price:      round2(price),
      stop_loss:  round2(position.stop_loss),
      take_profit: round2(position.take_profit),
      remaining_percent: position.remaining ?? 100,
      reason:     'No exit conditions met.',
    };
  }

  return {
    signal_id:  signalId(symbol, now),
    timestamp:  now.toISOString(),
    symbol,
    timeframe:  '4H',
    signal:     'SELL',
    status:     'NEW',
    price:      round2(price),
    reason:     reasons.join(' '),
  };
}
