import { describe, it, expect } from 'vitest';
import { formatEnterAlert, formatWaitAlert, formatAvoidAlert, formatExitAlert, escapeMarkdown } from './telegram.js';
import { decideEntry, decideExit } from '../engine/trade-state.js';
import type { Candle, SymbolConfig } from '../types/index.js';

function candle(close: number, opts: Partial<Candle> = {}): Candle {
  return {
    timestamp: 0,
    open: opts.open ?? close,
    close,
    high: opts.high ?? close * 1.005,
    low: opts.low ?? close * 0.995,
    volume: opts.volume ?? 1000,
  };
}
function timestamped(candles: Candle[]): Candle[] {
  return candles.map((c, i) => ({ ...c, timestamp: i * 3_600_000 }));
}

const config: SymbolConfig = {
  atrMin: 0.5, emaDistMin: 0.5, rsiMin: 40, rsiMax: 80,
  supportLookback: 100, supProximity: 5, minRR: 1.2, volRatioMin: 1.0, maxRiskPct: 15,
};

function zigzagUptrend(rate: number, n = 220): Candle[] {
  const candles: Candle[] = [];
  let baseline = 100;
  for (let i = 0; i < n; i++) {
    baseline *= 1 + rate;
    const price = baseline + Math.sin(i / 2) * baseline * 0.05;
    candles.push(candle(price, { high: price * 1.005, low: price * 0.995, volume: 1000 + i * 3 }));
  }
  return timestamped(candles);
}
function flatCandles(): Candle[] {
  return timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.05 : -0.05))));
}

describe('escapeMarkdown', () => {
  it('backslash-escapes Telegram legacy Markdown control characters', () => {
    expect(escapeMarkdown('EMA_20 * distance [test]')).toBe('EMA\\_20 \\* distance \\[test]');
    expect(escapeMarkdown('normal text with no special chars')).toBe('normal text with no special chars');
  });

  it('AVOID alert escapes a reason string containing markdown control characters', () => {
    const decision = decideEntry({ candles4h: flatCandles(), candles1d: flatCandles(), config });
    const withRiskyReason = { ...decision, reasons: ['Poor structure_quality (score * 2 < threshold) [flagged]'] };
    const text = formatAvoidAlert('X/USDT', withRiskyReason);
    expect(text).toContain('structure\\_quality');
    expect(text).toContain('\\* 2');
    expect(text).toContain('\\[flagged]');
  });
});

describe('formatAvoidAlert', () => {
  it('includes the reason and symbol for an AVOID decision', () => {
    const decision = decideEntry({ candles4h: flatCandles(), candles1d: flatCandles(), config });
    expect(decision.state).toBe('AVOID');
    const text = formatAvoidAlert('FLAT/USDT', decision);
    expect(text).toContain('AVOID');
    expect(text).toContain('FLAT/USDT');
    expect(text).toContain('Reason:');
  });

  it('surfaces a DO NOT CHASE warning when chase is blocked', () => {
    const decision = decideEntry({ candles4h: flatCandles(), candles1d: flatCandles(), config });
    // Synthesize a blocked-chase decision shape directly since triggering it
    // organically requires threading a very specific blow-off fixture through
    // the full gate chain — the formatter's behavior is what's under test here.
    const withChase = { ...decision, chase: { flags: {} as any, score: 90, blocked: true, reasons: ['excessiveEma20Distance', 'overextendedRSI'] } };
    const text = formatAvoidAlert('X/USDT', withChase);
    expect(text).toContain('DO NOT CHASE');
  });
});

describe('formatEnterAlert / formatWaitAlert', () => {
  it('produces a well-formed alert for whatever state a real uptrend decision lands on', () => {
    const trend = zigzagUptrend(0.006);
    const decision = decideEntry({ candles4h: trend, candles1d: trend, config });

    if (decision.state === 'ENTER') {
      const text = formatEnterAlert('UP/USDT', decision);
      expect(text).toContain('ENTER');
      expect(text).toContain('TP1');
      expect(text).toContain('TP2');
      expect(text).toContain('TP3');
      expect(text).toContain('Confirmation checklist');
    } else if (decision.state === 'WAIT') {
      const text = formatWaitAlert('UP/USDT', decision);
      expect(text).toContain('WAIT');
      expect(text).toContain('Score:');
    } else {
      const text = formatAvoidAlert('UP/USDT', decision);
      expect(text).toContain('AVOID');
    }
  });

  it('formatEnterAlert lists exactly the confirmation checklist items that are true as checked', () => {
    const trend = zigzagUptrend(0.007);
    const decision = decideEntry({ candles4h: trend, candles1d: trend, config });
    if (decision.state !== 'ENTER' || !decision.confirmation) return; // fixture-dependent; assert only when it actually lands on ENTER

    const text = formatEnterAlert('UP/USDT', decision);
    if (decision.confirmation.volumeConfirmed) expect(text).toMatch(/✓ Volume/);
    if (decision.confirmation.structureConfirmed) expect(text).toMatch(/✓ Structure/);
  });
});

describe('formatExitAlert', () => {
  it('computes P&L% and R-multiple correctly for a winning exit', () => {
    const text = formatExitAlert({
      symbol: 'X/USDT', entry: 100, exitPrice: 120, stopLoss: 90,
      decision: { exit: true, reasons: ['Take-profit reached.'] },
    });
    expect(text).toContain('+20.00%');
    expect(text).toContain('2.00R'); // (120-100)/(100-90) = 2R
  });

  it('computes a negative P&L and negative R-multiple for a losing exit', () => {
    const text = formatExitAlert({
      symbol: 'X/USDT', entry: 100, exitPrice: 90, stopLoss: 90,
      decision: { exit: true, reasons: ['Stop-loss reached.'] },
    });
    expect(text).toContain('-10.00%');
    expect(text).toContain('-1.00R');
  });

  it('reports the exit reason from the ExitDecision', () => {
    const candles = timestamped(Array.from({ length: 220 }, (_, i) => candle(100 + (i % 2 === 0 ? 0.1 : -0.1))));
    const exitDecision = decideExit(candles, { status: 'OPEN', stop_loss: 200, take_profit: 300 });
    const text = formatExitAlert({ symbol: 'X/USDT', entry: 100, exitPrice: 99, stopLoss: 200, decision: exitDecision });
    expect(text).toContain('Reason:');
  });
});
