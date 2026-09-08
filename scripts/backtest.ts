import '../utils/env.js';
import { fetchOHLCV } from '../services/exchange.js';
import { runBacktest } from '../engine/backtest.js';
import { cfg } from '../engine/config.js';
import { log } from '../utils/logger.js';

/**
 * Usage: tsx scripts/backtest.ts BTC/USDT [candleLimit]
 *
 * Fetches historical 4H + 1D candles for one symbol and runs the
 * walk-forward backtest. candleLimit caps how much 4H history is pulled
 * (actual depth available depends on the OHLCV proxy/exchange — this asks
 * for up to that many, it may return fewer).
 */
async function main(): Promise<void> {
  const symbol = process.argv[2];
  const limit = Number(process.argv[3] ?? 1500);

  if (!symbol) {
    console.error('Usage: tsx scripts/backtest.ts <SYMBOL> [candleLimit]');
    console.error('Example: tsx scripts/backtest.ts BTC/USDT 1500');
    process.exit(1);
  }

  log(`Fetching historical candles for ${symbol}...`);
  const [candles4h, candles1d] = await Promise.all([
    fetchOHLCV(symbol, '4h', null, limit),
    fetchOHLCV(symbol, '1d', null, Math.ceil(limit / 6) + 100),
  ]);
  log(`Got ${candles4h.length} x 4H candles, ${candles1d.length} x 1D candles.`);

  const result = runBacktest(candles4h, candles1d, cfg(symbol));
  const { metrics } = result;

  console.log(`\n=== Backtest: ${symbol} ===`);
  console.log(`Trades:              ${metrics.totalTrades}`);
  console.log(`Win rate:            ${(metrics.winRate * 100).toFixed(1)}%`);
  console.log(`Avg win:             ${metrics.avgWinPct.toFixed(2)}%`);
  console.log(`Avg loss:            ${metrics.avgLossPct.toFixed(2)}%`);
  console.log(`Avg R multiple:      ${metrics.avgRR.toFixed(2)}R`);
  console.log(`Profit factor:       ${Number.isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : '∞'}`);
  console.log(`Expectancy:          ${metrics.expectancy.toFixed(2)}% per trade`);
  console.log(`Max drawdown:        ${metrics.maxDrawdownPct.toFixed(2)}%`);
  console.log(`Total return:        ${metrics.totalReturnPct.toFixed(2)}% (compounded, pct-of-equity per trade)`);
  console.log(`Max consec. losses:  ${metrics.maxConsecutiveLosses}`);

  if (Object.keys(metrics.bySetup).length) {
    console.log('\nBy setup:');
    for (const [setup, s] of Object.entries(metrics.bySetup)) {
      console.log(`  ${setup.padEnd(20)} trades=${s.trades}  winRate=${(s.winRate * 100).toFixed(1)}%  avgRR=${s.avgRR.toFixed(2)}`);
    }
  }
  if (Object.keys(metrics.byGrade).length) {
    console.log('\nBy grade:');
    for (const [grade, g] of Object.entries(metrics.byGrade)) {
      console.log(`  ${grade.padEnd(20)} trades=${g.trades}  winRate=${(g.winRate * 100).toFixed(1)}%  avgRR=${g.avgRR.toFixed(2)}`);
    }
  }

  if (result.openAtEnd) {
    console.log(`\nNote: one position still open when candle data ran out (entered at bar ${result.openAtEnd.entryIndex}, entry $${result.openAtEnd.entry.toFixed(4)}) — excluded from the stats above.`);
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});