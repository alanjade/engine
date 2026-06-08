import './utils/env.js';
import http from 'http';
import cron from 'node-cron';
import { runAll } from './engine/runner.js';
import { ENV } from './utils/env.js';
import { log } from './utils/logger.js';

// Health check server — keeps Render alive via UptimeRobot pings
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => log(`Health server on port ${PORT}`));

log(`Signal Engine v3.1 starting. Interval: ${ENV.RUN_INTERVAL_MINUTES} minutes.`);

runAll();

const interval = ENV.RUN_INTERVAL_MINUTES;
let cronExpr;
if (interval === 240)                          cronExpr = '0 */4 * * *';
else if (interval === 60)                      cronExpr = '0 * * * *';
else if (interval >= 60 && interval % 60 === 0) cronExpr = `0 */${interval / 60} * * *`;
else                                           cronExpr = `*/${interval} * * * *`;

log(`Cron: ${cronExpr}`);
cron.schedule(cronExpr, () => runAll());