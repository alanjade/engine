import { calcEMA } from './indicators.js';
import { detectRegime, isTradableForLong } from './regime.js';
import { analyzeStructure, nearestSupport, nearestResistance } from './structure.js';
import { rankOpportunities } from './opportunity.js';
import type { Candle, CandidateState, Opportunity, SymbolConfig } from '../types/index.js';

const MIN_CANDIDATE_STRUCTURE_QUALITY = 35;

export interface SlowScanInput {
  symbol: string;
  candles1d: Candle[];
  candles4h: Candle[];
  supportLookback: number;
}

/**
 * Slow scanner (1D + 4H, run ~every 4H): the coarse, expensive macro filter.
 * Determines regime, HTF trend, and structure quality, then narrows the
 * full symbol universe down to a short candidate list — this is what the
 * fast scanner spends its frequent cycles on instead of re-evaluating
 * every symbol from scratch every 5-15 minutes.
 */
export function runSlowScan(inputs: SlowScanInput[]): CandidateState[] {
  const now = Date.now();
  const candidates: CandidateState[] = [];

  for (const { symbol, candles1d, candles4h, supportLookback } of inputs) {
    if (candles4h.length < 220 || candles1d.length < 100) continue;

    const regime = detectRegime(candles4h);
    const structure = analyzeStructure(candles4h, 2);

    const closes1d = candles1d.map(c => c.close);
    const ema50_1d = calcEMA(closes1d, 50);
    const ema200_1d = closes1d.length >= 200 ? calcEMA(closes1d, 200) : null;
    const htfBullish = ema50_1d !== null && ema200_1d !== null && ema50_1d > ema200_1d;

    const price = candles4h[candles4h.length - 1]!.close;
    const support = nearestSupport(candles4h, price, supportLookback);
    const resistance = nearestResistance(candles4h, price, supportLookback);

    const state: CandidateState = {
      symbol,
      regime: regime.regime,
      htfBullish,
      structureQuality: structure.qualityScore,
      majorSupport: support?.price ?? null,
      majorResistance: resistance?.price ?? null,
      scannedAt: now,
    };

    const qualifies = isTradableForLong(regime) && htfBullish && structure.qualityScore >= MIN_CANDIDATE_STRUCTURE_QUALITY;
    if (qualifies) candidates.push(state);
  }

  return candidates;
}

export interface FastScanSymbolData {
  symbol: string;
  candles4h: Candle[];
  candles1d: Candle[];
  candles1h?: Candle[];
  candles15m?: Candle[];
  config: SymbolConfig;
}

export interface FastScanOptions {
  topN?: number;
  candlesPerDay?: number;
}

/**
 * Fast scanner (1H + 15M timing, run every 5-15min): restricted to the
 * candidate list the slow scan already produced — it does NOT re-run the
 * macro filter, it just checks entry timing on the short list. 1H candles
 * feed setup detection and 15M candles feed entry confirmation inside
 * decideEntry/calcEntryScore (both optional — each falls back to 4H-only
 * when unavailable for a cycle, matching Phase 2's cache tolerance for
 * partial timeframe failures). Restricting scope to candidates is what
 * makes running this every 5 minutes cheap enough to be worth doing.
 */
export function runFastScan(
  candidates: CandidateState[],
  dataBySymbol: FastScanSymbolData[],
  opts: FastScanOptions = {},
): Opportunity[] {
  const candidateSymbols = new Set(candidates.map(c => c.symbol));
  const restricted = dataBySymbol.filter(d => candidateSymbols.has(d.symbol));
  return rankOpportunities(restricted, opts);
}
