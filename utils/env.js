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

export const ENV = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? '',
  TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID   ?? '',
  ACCOUNT_EQUITY:     parseFloat(process.env.ACCOUNT_EQUITY ?? '10000'),
  RUN_INTERVAL_MINUTES: parseInt(process.env.RUN_INTERVAL_MINUTES ?? '240', 10),
};
