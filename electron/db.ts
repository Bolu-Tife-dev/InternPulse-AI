import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient, Setting } from '../prisma/generated/client';
import { logLine } from './env';
import { databaseUrl, migrationsDir } from './paths';

// The generated Prisma client is loaded at runtime from the COMPILED file
// location (dist/main/electron/db.js), which is one directory level deeper
// than this source file — tsc does not rewrite relative import paths, so
// the static import above is type-only and the require below resolves the
// real runtime path in both dev and the packaged asar.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient: PrismaClientCtor } = require('../../../prisma/generated/client') as {
  PrismaClient: new (options?: { log?: ('warn' | 'error')[] }) => PrismaClient;
};

/** Splits a SQLite migration script into individual statements (quote aware). */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    const prev = script[i - 1];
    if (quote) {
      current += char;
      if (char === quote && prev !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements.filter((statement) => !/^(--|\/\*)/.test(statement.trim()) || statement.includes('CREATE'));
}

async function applyPendingMigrations(client: PrismaClient): Promise<void> {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    logLine(`[db] no migrations directory at ${dir}`);
    return;
  }
  const folders = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let applied = 0;
  for (const folder of folders) {
    const sqlPath = path.join(dir, folder, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;
    const already = await client.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_applied_migrations'",
    ).catch(() => [] as { name: string }[]);
    if (!already.length) {
      await client.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS _applied_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
    }
    const rows = await client.$queryRawUnsafe<{ name: string }[]>(
      'SELECT name FROM _applied_migrations WHERE name = ?',
      folder,
    );
    if (rows.length) continue;

    const script = fs.readFileSync(sqlPath, 'utf8');
    for (const statement of splitSqlStatements(script)) {
      await client.$executeRawUnsafe(statement);
    }
    await client.$executeRawUnsafe(
      'INSERT INTO _applied_migrations (name, applied_at) VALUES (?, ?)',
      folder,
      new Date().toISOString(),
    );
    applied += 1;
    logLine(`[db] applied migration ${folder}`);
  }
  if (applied === 0) logLine('[db] schema already up to date');
}

let client: PrismaClient | null = null;

export async function getDb(): Promise<PrismaClient> {
  if (client) return client;
  process.env.DATABASE_URL = databaseUrl();
  client = new PrismaClientCtor({ log: ['warn', 'error'] });
  await applyPendingMigrations(client);
  await client.$connect();
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/** Key/value settings with environment fallback. */
export async function getSetting(key: string, fallback = ''): Promise<string> {
  const db = await getDb();
  const row: Setting | null = await db.setting.findUnique({ where: { key } });
  if (row && row.value !== '') return row.value;
  return process.env[key] ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  const map: Record<string, string> = {};
  for (const key of keys) {
    const row = rows.find((item) => item.key === key);
    map[key] = row && row.value !== '' ? row.value : (process.env[key] ?? '');
  }
  return map;
}
