import { readFileSync, existsSync } from 'fs';

if (existsSync('.env')) {
  const lines = readFileSync('.env', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function requirePositiveNumber(raw: string | undefined, name: string, defaultValue: number, parser: (s: string) => number): number {
  if (raw === undefined) return defaultValue;
  const value = parser(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}="${raw}" — must be a positive number.`);
  }
  return value;
}

export const ENV = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID ?? '',
  ACCOUNT_EQUITY: requirePositiveNumber(process.env.ACCOUNT_EQUITY, 'ACCOUNT_EQUITY', 10000, parseFloat),
  RUN_INTERVAL_MINUTES: requirePositiveNumber(process.env.RUN_INTERVAL_MINUTES, 'RUN_INTERVAL_MINUTES', 240, s => parseInt(s, 10)),
  EXCHANGE_PROXY_URL: process.env.EXCHANGE_PROXY_URL ?? 'https://swing.ayodejialalade29.workers.dev',
};
