import { createClient } from '@supabase/supabase-js';
import { err, warn } from '../utils/logger.js';

const { SUPABASE_URL, SUPABASE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment.');
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function query(fn, label) {
  const { data, error } = await fn();
  if (error) { err(`[store:${label}]`, error.message); return null; }
  return data;
}

// ── Signal history ────────────────────────────────────────────────────────────

export async function saveSignal(sig) {
  await query(() => db.from('signals').insert({
    signal_id:   sig.signal_id,
    timestamp:   sig.timestamp,
    symbol:      sig.symbol,
    signal:      sig.signal,
    entry:       sig.entry       ?? null,
    stop_loss:   sig.stop_loss   ?? null,
    take_profit: sig.take_profit ?? null,
    support:     sig.support     ?? null,
    confidence:  sig.confidence  ?? null,
  }), 'saveSignal');
}

export async function getRecentSignals(symbol, hours = 24) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const data = await query(() =>
    db.from('signals')
      .select('*')
      .eq('symbol', symbol)
      .gte('timestamp', since)
      .order('timestamp', { ascending: false })
      .limit(50),
    'getRecentSignals'
  );
  return data ?? [];
}

// ── Duplicate check ───────────────────────────────────────────────────────────
// Dedup key: symbol + signal_type + support level within 0.5% band

function supportBand(price) {
  if (!price) return 0;
  const band = price * 0.005;
  return Math.round(price / band) * band;
}

export async function isDuplicate(symbol, signalType, supportLevel) {
  const recent = await getRecentSignals(symbol, 24);
  const band   = supportBand(supportLevel);
  return recent.some(s =>
    s.signal === signalType &&
    s.support != null &&
    Math.abs(s.support - band) / (band || 1) < 0.005
  );
}

// ── Position state ────────────────────────────────────────────────────────────

const EMPTY_POS = (symbol) => ({
  symbol, status: 'NONE',
  entry: null, stop_loss: null, take_profit: null,
  size: null, remaining: null,
});

export async function getPosition(symbol) {
  const data = await query(() =>
    db.from('positions').select('*').eq('symbol', symbol).maybeSingle(),
    'getPosition'
  );
  return data ?? EMPTY_POS(symbol);
}

export async function upsertPosition(pos) {
  await query(() =>
    db.from('positions').upsert({
      ...pos,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'symbol' }),
    'upsertPosition'
  );
}

export async function getAllPositions() {
  const data = await query(() =>
    db.from('positions').select('*').eq('status', 'OPEN'),
    'getAllPositions'
  );
  return data ?? [];
}

export async function countOpenPositions() {
  const data = await query(() =>
    db.from('positions').select('symbol', { count: 'exact', head: true }).eq('status', 'OPEN'),
    'countOpenPositions'
  );
  // supabase returns count on the response object — re-query with count
  const { count, error } = await db
    .from('positions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'OPEN');
  if (error) { err('[store:countOpenPositions]', error.message); return 0; }
  return count ?? 0;
}
