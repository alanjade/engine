# TT Signal Engine v3.1

Crypto swing trading signal engine. Monitors BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT on Binance Spot. Evaluates 4H + 1D structure, emits BUY/SELL/HOLD signals, sends Telegram alerts.

## Stack

- Node 20+
- `ccxt` — Binance data
- `technicalindicators` — EMA, RSI, ATR
- `node-cron` — scheduling
- `better-sqlite3` — signal history + position state

## Setup

```bash
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
npm install
node index.js
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | — | Target chat/channel ID |
| `ACCOUNT_EQUITY` | 10000 | Total account in USDT for position sizing |
| `RUN_INTERVAL_MINUTES` | 240 | Scan interval (240 = every 4H) |

## Project structure

```
index.js                 Entry point + cron scheduler
engine/
  signal.js              Final decision engine (all 18 steps)
  indicators.js          EMA, RSI, ATR, volume SMA
  structure.js           Support / resistance pivot detection
  candles.js             Rejection candle patterns
  confidence.js          Confidence scoring model
  runner.js              Per-symbol orchestration
services/
  exchange.js            Binance OHLCV + ticker via ccxt
  telegram.js            Alert delivery + message formatting
  store.js               SQLite: signal history + position state
utils/
  env.js                 .env loader
  logger.js              UTC-stamped console logger
data/
  signals.db             Auto-created on first run (gitignored)
```

## Signal logic summary

1. Data validity
2. Portfolio limits (max 2 open, max 3% risk)
3. Open position check → route to SELL if OPEN
4. 1D trend filter (EMA50 > EMA200)
5. 4H EMA trend strength (>1.5% distance)
6. Sideways filter (EMA cross count)
7. Support quality (score ≥ 2)
8. Resistance quality (score ≥ 2)
9. Volume ratio ≥ 1.2
10. RSI 55–70
11. ATR% ≥ per-symbol minimum
12. SL validity and range resolution
13. RR ≥ 1.5
14. Confirmation candle pattern
15. 24h deduplication (symbol + type + support band)
16. Confidence ≥ 75
17. Signal generation
18. Telegram alert
