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
