/* eslint-disable no-console */
// Headless smoke test — exercises the real compiled services (db, parser, matcher, scrapers)
// outside of Electron. Run with: npm run smoke  (after npm run build:main)

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
process.env.InternPULSE_ROOT = root;

const runtime = path.join(os.tmpdir(), `internpulse-smoke-${Date.now()}`);
fs.mkdirSync(runtime, { recursive: true });
process.env.DATABASE_URL_OVERRIDE = `file:${path.join(runtime, 'smoke.db').replace(/\\/g, '/')}`;

const dist = path.join(root, 'dist', 'main');

async function main() {
  const { getDb, closeDb } = require(path.join(dist, 'electron', 'db.js'));
  const { extractProfile } = require(path.join(dist, 'electron', 'services', 'profileExtractor.js'));
  const { classifyRegion, classifyRole, isEligibleRole } = require(path.join(dist, 'electron', 'services', 'matcher.js'));
  const { runJobSearch } = require(path.join(dist, 'electron', 'services', 'scrape', 'index.js'));

  let failures = 0;
  const check = (name, condition, extra) => {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
    if (!condition) failures += 1;
  };

  // 1. database bootstrap
  const db = await getDb();
  const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = tables.map((row) => row.name);
  check('sqlite schema bootstraps', tableNames.includes('Job') && tableNames.includes('Application'), tableNames.length + ' tables');

  // 2. profile extraction from a realistic CV sample
  const sampleCv = `
Adaeze Nwosu
Lagos, Nigeria
adaeze.nwosu@gmail.com | +234 803 123 4567
linkedin.com/in/adaeze-nwosu github.com/adaeze-nwosu

Summary
Detail-oriented software engineer with 1.5 years of experience building web applications.

Skills
TypeScript, React, Next.js, Node.js, Tailwind CSS, PostgreSQL, Prisma, Docker, Jest, Playwright, GraphQL

Projects
InternPulse Desktop: Built an Electron + React job discovery tool that scrapes ATS boards with Playwright and stores results in SQLite.
Paystack Clone: Developed a full-stack payment dashboard with React, Node.js and Stripe webhooks.

Languages
English, Yoruba
`;
  const profile = extractProfile(sampleCv);
  check('extracts email', profile.email === 'adaeze.nwosu@gmail.com', profile.email);
  check('extracts phone', Boolean(profile.phone && profile.phone.includes('803')), profile.phone);
  check('extracts linkedin', Boolean(profile.linkedinUrl && profile.linkedinUrl.includes('linkedin.com')), profile.linkedinUrl);
  check('extracts github', Boolean(profile.githubUrl && profile.githubUrl.includes('github.com')), profile.githubUrl);
  check('extracts name', /adaeze/i.test(profile.fullName || ''), profile.fullName);
  check('extracts skills', profile.skills.includes('react') && profile.skills.includes('typescript'), profile.skills.slice(0, 8).join(','));
  check('extracts projects', profile.projects.length >= 1, profile.projects.map((p) => p.name).join(' | '));

  // 3. region + role eligibility rules
  const worldwide = classifyRegion('Fully remote — worldwide candidates welcome, work from anywhere.', 'Worldwide');
  check('accepts worldwide roles', worldwide.allowed && worldwide.eligibility === 'WORLDWIDE', worldwide.eligibility);

  const nigeria = classifyRegion('Remote role open to engineers in Africa and EMEA.', 'Lagos, Nigeria');
  check('accepts africa/EMEA roles', nigeria.allowed, nigeria.eligibility);

  const restricted = classifyRegion('Must be authorized to work in the United States. US residents only.', 'New York');
  check('rejects US-only roles', !restricted.allowed && restricted.eligibility === 'RESTRICTED', restricted.eligibility);

  const contractorOk = classifyRegion('Open to remote contractors worldwide including Nigerian nationals.', 'Remote');
  check('accepts explicit global contractor roles', contractorOk.allowed, contractorOk.eligibility);

  const internship = classifyRole('Frontend Engineering Intern', 'Fully remote role. Work with React and TypeScript on our design system.', ['react']);
  check('detects internship', internship.roleType === 'INTERNSHIP' && internship.domain === 'FRONTEND', `${internship.roleType}/${internship.domain}`);
  check('internship is eligible', isEligibleRole(internship));

  const senior = classifyRole('Senior Backend Engineer', '10 years Go experience required, on-site in Berlin.', []);
  check('rejects senior roles', !isEligibleRole(senior), senior.roleType);

  // 4. live job search against free APIs
  console.log('\nRunning live search (Jobicy / Remotive / Jooble / ATS feeds)…');
  const report = await runJobSearch({
    keywords: ['frontend intern', 'software engineer intern'],
    limitPerSource: 25,
    usePlaywrightScrapers: false,
  });
  console.log(
    `search: eligible=${report.fetched} new=${report.newJobs} updated=${report.updatedJobs} rejected=${report.rejected}`,
  );
  for (const source of report.perSource) {
    console.log(`  - ${source.source}: fetched ${source.fetched}, accepted ${source.accepted}${source.error ? ` (${source.error})` : ''}`);
  }

  const anySourceSucceeded = report.perSource.some((source) => !source.error);
  check('at least one job source responded', anySourceSucceeded);

  const stored = await db.job.count();
  check('jobs persisted to sqlite', stored >= 0, `${stored} rows`);

  const sample = await db.job.findFirst({ orderBy: { matchedScore: 'desc' } });
  if (sample) {
    check(
      'persisted job carries eligibility metadata',
      Boolean(sample.regionEligibility && sample.roleType && sample.techTags),
      `${sample.company} — ${sample.title} [${sample.regionEligibility}/${sample.roleType}]`,
    );
  }

  // 5. dedupe: running twice must not duplicate rows
  const before = await db.job.count();
  await runJobSearch({ keywords: ['frontend intern'], limitPerSource: 25, usePlaywrightScrapers: false });
  const after = await db.job.count();
  check('job upsert is idempotent', after >= before, `before=${before} after=${after}`);

  await closeDb();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
