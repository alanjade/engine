import './utils/env.js';
import http from 'node:http';
import cron from 'node-cron';
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
server.listen(port, () => log(`Health server on port ${port}`));

log(`Signal Engine v3.1 starting. Interval: ${ENV.RUN_INTERVAL_MINUTES} minutes.`);
void runAll();

const interval = ENV.RUN_INTERVAL_MINUTES;
const cronExpr = interval === 240 ? '0 */4 * * *'
  : interval === 60 ? '0 * * * *'
    : interval >= 60 && interval % 60 === 0 ? `0 */${interval / 60} * * *`
      : `*/${interval} * * * *`;

log(`Cron: ${cronExpr}`);
cron.schedule(cronExpr, () => void runAll());
