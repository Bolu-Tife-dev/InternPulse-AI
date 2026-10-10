import { detectAtsType, extractEmails, fetchJson, stripHtml } from './http';
import type { RawJob, SourceResult } from './types';

interface GreenhouseJob {
  id: number | string;
  absolute_url: string;
  title: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  content?: string;
  departments?: Array<{ name?: string }>;
}

interface LeverJob {
  id: string;
  hostedUrl: string;
  applyUrl?: string;
  text: string;
  categories?: { location?: string; team?: string; commitment?: string };
  descriptionPlain?: string;
  description?: string;
  createdAt?: number;
  salaryRange?: { min?: number; max?: number; currency?: string };
}

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  department?: string;
  team?: string;
}

interface WorkdayJob {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

function decodeBase64Html(value: string): string {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}

const INTERN_TITLE =
  /\b(intern(ship)?|apprentice|graduate|new grad|university|campus|entry[\s-]?level|junior|co-?op)\b/i;

/**
 * Two-phase Greenhouse crawl: the lightweight board listing is filtered by title first,
 * then only the matching postings are re-fetched with their full HTML content.
 */
export async function searchGreenhouse(board: string, limit = 100): Promise<SourceResult> {
  const source = `greenhouse:${board}`;
  try {
    const listUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=false`;
    const data = await fetchJson<{ jobs?: GreenhouseJob[] }>(listUrl, { timeoutMs: 30000 });
    const candidates = (data.jobs ?? []).filter((job) => INTERN_TITLE.test(job.title ?? ''));
    const selected = candidates.slice(0, Math.min(limit, 30));

    const jobs: RawJob[] = [];
    for (const candidate of selected) {
      try {
        const detail = await fetchJson<GreenhouseJob & { content?: string }>(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${candidate.id}`,
          { timeoutMs: 20000 },
        );
        const html = decodeBase64Html(detail.content ?? '');
        jobs.push({
          source,
          sourceId: `${board}-${detail.id}`,
          externalId: String(detail.id),
          company: board,
          title: (detail.title ?? candidate.title ?? '').trim(),
          url: detail.absolute_url ?? candidate.absolute_url,
          descriptionHtml: html,
          description: stripHtml(html),
          location: detail.location?.name ?? candidate.location?.name ?? 'Remote',
          tags: (detail.departments ?? candidate.departments ?? []).map((department) => department.name ?? '').filter(Boolean),
          publishedAt: detail.first_published
            ? new Date(detail.first_published)
            : detail.updated_at
              ? new Date(detail.updated_at)
              : null,
          atsType: 'GREENHOUSE',
        } satisfies RawJob);
      } catch {
        /* skip individual failures */
      }
    }
    return { source, jobs: jobs.filter((job) => Boolean(job.title)) };
  } catch (error) {
    return { source, jobs: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function searchLever(company: string, limit = 100): Promise<SourceResult> {
  const source = `lever:${company}`;
  try {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
    const data = await fetchJson<LeverJob[]>(url, { timeoutMs: 30000 });
    const jobs: RawJob[] = (Array.isArray(data) ? data : []).slice(0, limit).map((job) => {
      const salary =
        job.salaryRange?.min && job.salaryRange?.max
          ? `${job.salaryRange.currency ?? 'USD'} ${job.salaryRange.min} - ${job.salaryRange.max}`
          : null;
      return {
        source,
        sourceId: job.id,
        company,
        title: job.text?.trim() ?? '',
        url: job.hostedUrl,
        applyUrl: job.applyUrl ?? job.hostedUrl,
        descriptionHtml: job.description ?? '',
        description: job.descriptionPlain ?? stripHtml(job.description ?? ''),
        salary,
        location: job.categories?.location ?? 'Remote',
        tags: [job.categories?.team, job.categories?.commitment].filter(Boolean) as string[],
        publishedAt: job.createdAt ? new Date(job.createdAt) : null,
        atsType: 'LEVER',
      } satisfies RawJob;
    });
    return { source, jobs: jobs.filter((job) => Boolean(job.title)) };
  } catch (error) {
    return { source, jobs: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function searchAshby(board: string, limit = 100): Promise<SourceResult> {
  const source = `ashby:${board}`;
  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
    const data = await fetchJson<{ jobs?: AshbyJob[] }>(url, { timeoutMs: 30000 });
    const jobs: RawJob[] = (data.jobs ?? []).slice(0, limit).map((job) => ({
      source,
      sourceId: job.id,
      company: board,
      title: job.title?.trim() ?? '',
      url: job.jobUrl ?? `https://jobs.ashbyhq.com/${board}/${job.id}`,
      applyUrl: job.applyUrl ?? job.jobUrl,
      descriptionHtml: job.descriptionHtml ?? '',
      description: job.descriptionPlain ?? stripHtml(job.descriptionHtml ?? ''),
      location: job.isRemote ? (job.location ? `Remote (${job.location})` : 'Remote') : (job.location ?? 'Unknown'),
      tags: [job.department, job.team].filter(Boolean) as string[],
      publishedAt: job.publishedAt ? new Date(job.publishedAt) : null,
      atsType: 'ASHBY',
    }));
    return { source, jobs: jobs.filter((job) => Boolean(job.title)) };
  } catch (error) {
    return { source, jobs: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Workday tenants are configured as `TENANT:SITE` (e.g. `company:External` / `company:R1234`). */
export async function searchWorkday(tenantSpec: string, keyword = 'intern', limit = 50): Promise<SourceResult> {
  const source = `workday:${tenantSpec}`;
  const [tenant, site] = tenantSpec.split(':');
  if (!tenant || !site) {
    return { source, jobs: [], error: `Invalid Workday tenant "${tenantSpec}" — expected TENANT:SITE` };
  }
  try {
    const url = `https://${tenant}.wd5.myworkdayjobs.com/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
    const data = await fetchJson<{ jobPostings?: WorkdayJob[] }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: Math.min(100, limit), offset: 0, searchText: keyword }),
      timeoutMs: 30000,
    });
    const jobs: RawJob[] = (data.jobPostings ?? []).slice(0, limit).map((job, index) => ({
      source,
      sourceId: `${tenant}-${index}-${job.title ?? index}`,
      company: tenant,
      title: job.title?.trim() ?? '',
      url: job.externalPath ? `https://${tenant}.wd5.myworkdayjobs.com${job.externalPath}` : '',
      description: (job.bulletFields ?? []).join(' · '),
      descriptionHtml: (job.bulletFields ?? []).map((field) => `<li>${field}</li>`).join(''),
      location: job.locationsText ?? 'Remote',
      tags: job.bulletFields ?? [],
      publishedAt: job.postedOn ? new Date(job.postedOn) : null,
      atsType: 'WORKDAY',
    }));
    return { source, jobs: jobs.filter((job) => Boolean(job.url) && Boolean(job.title)) };
  } catch (error) {
    return { source, jobs: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export { detectAtsType, extractEmails };
