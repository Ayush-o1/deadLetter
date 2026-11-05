// Process entrypoint: load config, connect, listen, and shut down cleanly.
import { createApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { createDb } from './db/client.js';

loadDotEnv();
const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = createApp({ db });

const server = app.listen(config.port, () => {
  console.log(`deadLetter listening on http://localhost:${config.port}`);
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
