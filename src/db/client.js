// Prisma client factory. The client is created explicitly (not at import time)
// so tests can point it at the test database and always close it afterwards.
//
// Prisma 7 generates TypeScript-syntax files into src/generated. Node runs them
// directly, so no build step is needed. See docs/DECISIONS.md, D3.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client.ts';

/**
 * @param {string} connectionString
 * @returns {PrismaClient}
 */
export function createDb(connectionString) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
