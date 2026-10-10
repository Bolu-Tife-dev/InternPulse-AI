// Asserts that a packaged app.asar contains every file the runtime needs.
// Guards against the class of bugs where electron-builder silently drops
// files (e.g. the renderer bundle or the generated Prisma client) and the
// installed app boots into a blank window or crashes.
//
// Usage: node scripts/verify-package.js <path-to-unpacked-dir-or-asar>
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function findAsar(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return target;
  const stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'app.asar') return full;
      if (entry.isDirectory()) stack.push(full);
    }
  }
  throw new Error(`No app.asar found under ${target}`);
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/verify-package.js <path-to-unpacked-dir-or-asar>');
  process.exit(2);
}

const asar = findAsar(target);
console.log(`Verifying ${asar}`);

const raw = execSync(`npx asar list "${asar}"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const entries = raw
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/\\/g, '/').replace(/^\/+/, ''))
  .filter(Boolean);

const required = [
  'dist/renderer/index.html',
  'dist/main/electron/main.js',
  'dist/main/electron/preload.js',
  'dist/main/electron/db.js',
  'prisma/generated/client/default.js',
  'prisma/migrations',
];

let failed = false;
for (const req of required) {
  const ok = entries.includes(req) || entries.some((e) => e.startsWith(`${req}/`));
  console.log(`  ${ok ? 'OK  ' : 'MISS'} ${req}`);
  if (!ok) failed = true;
}

const hasRendererJs = entries.some((e) => /^dist\/renderer\/assets\/.+\.js$/.test(e));
console.log(`  ${hasRendererJs ? 'OK  ' : 'MISS'} dist/renderer/assets/*.js`);
if (!hasRendererJs) failed = true;

const hasMigrationSql = entries.some((e) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(e));
console.log(`  ${hasMigrationSql ? 'OK  ' : 'MISS'} prisma/migrations/*/migration.sql`);
if (!hasMigrationSql) failed = true;

if (failed) {
  console.error('Package verification FAILED — the installed app would be broken.');
  process.exit(1);
}
console.log('Package verification passed.');
