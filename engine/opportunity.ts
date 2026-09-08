import { decideEntry } from './trade-state.js';
import type { Candle, Opportunity, SymbolConfig } from '../types/index.js';

export interface SymbolCandleSet {
  symbol: string;
  candles4h: Candle[];
  candles1d: Candle[];
  candles1h?: Candle[];
  candles15m?: Candle[];
  config: SymbolConfig;
}

export interface RankOpportunitiesOptions {
  topN?: number;
  candlesPerDay?: number;
}

/**
 * Turns "can I BUY this coin?" into "which coin has the best opportunity
 * right now?" — scans every symbol, keeps only ones that clear AVOID
 * (decideEntry already gates on regime/structure/RR/chase/score), and
 * ranks what's left by composite score. Returning zero opportunities is a
 * valid, expected result on a day with nothing worth trading — this
 * function never pads the list with low-quality candidates just to fill
 * topN, since that's exactly the "forced trade" the TODO calls out to
 * prevent.
 */
export function rankOpportunities(symbols: SymbolCandleSet[], opts: RankOpportunitiesOptions = {}): Opportunity[] {
  const topN = opts.topN ?? 5;
  const candlesPerDay = opts.candlesPerDay ?? 6;

  const opportunities: Omit<Opportunity, 'rank'>[] = [];

  for (const { symbol, candles4h, candles1d, candles1h, candles15m, config } of symbols) {
    const decision = decideEntry({ candles4h, candles1d, candles1h, candles15m, config, candlesPerDay });
    if (decision.state === 'AVOID' || !decision.score) continue; // no forced trades — AVOID never becomes an "opportunity"

    opportunities.push({
      symbol,
      state: decision.state,
      score: decision.score.total,
      grade: decision.score.grade,
      bestSetup: decision.score.bestSetup,
      riskReward: decision.riskReward,
    });
  }

  opportunities.sort((a, b) => b.score - a.score);

  return opportunities.slice(0, topN).map((o, i) => ({ ...o, rank: i + 1 }));
}
