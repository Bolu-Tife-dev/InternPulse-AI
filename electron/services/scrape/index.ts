import { getDb, getSetting } from '../../db';
import type { SearchReport, SearchRequest } from '../../../shared/types';
import { classifyRegion, classifyRole, isEligibleRole } from '../matcher';
import { extractTechTags } from '../profileExtractor';
import { normalizeSkillList } from '../skillLexicon';
import { searchAshby, searchGreenhouse, searchLever, searchWorkday } from './atsFeeds';
import { scrapeAtsPage } from './atsPlaywright';
import { extractEmails, detectAtsType } from './http';
import { searchJooble } from './jooble';
import { searchJobicy } from './jobicy';
import { searchRemotive } from './remotive';
import type { RawJob, SourceResult } from './types';

const DEFAULT_KEYWORDS = ['frontend intern', 'software engineer intern', 'full stack intern', 'graduate software engineer'];

// Curated public ATS boards that actively hire interns/new grads worldwide.
// Users can replace this list entirely from Settings (GREENHOUSE_BOARDS / LEVER_COMPANIES / ASHBY_BOARDS).
export const DEFAULT_GREENHOUSE_BOARDS = [
  'stripe',
  'robinhood',
  'databricks',
  'affirm',
  'datadog',
  'anthropic',
  'figma',
  'scaleai',
  'cloudflare',
  'samsara',
  'mongodb',
  'twilio',
  'vercel',
  'gitlab',
  'canonical',
];
export const DEFAULT_LEVER_COMPANIES = ['palantir'];
export const DEFAULT_ASHBY_BOARDS = ['notion', 'perplexity', 'openai', 'ramp'];

function csv(value: string): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function looksLikeInternship(raw: RawJob): boolean {
  const haystack = `${raw.title} ${raw.tags?.join(' ') ?? ''}`.toLowerCase();
  return /\b(intern(ship)?|apprentice|graduate trainee|new grad|entry[\s-]?level|junior|co-?op|student)\b/.test(haystack);
}

function genericKeywordPass(raw: RawJob, keywords: string[]): boolean {
  if (looksLikeInternship(raw)) return true;
  const haystack = `${raw.title} ${raw.tags?.join(' ') ?? ''}`.toLowerCase();
  return keywords.some((keyword) => {
    const tokens = keyword.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
  });
}

async function collectSources(request: SearchRequest): Promise<SourceResult[]> {
  const keywords = request.keywords?.length ? request.keywords : DEFAULT_KEYWORDS;
  const limit = request.limitPerSource ?? 50;
  const results: SourceResult[] = [];
  const include = request.includeSources?.length
    ? new Set(request.includeSources)
    : new Set(['jobicy', 'remotive', 'jooble', 'greenhouse', 'lever', 'ashby', 'workday', 'playwright']);

  const promises: Array<Promise<SourceResult>> = [];

  if (include.has('jobicy')) promises.push(searchJobicy(keywords, limit));
  if (include.has('remotive')) promises.push(searchRemotive(keywords, limit));
  if (include.has('jooble')) {
    const joobleKey = await getSetting('JOOBLE_API_KEY');
    promises.push(searchJooble(keywords, joobleKey, limit));
  }

  if (include.has('greenhouse')) {
    const configured = csv(await getSetting('GREENHOUSE_BOARDS'));
    for (const board of configured.length ? configured : DEFAULT_GREENHOUSE_BOARDS) {
      promises.push(searchGreenhouse(board, limit));
    }
  }
  if (include.has('lever')) {
    const configured = csv(await getSetting('LEVER_COMPANIES'));
    for (const company of configured.length ? configured : DEFAULT_LEVER_COMPANIES) {
      promises.push(searchLever(company, limit));
    }
  }
  if (include.has('ashby')) {
    const configured = csv(await getSetting('ASHBY_BOARDS'));
    for (const board of configured.length ? configured : DEFAULT_ASHBY_BOARDS) {
      promises.push(searchAshby(board, limit));
    }
  }
  if (include.has('workday')) {
    for (const tenant of csv(await getSetting('WORKDAY_TENANTS'))) {
      promises.push(searchWorkday(tenant, 'intern', limit));
    }
  }

  if (include.has('playwright')) {
    for (const customUrl of request.customUrls ?? []) {
      promises.push(scrapeAtsPage(customUrl, { headless: true, maxPages: 20 }));
    }
  }

  const settled = await Promise.all(promises);
  results.push(...settled);
  return results;
}

export async function runJobSearch(request: SearchRequest): Promise<SearchReport> {
  const db = await getDb();
  const startedAt = new Date();
  const keywords = request.keywords?.length ? request.keywords : DEFAULT_KEYWORDS;

  const run = await db.syncRun.create({ data: { kind: 'JOBS', status: 'RUNNING', detail: keywords.join(', ') } });

  const sources = await collectSources(request);
  const perSource: SearchReport['perSource'] = [];
  let fetched = 0;
  let newJobs = 0;
  let updatedJobs = 0;
  let rejected = 0;

  for (const result of sources) {
    let accepted = 0;
    for (const raw of result.jobs) {
      if (!raw.title || !raw.url) continue;
      if (!genericKeywordPass(raw, keywords)) {
        rejected += 1;
        continue;
      }

      const descriptionText = raw.description ?? '';
      const region = classifyRegion(`${raw.title}\n${descriptionText}`, raw.location);
      const role = classifyRole(raw.title, descriptionText, raw.tags ?? [], raw.location);
      const score = isEligibleRole(role) ? role.score + Math.round(region.confidence * 20) : Math.round(role.score * 0.4);

      // Strict eligibility gate: internship/junior software roles, fully remote, acceptable region
      const eligible = isEligibleRole(role) && region.allowed && raw.url.startsWith('http');
      if (!eligible) {
        rejected += 1;
        continue;
      }

      fetched += 1;
      accepted += 1;

      const techTags = normalizeSkillList([...(raw.tags ?? []), ...extractTechTags(descriptionText)]).slice(0, 16);
      const atsType = (raw.atsType ?? detectAtsType(raw.applyUrl ?? raw.url) ?? 'UNKNOWN') as
        | 'GREENHOUSE'
        | 'LEVER'
        | 'ASHBY'
        | 'BAMBOOHR'
        | 'WORKDAY'
        | 'EMAIL'
        | 'UNKNOWN';
      const emails = raw.applyEmail ? [raw.applyEmail] : extractEmails(`${descriptionText.slice(0, 3000)}`);
      const applyEmail = emails.find((value) => /jobs?|careers?|apply|talent|recruit|hr|people|team/i.test(value)) ?? emails[0] ?? null;

      const existing = await db.job.findUnique({
        where: { source_sourceId: { source: result.source, sourceId: raw.sourceId } },
      });

      const data = {
        company: raw.company,
        title: raw.title,
        url: raw.url,
        applyUrl: raw.applyUrl ?? (atsType === 'EMAIL' ? null : raw.url),
        applyEmail: atsType === 'EMAIL' ? applyEmail : applyEmail,
        atsType,
        description: descriptionText.slice(0, 60000),
        descriptionHtml: (raw.descriptionHtml ?? '').slice(0, 60000),
        salary: raw.salary ?? null,
        location: raw.location ?? null,
        remotePolicy: role.remote ? 'REMOTE' : 'UNKNOWN',
        regionEligibility: region.eligibility,
        regionConfidence: region.confidence,
        regionNotes: JSON.stringify(region.notes),
        roleType: role.roleType,
        domain: role.domain,
        techTags: JSON.stringify(techTags),
        matchedScore: score,
        publishedAt: raw.publishedAt ?? null,
        lastSeenAt: new Date(),
      };

      if (existing) {
        await db.job.update({ where: { id: existing.id }, data });
        updatedJobs += 1;
      } else {
        await db.job.create({
          data: {
            ...data,
            source: result.source,
            sourceId: raw.sourceId,
            externalId: raw.externalId ?? null,
            status: 'ACTIVE',
            isApproved: false,
          },
        });
        newJobs += 1;
      }
    }

    perSource.push({ source: result.source, fetched: result.jobs.length, accepted, error: result.error });
  }

  const finishedAt = new Date();
  const report: SearchReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    fetched,
    newJobs,
    updatedJobs,
    rejected,
    perSource,
  };

  await db.syncRun.update({
    where: { id: run.id },
    data: {
      status: 'SUCCESS',
      found: fetched,
      created: newJobs,
      endedAt: finishedAt,
      detail: JSON.stringify({ rejected, updatedJobs, perSource }),
    },
  });

  return report;
}
