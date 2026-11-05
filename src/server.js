// Process entrypoint: load config, connect, listen, and shut down cleanly.
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createServices } from './composition.js';
import { loadConfig, loadDotEnv } from './config.js';
import { createDb } from './db/client.js';

loadDotEnv();
const config = loadConfig();
const db = createDb(config.databaseUrl);
const services = createServices({ db, config });
const interrupted = await services.start();
if (interrupted > 0) console.log(`Marked ${interrupted} run(s) interrupted by the last shutdown`);
const app = createApp({
  db,
  services,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
});

// Bind to the loopback interface only: there are no accounts, so the server must
// not be reachable from the network unless HOST says so.
const server = app.listen(config.port, config.host, () => {
  console.log(`deadLetter listening on http://${config.host}:${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
  // If connections hang, do not wait forever.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
