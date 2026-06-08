import { ENV } from '../utils/env.js';
import { log, err } from '../utils/logger.js';

const API = `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`;

export async function sendAlert(text) {
  if (!ENV.TELEGRAM_BOT_TOKEN || !ENV.TELEGRAM_CHAT_ID) {
    log('[TELEGRAM] Skipped — no credentials configured.');
    return;
  }
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ENV.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
    const json = await res.json();
    if (!json.ok) err('[TELEGRAM] API error:', json.description);
    else log('[TELEGRAM] Alert sent.');
  } catch (e) {
    err('[TELEGRAM] Fetch failed:', e.message);
  }
}

export function formatBuyAlert(sig) {
  return (
    `🟢 *SWING BUY SIGNAL*\n\n` +
    `Pair: ${sig.symbol}\n` +
    `Timeframe: 4H\n` +
    `Price: $${sig.price}\n` +
    `Entry: $${sig.entry}\n` +
    `Stop Loss: $${sig.stop_loss}\n` +
    `Take Profit: $${sig.take_profit}\n` +
    `Risk/Reward: ${sig.risk_reward}\n` +
    `Confidence: ${sig.confidence}%\n` +
    `Volume Ratio: ${sig.volume_ratio}\n\n` +
    `Reason:\n${sig.reason}\n\n` +
    `⚠️ Not financial advice.`
  );
}

export function formatSellAlert(sig) {
  return (
    `🔴 *SWING SELL SIGNAL*\n\n` +
    `Pair: ${sig.symbol}\n` +
    `Timeframe: 4H\n` +
    `Price: $${sig.price}\n` +
    `Exit: $${sig.price}\n\n` +
    `Reason:\n${sig.reason}\n\n` +
    `⚠️ Not financial advice.`
  );
}

export function formatHoldAlert(sig) {
  return (
    `🟡 *POSITION UPDATE*\n\n` +
    `Pair: ${sig.symbol}\n` +
    `Current Price: $${sig.price}\n` +
    `Status: HOLD\n` +
    `Stop Loss: $${sig.stop_loss}\n` +
    `Take Profit: $${sig.take_profit}\n` +
    `Remaining Position: ${sig.remaining_percent}%`
  );
}
