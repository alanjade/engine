export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Level { price: number; count: number; }

export type ExchangeName = 'bybit' | 'okx' | 'bitget' | 'gate';
export interface Ticker { last: number; }

export interface SymbolConfig {
  atrMin: number;
  emaDistMin: number;
  rsiMin: number;
  rsiMax: number;
  supportLookback: number;
  supProximity: number;
  minRR: number;
  volRatioMin: number;
  maxRiskPct: number;
}

export interface Position {
  status: 'OPEN' | 'CLOSED' | 'NONE';
  stop_loss: number;
  take_profit: number;
  remaining?: number | null;
  resistance?: number | null;
}

export type MarketRegime =
  | 'STRONG_UPTREND' | 'WEAK_UPTREND' | 'RANGE'
  | 'WEAK_DOWNTREND' | 'STRONG_DOWNTREND'
  | 'COMPRESSION' | 'HIGH_VOLATILITY';

export interface RegimeResult {
  regime: MarketRegime;
  strength: number; // 0-100, confidence in the classification
  atrPct: number;
  emaSlope: number; // % change in EMA50 over the lookback window
  emaDistPct: number; // % distance between EMA50 and EMA200
  emaBullish: boolean; // EMA50>EMA200 alignment, independent of short-term slope — survives a pullback's flattened slope
}

export interface StoredPosition {
  symbol: string;
  status: 'OPEN' | 'CLOSED' | 'NONE';
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  size: number | null;
  remaining: number | null;
  resistance?: number | null;
  // ── Position-management state (Phase 12), persisted so partial-TP/
  // break-even/trailing-stop progress survives across scan cycles rather
  // than resetting every run. Optional so rows written before this field
  // existed still deserialize — runner.ts falls back to degraded (no
  // partials, single-target) handling when these are absent.
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  highest_price?: number | null;
  tp1_hit?: boolean | null;
  tp2_hit?: boolean | null;
  break_even_activated?: boolean | null;
}

export interface SignalBase {
  signal_id: string | null;
  timestamp: string;
  symbol: string;
  timeframe: '4H';
  reason: string;
}

export interface BuySignal extends SignalBase {
  signal: 'BUY';
  status: 'NEW';
  trend: 'BULLISH';
  price: number;
  entry: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  atr: number;
  rsi: number;
  volume_ratio: number;
  support: number;
  resistance: number;
  confidence: number;
  position_size: number;
}

export interface SellSignal extends SignalBase {
  signal: 'SELL';
  status: 'NEW';
  price: number;
}

export interface HoldSignal extends SignalBase {
  signal: 'HOLD';
  price: number;
  stop_loss: number;
  take_profit: number;
  remaining_percent: number;
}

export interface NoneSignal extends SignalBase { signal: 'NONE'; }
export type SignalResult = BuySignal | SellSignal | HoldSignal | NoneSignal;
export type EvaluateResult = BuySignal | HoldSignal | NoneSignal;
export type SellEvaluateResult = SellSignal | HoldSignal;

export interface EvaluateInput {
  symbol: string;
  candles4h: Candle[];
  candles1d: Candle[];
  position: Position;
  openPositionCount: number;
}

export type SwingType = 'HH' | 'HL' | 'LH' | 'LL';

export interface SwingPoint {
  index: number;
  timestamp: number;
  price: number;
  kind: 'high' | 'low';
  label: SwingType;
}

export type StructureBias = 'BULLISH' | 'BEARISH' | 'UNDEFINED';
export type StructureEvent = 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE';

export interface StructureAnalysis {
  swings: SwingPoint[];
  bias: StructureBias;
  lastEvent: StructureEvent;
  lastEventIndex: number | null;
  structureAge: number;
  invalidationLevel: number | null;
  swingStrength: number;
  qualityScore: number;
}

export type SetupKind = 'PULLBACK' | 'BREAKOUT_RETEST' | 'LIQUIDITY_SWEEP' | 'COMPRESSION_BREAKOUT';

export interface SetupResult {
  kind: SetupKind;
  detected: boolean;
  quality: number; // 0-100, only meaningful when detected=true
  reason: string;
}

export type EntryZoneName = 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE';

export interface EntryZone {
  name: EntryZoneName;
  price: number;
  distanceFromPricePct: number;
}

export interface EntryLocationResult {
  score: number; // 0-100
  components: {
    supportProximity: number;
    resistanceProximity: number;
    ema20Proximity: number;
    ema50Proximity: number;
    fibProximity: number;
    valueAreaContext: number;
    distFromRecentHighPct: number;
    distFromRecentLowPct: number;
    riskRewardScore: number;
  };
  zones: EntryZone[];
}

export interface VolumeAnalysis {
  relativeVolume: number; // current volume / SMA
  expansion: boolean;
  contraction: boolean;
  confirmsMove: boolean; // volume expansion aligned with the candle's price direction
  divergence: boolean;   // price extended to a new local extreme without volume support
}

export type MomentumState = 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';

export interface MomentumAnalysis {
  rsi: number;
  state: MomentumState;
  expansion: boolean;   // RSI moving away from 50 with increasing slope
  exhaustion: boolean;  // RSI stayed extreme (>70 or <30) then started flattening/reversing
  bullishDivergence: boolean; // price lower low, RSI higher low
  bearishDivergence: boolean; // price higher high, RSI lower high
}

export interface CVDAnalysis {
  cvd: number[];         // cumulative approximated delta series over the window
  trend: 'BULLISH' | 'BEARISH' | 'FLAT';
  bullishDivergence: boolean; // price lower low, CVD higher low
  bearishDivergence: boolean; // price higher high, CVD lower high
  confirmsPrice: boolean;
}

export interface ChaseFlags {
  excessiveEma20Distance: boolean;
  excessiveEma50Distance: boolean;
  excessiveSupportDistance: boolean;
  excessiveBreakoutDistance: boolean;
  largeRecentCandle: boolean;
  excessive24hMove: boolean;
  overextendedRSI: boolean;
  deterioratingRR: boolean;
}

export interface ChaseAnalysis {
  flags: ChaseFlags;
  score: number; // 0-100, higher = more chase risk
  blocked: boolean;
  reasons: string[];
}

export interface EntryConfirmation {
  rejectionCandle: boolean;
  hammer: boolean;
  engulfing: boolean;
  displacementCandle: boolean;
  breakoutConfirmed: boolean;
  breakoutRetestConfirmed: boolean;
  volumeConfirmed: boolean;
  structureConfirmed: boolean;
  liquidityConfirmed: boolean;
  lowerTimeframeConfirmed: boolean | null; // null = 15M/1H data not supplied, not evaluated
  confirmedCount: number;
  confirmed: boolean; // true once enough independent confirmations line up
}

export type ScoreGrade = 'A+' | 'A' | 'B' | 'WATCH' | 'AVOID';

export interface ScoreBreakdown {
  htfTrend: number;       // /15
  marketStructure: number; // /15
  setupQuality: number;    // /15
  entryLocation: number;   // /15
  liquidity: number;       // /10
  volume: number;          // /10
  momentum: number;        // /8
  cvd: number;             // /5
  volatilityRegime: number; // /4
  session: number;         // /3
}

export interface ScoreResult {
  total: number; // 0-100
  grade: ScoreGrade;
  breakdown: ScoreBreakdown;
  bestSetup: SetupKind | null;
}

export type TradeState = 'ENTER' | 'WAIT' | 'AVOID';

export interface EntryDecision {
  state: TradeState;
  reasons: string[];
  score: ScoreResult | null; // null when AVOID fires before the composite score is computed
  chase: ChaseAnalysis | null;
  confirmation: EntryConfirmation | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  regime: MarketRegime | null;
  takeProfitLevels: TakeProfitLevels | null;
  entryZones: EntryZone[] | null;
}

export interface ExitDecision {
  exit: boolean;
  reasons: string[];
}

export interface ManagedPosition {
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  remainingPct: number; // 0-100
  highestPrice: number; // highest close seen since entry — drives trailing stop
  tp1Hit: boolean;
  tp2Hit: boolean;
  breakEvenActivated: boolean;
}

export interface PositionUpdateResult {
  position: ManagedPosition;
  actions: string[];
  closed: boolean; // true once remainingPct reaches 0
  fillPrice: number | null; // the actual level touched (stop or a TP tier), not the candle close — null when nothing closed this update
}

export interface Opportunity {
  symbol: string;
  rank: number;
  state: TradeState;
  score: number;
  grade: ScoreGrade;
  bestSetup: SetupKind | null;
  riskReward: number | null;
}

export interface CandidateState {
  symbol: string;
  regime: MarketRegime;
  htfBullish: boolean;
  structureQuality: number;
  majorSupport: number | null;
  majorResistance: number | null;
  scannedAt: number; // epoch ms
}

export interface TakeProfitLevels {
  tp1: number;
  tp2: number;
  tp3: number;
  rr1: number;
  rr2: number;
  rr3: number;
}
