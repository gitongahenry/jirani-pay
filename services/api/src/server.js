import { openDb } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { config, paypalConfigured } from './config.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const db = openDb();
seed(db);
const app = createApp(db);
// Serve the PWA from the same origin (also what makes the community gateway work on one Wi-Fi address).
app.serveStatic(process.env.WEB_DIR || join(here, '../../../apps/web/public'), { '/nlu.js': join(here, 'nlu.js') });
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Jirani API on :${config.port} | payments: ${paypalConfigured() ? 'PayPal SANDBOX' : 'SIMULATED (set PAYPAL_CLIENT_ID/SECRET for sandbox)'} | model service: ${config.aiUrl || 'off (rules only)'}`);
});
