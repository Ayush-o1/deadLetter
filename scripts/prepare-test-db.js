// Runs before `npm test`: makes sure the test database exists and has the
// current schema. Safe to run repeatedly.
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { getTestDatabaseUrl } from '../test/helpers/testDb.js';

const url = new URL(getTestDatabaseUrl());
const dbName = url.pathname.slice(1);

// Connect to the maintenance database to create the test database if missing.
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rowCount === 0) {
    // Identifier comes from our own validated URL, and CREATE DATABASE cannot be parameterised.
    await client.query(`CREATE DATABASE "${dbName.replaceAll('"', '')}"`);
    console.log(`Created database ${dbName}`);
  }
} finally {
  await client.end();
}

execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url.toString() },
});
