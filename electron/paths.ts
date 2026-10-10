import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface ElectronLike {
  isPackaged: boolean;
  getAppPath: () => string;
  getPath: (name: string) => string;
}

function electronApp(): ElectronLike | null {
  try {
    // Lazy require so non-Electron tooling (smoke tests, scripts) can load these modules.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron') as { app?: ElectronLike; default?: { app?: ElectronLike } };
    const candidate = mod?.app ?? mod?.default?.app ?? null;
    return candidate && typeof candidate.getAppPath === 'function' ? candidate : null;
  } catch {
    return null;
  }
}

let cachedRoot: string | null = null;

/** Absolute path of the project/app root (contains package.json). */
export function appRoot(): string {
  if (cachedRoot) return cachedRoot;
  const app = electronApp();
  if (app?.isPackaged) {
    cachedRoot = path.dirname(app.getAppPath());
  } else if (app) {
    // dev: this file lives at <root>/dist/main/electron/paths.js
    cachedRoot = path.resolve(__dirname, '..', '..', '..');
  } else {
    cachedRoot = process.env.InternPULSE_ROOT ?? process.cwd();
  }
  return cachedRoot;
}

/** Directory where runtime artefacts (db, uploads, logs, screenshots) live. */
export function runtimeDir(): string {
  const app = electronApp();
  const base = app ? app.getPath('userData') : path.join(os.homedir(), '.internpulse-ai');
  const dir = path.join(base, 'internpulse');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function uploadsDir(): string {
  const dir = path.join(runtimeDir(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function screenshotsDir(): string {
  const dir = path.join(runtimeDir(), 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function logsDir(): string {
  const dir = path.join(runtimeDir(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Prisma migrations directory (shipped next to the packaged bundle). */
export function migrationsDir(): string {
  const candidates = [
    path.join(appRoot(), 'prisma', 'migrations'),
    path.join(process.cwd(), 'prisma', 'migrations'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

/** SQLite connection string used by the running application. */
export function databaseUrl(): string {
  if (process.env.DATABASE_URL_OVERRIDE) {
    return process.env.DATABASE_URL_OVERRIDE;
  }
  const file = path.join(runtimeDir(), 'internpulse.db');
  return `file:${file.replace(/\\/g, '/')}`;
}

export function envFilePath(): string {
  const candidates = [path.join(appRoot(), '.env'), path.join(process.cwd(), '.env')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}
