# TT Signal Engine v3.1

Crypto swing trading signal engine. Monitors BTC/ETH/BNB/XRP/DOGE/ADA/AVAX/GRAM/NEAR against USDT across 1D + 4H (macro/structure) and 1H + 15M (setup/entry confirmation). Runs the full ENTER/WAIT/AVOID/EXIT pipeline (regime → structure → setup → entry location → anti-chase → composite score → confirmation) and sends Telegram alerts. Position state, including partial take-profits and trailing-stop progress, is persisted in Supabase.

## Stack

- Node 20+, TypeScript
- `technicalindicators` — EMA, RSI, ATR
- `node-cron` — scheduling
- `@supabase/supabase-js` — signal history + position state
- OHLCV candles via a CORS proxy; live ticker prices via direct exchange REST calls — both fall back across Bybit → Gate → Bitget → OKX if one is geo-blocked, rate-limited, or down

## Setup

```bash
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_URL, SUPABASE_KEY
npm install
npm run dev      # tsx watch, for local development
# or
npm run build && npm start   # compiled, for production
```

Create the `signals` and `positions` tables in Supabase before running — see `migration.sql` (also needed if upgrading from an older deployment: it adds the `tp1`/`tp2`/`tp3`/`highest_price`/`tp1_hit`/`tp2_hit`/`break_even_activated`/`resistance` columns that position management relies on).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | — | Target chat/channel ID |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_KEY` | — | Supabase service/anon key |
| `ACCOUNT_EQUITY` | 10000 | Total account in USDT for position sizing |
| `RUN_INTERVAL_MINUTES` | 240 | Scan interval (240 = every 4H) |
| `PORT` | 3000 | Health-check HTTP server port (`GET /health`) |

## Project structure

```
index.ts                        Entry point: health server + cron scheduler
engine/
  runner.ts                     Per-symbol orchestration — ENTER/WAIT/AVOID
                                 for flat symbols, position management for open ones
  trade-state.ts                decideEntry / decideExit — the ENTER/WAIT/AVOID/EXIT
                                 decision model built on everything below
  regime.ts                     Market regime detection (trend/range/compression/volatility)
  structure.ts                  Swing points, BOS/CHoCH, structure quality
  setups.ts                     Pullback / breakout-retest / liquidity-sweep / compression setups
  entry-location.ts             Entry-zone scoring (support/resistance/EMA/Fib proximity)
  chase.ts                      Anti-chasing gate (DO NOT CHASE conditions)
  confirmation.ts               Entry confirmation (candle patterns, breakout/retest, 15M)
  score.ts                      100-point composite entry score + A+-AVOID grading
  risk.ts                       Stop-loss, take-profit levels, position sizing, RR gates
  position-management.ts        Partial TP1/TP2, break-even, ATR/structure trailing stop
  opportunity.ts                Ranks opportunities across all symbols
  scanner.ts                    Candidate-state scanning
  indicators.ts / candles.ts    EMA, RSI, ATR, volume SMA, candle patterns
  confidence.ts, cvd.ts,
  momentum.ts, volume.ts        Supporting signal components
  config.ts                     Per-symbol config (ATR/RSI/RR/volume thresholds)
  signal.ts                     Legacy BUY/SELL/HOLD pipeline — no longer called by
                                 runner.ts, kept for reference/tests only
services/
  exchange.ts                   Multi-exchange OHLCV (via proxy) + ticker (direct REST),
                                 with fallback ordering and per-timeframe caching
  telegram.ts                   Alert delivery + message formatting (ENTER/WAIT/AVOID/EXIT/
                                 position-update)
  store.ts                      Supabase: signal history + position state
utils/
  env.ts                        .env loader
  logger.ts                     UTC-stamped console logger
types/
  index.ts                      Shared type definitions
migration.sql                   Supabase schema additions for `positions`
```

## Signal logic summary

Each flat symbol is evaluated by `decideEntry` (`engine/trade-state.ts`):

1. Sufficient candle history (4H + 1D)
2. Support / resistance / ATR available
3. Market regime tradable for long (blocks strong/weak downtrend, compression, high volatility)
4. Structure quality >= 40
5. Stop-loss valid (structure + ATR based, bounded, within per-symbol max risk)
6. RR >= per-symbol minimum
7. Anti-chase gate (blocks if overextended from EMA/support/breakout, oversized recent candle, excessive 24H move, overextended RSI, or deteriorating RR)
8. Composite 100-point score (HTF trend, structure, setup quality, entry location, liquidity, volume, momentum, CVD, regime, session) >= 60 to WAIT, >= 70 + full entry confirmation to ENTER

Any hard disqualifier (steps 3, 4, 6, 7) short-circuits straight to **AVOID** — a high composite score can't outvote a structurally broken setup. Everything that clears every gate but hasn't fully confirmed is **WAIT**. Full confirmation plus score >= 70 is **ENTER**.

An open position is handled separately by `updatePosition` (`engine/position-management.ts`) every scan cycle: partial close at TP1 (moves stop to break-even), partial close at TP2 (locks stop at TP1), ATR/structure trailing stop once in profit, and hard exits on stop-loss, final TP, an emergency single-candle crash, or a structural/regime invalidation (bearish CHoCH, trend flip — checked via `decideExit`).

## Position sizing & risk

- 1% account-risk position sizing (`calcPositionSize`), based on `ACCOUNT_EQUITY`
- Max 2 concurrent open positions (`validateMaxExposure` in `engine/runner.ts`)
- Per-symbol max stop-loss risk enforced in `calcStopLoss`