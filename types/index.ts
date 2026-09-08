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
