import './utils/env.js';
import http from 'node:http';
import { runAll } from './engine/runner.js';
import { ENV } from './utils/env.js';
import { log } from './utils/logger.js';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
    return;
  }
  res.writeHead(404);
  res.end();
});

const port = Number(process.env.PORT ?? 3000);
if (!Number.isFinite(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT: "${process.env.PORT}" — must be a number between 1 and 65535.`);
}
server.listen(port, () => log(`Health server on port ${port}`));

log(`Signal Engine v3.1 starting. Interval: ${ENV.RUN_INTERVAL_MINUTES} minutes.`);
void runAll();

// setInterval instead of a cron expression: RUN_INTERVAL_MINUTES is an
// arbitrary user-supplied number of minutes, and cron's minute field can't
// represent that correctly in general — `*/90` is out of cron's valid
// 0-59 range for the minute field (undefined/invalid behavior depending on
// the parser), and `*/45` fires at :00 and :45 each hour, which is a
// 45-then-15-minute alternating gap, not an even 45-minute interval.
// setInterval just works for any positive interval.
const intervalMs = ENV.RUN_INTERVAL_MINUTES * 60 * 1000;
log(`Scheduling runAll every ${ENV.RUN_INTERVAL_MINUTES} minutes.`);
setInterval(() => void runAll(), intervalMs);
