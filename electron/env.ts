import fs from 'node:fs';
import path from 'node:path';
import { envFilePath, logsDir } from './paths';

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let loaded = false;

/** Loads .env into process.env without overriding real environment variables. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    const file = envFilePath();
    if (!fs.existsSync(file)) return;
    const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  } catch (error) {
    logLine(`[env] failed to load .env: ${String(error)}`);
  }
}

export function logLine(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  // eslint-disable-next-line no-console
  console.log(stamped);
  try {
    fs.appendFileSync(path.join(logsDir(), 'main.log'), `${stamped}\n`, 'utf8');
  } catch {
    /* logging must never crash the app */
  }
}
