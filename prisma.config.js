// Prisma 7 reads connection settings from this file instead of schema.prisma.
import { defineConfig } from 'prisma/config';

// Prisma does not load .env on its own. Load it here if present; real
// environment variables (CI, shell) always win.
try {
  process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Empty fallback lets `prisma generate` run (e.g. on `npm install`) before
    // a database is configured. Commands that need a database will fail clearly.
    url: process.env.DATABASE_URL ?? '',
  },
});
