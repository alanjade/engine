import { ENV } from '../utils/env.js';
import { log, err } from '../utils/logger.js';
import type { BuySignal, SellSignal, HoldSignal, EntryDecision, ExitDecision, ManagedPosition } from '../types/index.js';

const API = `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`;

/**
 * Telegram's legacy 'Markdown' parse mode treats `_`, `*`, `` ` ``, and `[`
 * as formatting control characters. Every alert below writes its own bold
 * markers (`*ENTER*` etc.) literally in the template — those are meant to
 * be interpreted. What ISN'T meant to be interpreted is free-text content
 * generated elsewhere (decision reasons, chase warnings, error messages) —
 * if any of that text ever contains one of these characters (an exchange
 * error message, a setup name, anything not hand-written here), it can
 * break the intended formatting or make Telegram reject the message
 * outright (an unmatched `_`/`*` is a hard API error, not just a display
 * glitch). Applied only at the point free-text is interpolated in, so the
 * literal formatting markers in the templates stay intact.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, '\\$1');
}

export async function sendAlert(text: string): Promise<void> {
  if (!ENV.TELEGRAM_BOT_TOKEN || !ENV.TELEGRAM_CHAT_ID) {
    log('[TELEGRAM] Skipped — no credentials configured.');
    return;
  }
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ENV.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) err('[TELEGRAM] API error:', json.description);
    else log('[TELEGRAM] Alert sent.');
  } catch (e) {
    err('[TELEGRAM] Fetch failed:', e instanceof Error ? e.message : String(e));
  }
}

export function formatBuyAlert(sig: BuySignal): string {
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
    `Reason:\n${escapeMarkdown(sig.reason)}\n\n` +
    `⚠️ Not financial advice.`
  );
}

export function formatSellAlert(sig: SellSignal): string {
  return (
    `🔴 *SWING SELL SIGNAL*\n\n` +
    `Pair: ${sig.symbol}\n` +
    `Timeframe: 4H\n` +
    `Price: $${sig.price}\n` +
    `Exit: $${sig.price}\n\n` +
    `Reason:\n${escapeMarkdown(sig.reason)}\n\n` +
    `⚠️ Not financial advice.`
  );
}

export function formatHoldAlert(sig: HoldSignal): string {
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
// ── Phase 15: ENTER/WAIT/AVOID/EXIT alerts, backed by the trade-state model ────
//
// These are the current alert formats; formatBuyAlert/formatSellAlert/
// formatHoldAlert above are the pre-Phase-11 formats and are kept only
// because runner.ts/signal.ts haven't been rewired to decideEntry/decideExit
// yet (that rewiring is a separate integration task, not part of Phase 15).

function checklistLine(label: string, passed: boolean): string {
  return `${passed ? '✓' : '✗'} ${label}`;
}

export function formatEnterAlert(symbol: string, decision: EntryDecision): string {
  const { score, confirmation, entry, stopLoss, takeProfitLevels, riskReward, regime } = decision;
  if (!score || !confirmation || entry === null || stopLoss === null || !takeProfitLevels) {
    return `🟢 *ENTER* — ${symbol}\n(Incomplete decision data — this shouldn't happen for a real ENTER state.)`;
  }

  const checklist = [
    checklistLine('Rejection/hammer/engulfing', confirmation.rejectionCandle || confirmation.hammer || confirmation.engulfing),
    checklistLine('Displacement', confirmation.displacementCandle),
    checklistLine('Breakout/retest', confirmation.breakoutConfirmed || confirmation.breakoutRetestConfirmed),
    checklistLine('Volume', confirmation.volumeConfirmed),
    checklistLine('Structure', confirmation.structureConfirmed),
    checklistLine('Liquidity', confirmation.liquidityConfirmed),
    confirmation.lowerTimeframeConfirmed !== null ? checklistLine('15M confirmation', confirmation.lowerTimeframeConfirmed) : null,
  ].filter((l): l is string => l !== null).join('\n');

  return (
    `🟢 *ENTER* — ${symbol}\n\n` +
    `Direction: LONG\n` +
    `Score: ${score.total} (${score.grade})\n` +
    `Setup: ${score.bestSetup ?? 'n/a'}\n` +
    `Regime: ${regime ?? 'n/a'}\n\n` +
    `Entry: $${entry.toFixed(4)}\n` +
    `Stop: $${stopLoss.toFixed(4)}\n` +
    `TP1: $${takeProfitLevels.tp1.toFixed(4)} (${takeProfitLevels.rr1.toFixed(2)}R)\n` +
    `TP2: $${takeProfitLevels.tp2.toFixed(4)} (${takeProfitLevels.rr2.toFixed(2)}R)\n` +
    `TP3: $${takeProfitLevels.tp3.toFixed(4)} (${takeProfitLevels.rr3.toFixed(2)}R)\n` +
    `RR: ${riskReward?.toFixed(2) ?? 'n/a'}\n` +
    `Risk: ${((entry - stopLoss) / entry * 100).toFixed(2)}%\n\n` +
    `Confirmation checklist:\n${checklist}\n\n` +
    `Status: NEW\n\n` +
    `⚠️ Not financial advice.`
  );
}

export function formatWaitAlert(symbol: string, decision: EntryDecision): string {
  const { score, confirmation } = decision;
  if (!score) return `🟡 *WAIT* — ${symbol}\n(No score available.)`;

  const checks: [string, boolean][] = confirmation ? [
    ['Rejection/hammer/engulfing', confirmation.rejectionCandle || confirmation.hammer || confirmation.engulfing],
    ['Displacement', confirmation.displacementCandle],
    ['Breakout/retest', confirmation.breakoutConfirmed || confirmation.breakoutRetestConfirmed],
    ['Volume', confirmation.volumeConfirmed],
    ['Structure', confirmation.structureConfirmed],
    ['Liquidity', confirmation.liquidityConfirmed],
  ] : [];
  const confirmed = checks.filter(([, ok]) => ok).map(([label]) => label);
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);

  return (
    `🟡 *WAIT* — ${symbol}\n\n` +
    `Score: ${score.total} (${score.grade})\n` +
    `Setup: ${score.bestSetup ?? 'n/a'}\n\n` +
    `Confirmed:\n${confirmed.length ? confirmed.map(c => `✓ ${c}`).join('\n') : '(none yet)'}\n\n` +
    `Missing:\n${missing.length ? missing.map(m => `✗ ${m}`).join('\n') : '(none — awaiting score threshold)'}\n\n` +
    `Status: WAIT`
  );
}

export function formatAvoidAlert(symbol: string, decision: EntryDecision): string {
  const scoreLine = decision.score ? `Score: ${decision.score.total} (${decision.score.grade})\n` : '';
  const chaseWarning = decision.chase?.blocked ? `\n⚠️ DO NOT CHASE: ${escapeMarkdown(decision.chase.reasons.join(', '))}\n` : '';
  const rrWarning = decision.riskReward !== null && decision.riskReward < 1
    ? `\n⚠️ Poor risk/reward (${decision.riskReward.toFixed(2)}).\n`
    : '';

  return (
    `🔴 *AVOID* — ${symbol}\n\n` +
    scoreLine +
    `Reason: ${escapeMarkdown(decision.reasons.join(' '))}` +
    chaseWarning +
    rrWarning
  );
}

// Not one of the original Phase 15 formats (ENTER/WAIT/AVOID/EXIT) — added
// alongside the position-management wiring, since a partial TP or a
// trailing-stop raise is neither a fresh ENTER nor a full EXIT but is still
// worth surfacing.
export function formatPositionUpdateAlert(symbol: string, position: ManagedPosition, actions: string[]): string {
  return (
    `🔵 *POSITION UPDATE* — ${symbol}\n\n` +
    `Remaining: ${position.remainingPct}%\n` +
    `Stop: $${position.stopLoss.toFixed(4)}\n` +
    `TP1: $${position.tp1.toFixed(4)}${position.tp1Hit ? ' ✓' : ''}\n` +
    `TP2: $${position.tp2.toFixed(4)}${position.tp2Hit ? ' ✓' : ''}\n` +
    `TP3: $${position.tp3.toFixed(4)}\n\n` +
    `${escapeMarkdown(actions.join('\n'))}`
  );
}

export interface ExitAlertInput {
  symbol: string;
  entry: number;
  exitPrice: number;
  stopLoss: number;
  decision: ExitDecision;
}

export function formatExitAlert(input: ExitAlertInput): string {
  const { symbol, entry, exitPrice, stopLoss, decision } = input;
  const pnlPct = ((exitPrice - entry) / entry) * 100;
  const risk = entry - stopLoss;
  const rMultiple = risk > 0 ? (exitPrice - entry) / risk : null;

  return (
    `⚪ *EXIT* — ${symbol}\n\n` +
    `Entry: $${entry.toFixed(4)}\n` +
    `Exit: $${exitPrice.toFixed(4)}\n` +
    `P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%\n` +
    `R multiple: ${rMultiple !== null ? rMultiple.toFixed(2) + 'R' : 'n/a'}\n\n` +
    `Reason: ${escapeMarkdown(decision.reasons.join(' '))}`
  );
}
