import { fetchJson, stripHtml } from './http';
import type { RawJob, SourceResult } from './types';

interface JoobleJob {
  title?: string;
  link?: string;
  snippet?: string;
  salary?: string;
  type?: string;
  published?: string;
  location?: string;
  companyid?: string | number;
  companyName?: string;
  id?: string | number;
}

interface JoobleResponse {
  totalCount?: number;
  jobs?: JoobleJob[] | null;
}

/**
 * Jooble free developer API — https://jooble.org/api
 * The token is per-domain/per-project and must be supplied through JOOBLE_API_KEY.
 */
export async function searchJooble(keywords: string[], apiKey: string, limit = 50): Promise<SourceResult> {
  const source = 'jooble';
  if (!apiKey) {
    return { source, jobs: [], error: 'JOOBLE_API_KEY not configured (get a free key at https://jooble.org/api)' };
  }
  try {
    const response = await fetchJson<JoobleResponse>(`https://jooble.org/api/${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords: keywords.join(' ') || 'software engineer intern',
        location: 'remote',
      }),
      timeoutMs: 30000,
    });
    const list = Array.isArray(response.jobs) ? response.jobs : [];
    const jobs: RawJob[] = list.slice(0, limit).map((job, index) => {
      const description = stripHtml(job.snippet ?? '');
      const emailMatch = description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return {
        source,
        sourceId: String(job.id ?? job.link ?? `${index}-${job.title}`),
        company: (job.companyName ?? '').trim() || job.companyid?.toString() || 'Unknown company',
        title: (job.title ?? '').trim(),
        url: job.link ?? '',
        description,
        descriptionHtml: job.snippet ?? '',
        salary: job.salary?.trim() || null,
        location: job.location || 'Remote',
        tags: job.type ? [job.type] : [],
        publishedAt: job.published ? new Date(job.published) : null,
        applyEmail: emailMatch ? emailMatch[0].toLowerCase() : undefined,
        atsType: emailMatch ? 'EMAIL' : null,
      } satisfies RawJob;
    });
    return { source, jobs: jobs.filter((job) => Boolean(job.url) && Boolean(job.title)) };
  } catch (error) {
    return { source, jobs: [], error: error instanceof Error ? error.message : String(error) };
  }
}
