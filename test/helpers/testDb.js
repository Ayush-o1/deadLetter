// Test database helpers.
//
// Safety rule: tests delete data. They may only ever touch a database whose name
// ends in "_test", so a misconfigured DATABASE_URL can never wipe development data.
import { userInfo } from 'node:os';
import { createDb } from '../../src/db/client.js';

// Default for a local Postgres where your OS user is a database user. CI and
// other setups set TEST_DATABASE_URL explicitly.
const DEFAULT_URL = `postgresql://${userInfo().username}@localhost:5432/deadletter_test`;

export function getTestDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": database name must end in _test`);
  }
  return url;
}

export function createTestDb() {
  return createDb(getTestDatabaseUrl());
}

/** Empty every application table (not Prisma's own migration table). */
export async function resetDb(db) {
  const rows = await db.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}
