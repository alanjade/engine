import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { err } from '../utils/logger.js';
import type { SignalResult, StoredPosition } from '../types/index.js';

const { SUPABASE_URL, SUPABASE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment.');
}

const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

async function query<T>(fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>, label: string): Promise<T | null> {
  const { data, error } = await fn();
  if (error) { err(`[store:${label}]`, error.message); return null; }
  return data;
}

// ── Signal history ────────────────────────────────────────────────────────────

export async function saveSignal(sig: SignalResult): Promise<void> {
  const asBuy = 'entry' in sig ? sig : null;
  await query(() => db.from('signals').insert({
    signal_id: sig.signal_id,
    timestamp: sig.timestamp,
    symbol: sig.symbol,
    signal: sig.signal,
    entry: asBuy?.entry ?? null,
    stop_loss: 'stop_loss' in sig ? sig.stop_loss : null,
    take_profit: 'take_profit' in sig ? sig.take_profit : null,
    support: asBuy?.support ?? null,
    confidence: asBuy?.confidence ?? null,
  }), 'saveSignal');
}

// Logs a decideEntry/decideExit result. Kept separate from saveSignal above
// because that function's type is tied to the legacy BuySignal/SellSignal/
// HoldSignal union — reusing it here would mean lying to the type checker
// about what a TradeState decision is. Same `signals` table/columns; the
// `signal` column just holds ENTER/WAIT/AVOID/EXIT instead of BUY/SELL/HOLD.
//
// Called for all four states (Phase 20 paper trading needs WAIT/AVOID logged
// too, not just ENTER/EXIT, to reconstruct what the engine would have done).
export async function saveDecision(input: {
  symbol: string;
  state: 'ENTER' | 'WAIT' | 'AVOID' | 'EXIT';
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number | null;
  reason?: string | null;
  /** Actual fill price for EXIT rows — distinct from takeProfit, which is the target, not what it closed at. */
  exitPrice?: number | null;
}): Promise<void> {
  await query(() => db.from('signals').insert({
    signal_id: null,
    timestamp: new Date().toISOString(),
    symbol: input.symbol,
    signal: input.state,
    entry: input.entry,
    stop_loss: input.stopLoss,
    take_profit: input.takeProfit,
    support: input.entry, // reused as the dedup band anchor for isDuplicate()
    confidence: input.confidence,
    reason: input.reason ?? null,
    exit_price: input.exitPrice ?? null,
  }), 'saveDecision');
}

export async function getRecentSignals(symbol: string, hours = 24): Promise<any[]> {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const data = await query<any[]>(() =>
    db.from('signals')
      .select('*')
      .eq('symbol', symbol)
      .gte('timestamp', since)
      .order('timestamp', { ascending: false })
      .limit(50),
    'getRecentSignals',
  );
  return data ?? [];
}

/** Every signal-log row across all symbols since N hours ago, oldest first — for paper-trading reports (getRecentSignals is single-symbol and newest-first, built for the dedup check, not reporting). */
export async function getSignalsSince(hours: number, symbol?: string): Promise<any[]> {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  let builder = db.from('signals').select('*').gte('timestamp', since).order('timestamp', { ascending: true });
  if (symbol) builder = builder.eq('symbol', symbol);
  const data = await query<any[]>(() => builder, 'getSignalsSince');
  return data ?? [];
}

// ── Duplicate check ───────────────────────────────────────────────────────────
// Dedup key: symbol + signal_type + support level within 0.5% band

function supportBand(price: number | null | undefined): number {
  if (!price) return 0;
  const band = price * 0.005;
  return Math.round(price / band) * band;
}

export async function isDuplicate(symbol: string, signalType: string, supportLevel: number | null | undefined): Promise<boolean> {
  const recent = await getRecentSignals(symbol, 24);
  const band = supportBand(supportLevel);
  return recent.some(s =>
    s.signal === signalType &&
    s.support != null &&
    Math.abs(s.support - band) / (band || 1) < 0.005,
  );
}

// ── Position state ────────────────────────────────────────────────────────────

function emptyPosition(symbol: string): StoredPosition {
  return { symbol, status: 'NONE', entry: null, stop_loss: null, take_profit: null, size: null, remaining: null };
}

export async function getPosition(symbol: string): Promise<StoredPosition> {
  const data = await query<StoredPosition>(() =>
    db.from('positions').select('*').eq('symbol', symbol).maybeSingle(),
    'getPosition',
  );
  return data ?? emptyPosition(symbol);
}

export async function upsertPosition(pos: Partial<StoredPosition> & { symbol: string }): Promise<void> {
  await query(() =>
    db.from('positions').upsert({ ...pos, updated_at: new Date().toISOString() }, { onConflict: 'symbol' }),
    'upsertPosition',
  );
}

export async function getAllPositions(): Promise<StoredPosition[]> {
  const data = await query<StoredPosition[]>(() =>
    db.from('positions').select('*').eq('status', 'OPEN'),
    'getAllPositions',
  );
  return data ?? [];
}

export async function countOpenPositions(): Promise<number> {
  const { count, error } = await db
    .from('positions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'OPEN');
  if (error) { err('[store:countOpenPositions]', error.message); return 0; }
  return count ?? 0;
}
