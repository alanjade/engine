import { calcEMA } from './indicators.js';
import { detectRegime, regimeScoreMultiplier } from './regime.js';
import { analyzeStructure } from './structure.js';
import { detectAllSetups } from './setups.js';
import { scoreEntryLocation } from './entry-location.js';
import { analyzeVolume } from './volume.js';
import { analyzeMomentum } from './momentum.js';
import { analyzeCVD, cvdScoreMultiplier } from './cvd.js';
import type { Candle, ScoreBreakdown, ScoreGrade, ScoreResult, SetupKind } from '../types/index.js';

const WEIGHTS = {
  htfTrend: 15,
  marketStructure: 15,
  setupQuality: 15,
  entryLocation: 15,
  liquidity: 10,
  volume: 10,
  momentum: 8,
  cvd: 5,
  volatilityRegime: 4,
  session: 3,
} as const;

export interface ScoreInput {
  candles4h: Candle[];
  candles1d: Candle[];
  stopLoss?: number;
  takeProfit?: number;
  now?: Date; // for session scoring — defaults to current time, overridable for tests/backtests
}

/** 1D + 4H trend alignment. Full marks only when both timeframes agree and 4H is meaningfully separated, not just barely crossed. */
function scoreHtfTrend(candles4h: Candle[], candles1d: Candle[]): number {
  const closes4h = candles4h.map(c => c.close);
  const closes1d = candles1d.map(c => c.close);
  const ema50_4h = calcEMA(closes4h, 50);
  const ema200_4h = calcEMA(closes4h, 200);
  const ema50_1d = calcEMA(closes1d, 50);
  const ema200_1d = calcEMA(closes1d, 200);
  if (!ema50_4h || !ema200_4h || !ema50_1d || !ema200_1d) return 0;

  const bull4h = ema50_4h > ema200_4h;
  const bull1d = ema50_1d > ema200_1d;
  if (!bull4h && !bull1d) return 0;

  const dist4h = Math.abs((ema50_4h - ema200_4h) / ema200_4h) * 100;
  const dist1d = Math.abs((ema50_1d - ema200_1d) / ema200_1d) * 100;

  let score = 0;
  if (bull4h) score += 0.5;
  if (bull1d) score += 0.3;
  if (bull4h && bull1d) score += 0.2; // both-aligned bonus
  score *= Math.min(1, (dist4h / 3 + dist1d / 3) / 2); // scale by conviction, saturating around 3% separation each

  return clamp(score, 0, 1) * WEIGHTS.htfTrend;
}

function scoreMarketStructure(candles4h: Candle[]): number {
  const structure = analyzeStructure(candles4h, 2);
  return (structure.qualityScore / 100) * WEIGHTS.marketStructure;
}

function scoreSetupQuality(candles4h: Candle[]): { score: number; bestSetup: SetupKind | null } {
  const setups = detectAllSetups(candles4h);
  if (!setups.length) return { score: 0, bestSetup: null };
  const best = setups.reduce((max, s) => (s.quality > max.quality ? s : max));
  return { score: (best.quality / 100) * WEIGHTS.setupQuality, bestSetup: best.kind };
}

function scoreEntryLocationComponent(candles4h: Candle[], stopLoss?: number, takeProfit?: number): number {
  const result = scoreEntryLocation(candles4h, { stopLoss, takeProfit });
  if (!result) return 0;
  return (result.score / 100) * WEIGHTS.entryLocation;
}

/** Liquidity: rewards a clean, well-touched support/resistance structure near price — proxy via structure's swing data plus setup detection's liquidity-sweep quality when present. */
function scoreLiquidity(candles4h: Candle[]): number {
  const setups = detectAllSetups(candles4h);
  const sweep = setups.find(s => s.kind === 'LIQUIDITY_SWEEP');
  if (sweep) return (sweep.quality / 100) * WEIGHTS.liquidity;
  // No active sweep — fall back to a smaller baseline from structure quality, since liquidity context still matters even without an active sweep event.
  const structure = analyzeStructure(candles4h, 2);
  return (structure.qualityScore / 100) * WEIGHTS.liquidity * 0.4;
}

function scoreVolume(candles4h: Candle[]): number {
  const analysis = analyzeVolume(candles4h);
  if (!analysis) return 0;
  let score = 0;
  if (analysis.expansion) score += 0.5;
  if (analysis.confirmsMove) score += 0.3;
  if (analysis.divergence) score -= 0.3;
  if (analysis.contraction) score -= 0.1;
  return clamp(score, 0, 1) * WEIGHTS.volume;
}

function scoreMomentum(candles4h: Candle[]): number {
  const analysis = analyzeMomentum(candles4h);
  if (!analysis) return 0;
  let score = 0.4; // neutral baseline
  if (analysis.state === 'NEUTRAL') score += 0.2;
  if (analysis.expansion) score += 0.2;
  if (analysis.bullishDivergence) score += 0.2;
  if (analysis.bearishDivergence) score -= 0.4;
  if (analysis.exhaustion) score -= 0.2;
  if (analysis.state === 'OVERBOUGHT') score -= 0.1;
  return clamp(score, 0, 1) * WEIGHTS.momentum;
}

function scoreCvd(candles4h: Candle[]): number {
  const analysis = analyzeCVD(candles4h);
  return cvdScoreMultiplier(analysis) * WEIGHTS.cvd;
}

function scoreVolatilityRegime(candles4h: Candle[]): number {
  const regime = detectRegime(candles4h);
  return regimeScoreMultiplier(regime) * WEIGHTS.volatilityRegime;
}

/** Session liquidity: London/NY overlap (12:00-16:00 UTC) scores highest, London/NY individually scores mid, thin Asian hours score lowest. */
function scoreSession(now: Date): number {
  const hour = now.getUTCHours();
  const overlap = hour >= 12 && hour < 16;
  const londonOrNy = (hour >= 7 && hour < 12) || (hour >= 16 && hour < 21);
  if (overlap) return WEIGHTS.session;
  if (londonOrNy) return WEIGHTS.session * 0.66;
  return WEIGHTS.session * 0.33;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function gradeFor(total: number): ScoreGrade {
  if (total >= 90) return 'A+';
  if (total >= 80) return 'A';
  if (total >= 70) return 'B';
  if (total >= 60) return 'WATCH';
  return 'AVOID';
}

export function calcEntryScore(input: ScoreInput): ScoreResult {
  const { candles4h, candles1d, stopLoss, takeProfit } = input;
  const now = input.now ?? new Date();

  const { score: setupQuality, bestSetup } = scoreSetupQuality(candles4h);

  const breakdown: ScoreBreakdown = {
    htfTrend: round2(scoreHtfTrend(candles4h, candles1d)),
    marketStructure: round2(scoreMarketStructure(candles4h)),
    setupQuality: round2(setupQuality),
    entryLocation: round2(scoreEntryLocationComponent(candles4h, stopLoss, takeProfit)),
    liquidity: round2(scoreLiquidity(candles4h)),
    volume: round2(scoreVolume(candles4h)),
    momentum: round2(scoreMomentum(candles4h)),
    cvd: round2(scoreCvd(candles4h)),
    volatilityRegime: round2(scoreVolatilityRegime(candles4h)),
    session: round2(scoreSession(now)),
  };

  const total = Math.round(Object.values(breakdown).reduce((sum, v) => sum + v, 0));

  return { total: clamp(total, 0, 100), grade: gradeFor(total), breakdown, bestSetup };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
