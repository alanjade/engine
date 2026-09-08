import '../utils/env.js';
import { getSignalsSince } from '../services/store.js';
import { computeMetrics, type BacktestTrade } from '../engine/backtest.js';

/**
 * Usage: tsx scripts/paper-report.ts [symbol] [hours]
 *
 * Reads the live signal log (populated by runner.ts's saveDecision calls —
 * every ENTER/WAIT/AVOID/EXIT, not just the ones that hit Telegram) and
 * pairs each ENTER with its following EXIT for the same symbol to
 * reconstruct hypothetical trades, then runs them through the exact same
 * computeMetrics() the backtester uses — so paper-trading results and
 * backtest results are reported in the same shape and are directly
 * comparable, per the TODO's Phase 20 goal ("compare live results against
 * backtest").
 *
 * Caveat: this reconstructs P&L from entry price vs. logged exit_price only
 * — it does NOT weight partial TP1/TP2 closes the way the backtester does,
 * because the signal log doesn't record each partial fill individually.
 * Treat paper pnlPct/rMultiple here as an approximation; the backtester's
 * numbers are the more precise ones for the same underlying logic.
 */
async function main(): Promise<void> {
  const symbol = process.argv[2];
  const hours = Number(process.argv[3] ?? 24 * 30); // default: last 30 days

  const rows = await getSignalsSince(hours, symbol);
  if (rows.length === 0) {
    console.log(symbol
      ? `No logged signals for ${symbol} in the last ${hours}h.`
      : `No logged signals in the last ${hours}h.`);
    return;
  }

  const bySymbol = new Map<string, any[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol) ?? [];
    list.push(row);
    bySymbol.set(row.symbol, list);
  }

  const trades: BacktestTrade[] = [];
  let waitCount = 0;
  let avoidCount = 0;
  let openEnters = 0;

  for (const [sym, symRows] of bySymbol) {
    let pendingEnter: any = null;
    for (const row of symRows) {
      if (row.signal === 'WAIT') { waitCount++; continue; }
      if (row.signal === 'AVOID') { avoidCount++; continue; }

      if (row.signal === 'ENTER') {
        if (pendingEnter) {
          // An ENTER with no logged EXIT before the next ENTER — shouldn't
          // happen given runner.ts's single-open-position-per-symbol model,
          // but don't silently drop it: count it as still open rather than
          // pairing it with the wrong exit.
          openEnters++;
        }
        pendingEnter = row;
        continue;
      }

      if (row.signal === 'EXIT' && pendingEnter) {
        const entry = Number(pendingEnter.entry);
        const exitPrice = row.exit_price !== null && row.exit_price !== undefined
          ? Number(row.exit_price)
          : Number(row.take_profit ?? entry); // fallback for rows logged before exit_price existed
        const stopLoss = Number(pendingEnter.stop_loss ?? entry);
        const pnlPct = ((exitPrice - entry) / entry) * 100;
        const riskPct = ((entry - stopLoss) / entry) * 100;
        const rMultiple = riskPct > 0 ? pnlPct / riskPct : null;

        trades.push({
          entryIndex: 0, exitIndex: 1, entry, stopLoss,
          tp1: entry, tp2: entry, tp3: Number(pendingEnter.take_profit ?? entry),
          pnlPct, rMultiple, actions: [row.reason ?? ''].filter(Boolean),
          setup: null, grade: null, score: pendingEnter.confidence !== null ? Number(pendingEnter.confidence) : null,
        });
        pendingEnter = null;
      }
    }
    if (pendingEnter) openEnters++;
    void sym;
  }

  const metrics = computeMetrics(trades);

  console.log(`\n=== Paper trading report${symbol ? `: ${symbol}` : ' (all symbols)'} — last ${hours}h ===`);
  console.log(`Closed trades:       ${metrics.totalTrades}`);
  console.log(`Win rate:            ${(metrics.winRate * 100).toFixed(1)}%`);
  console.log(`Avg win:             ${metrics.avgWinPct.toFixed(2)}%`);
  console.log(`Avg loss:            ${metrics.avgLossPct.toFixed(2)}%`);
  console.log(`Avg R multiple:      ${metrics.avgRR.toFixed(2)}R`);
  console.log(`Profit factor:       ${Number.isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : '∞'}`);
  console.log(`Expectancy:          ${metrics.expectancy.toFixed(2)}% per trade`);
  console.log(`Max drawdown:        ${metrics.maxDrawdownPct.toFixed(2)}%`);
  console.log(`Total return:        ${metrics.totalReturnPct.toFixed(2)}%`);
  console.log(`Max consec. losses:  ${metrics.maxConsecutiveLosses}`);
  console.log(`\nWAIT signals:        ${waitCount}`);
  console.log(`AVOID signals:       ${avoidCount}`);
  if (openEnters > 0) {
    console.log(`\nNote: ${openEnters} ENTER(s) with no matching EXIT yet in this window — excluded from the stats above (still open, or window cut them off).`);
  }
  console.log(`\nCompare against: npm run backtest -- <SYMBOL> — same computeMetrics(), so the two reports line up directly. Remember paper pnlPct is entry-vs-exit only (no partial-TP weighting); the backtester's numbers are the precise ones.`);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
