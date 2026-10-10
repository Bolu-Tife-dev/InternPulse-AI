import { fetchJson, stripHtml } from './http';
import type { RawJob, SourceResult } from './types';

interface JobicyJob {
  id: number | string;
  url: string;
  jobTitle: string;
  companyName: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  jobGeo?: string;
  jobSalary?: string;
  jobLevel?: string;
  jobType?: string;
  jobTags?: string[] | string;
  annualSalaryMin?: number;
  annualSalaryMax?: number;
  salaryCurrency?: string;
}

interface JobicyResponse {
  jobs?: JobicyJob[];
}

function tagsOf(job: JobicyJob): string[] {
  if (Array.isArray(job.jobTags)) return job.jobTags.map((tag) => String(tag));
  if (typeof job.jobTags === 'string' && job.jobTags) return job.jobTags.split(',').map((tag) => tag.trim());
  const industry: unknown = (job as unknown as { jobIndustry?: unknown }).jobIndustry;
  if (Array.isArray(industry)) return industry.map((tag) => String(tag));
  return [];
}

export async function searchJobicy(keywords: string[], limit = 50): Promise<SourceResult> {
  const source = 'jobicy';
  try {
    // Jobicy's free tier returns worldwide remote roles when no geo filter is supplied;
    // geo values are region-specific (e.g. "africa", "canada") and reject unknown values.
    const params = new URLSearchParams({ count: String(Math.min(50, limit)) });
    const url = `https://jobicy.com/api/v2/remote-jobs?${params.toString()}`;
    const data = await fetchJson<JobicyResponse>(url);
    const jobs: RawJob[] = (data.jobs ?? []).map((job) => {
      const descriptionHtml = job.jobDescription ?? '';
      const tags = tagsOf(job);
      const joined = `${job.jobTitle ?? ''} ${tags.join(' ')}`.toLowerCase();
      // keep the API cheap: pre-filter obviously irrelevant roles before the matcher runs
      void joined;
      let salary = job.jobSalary?.trim() || null;
      if (!salary && job.annualSalaryMin && job.annualSalaryMax) {
        salary = `${job.salaryCurrency ?? 'USD'} ${job.annualSalaryMin} - ${job.annualSalaryMax}`;
      }
      return {
        source,
        sourceId: String(job.id),
        externalId: String(job.id),
        company: (job.companyName ?? '').trim() || 'Unknown company',
        title: (job.jobTitle ?? '').trim(),
        url: job.url,
        descriptionHtml,
        description: stripHtml(descriptionHtml) || (job.jobExcerpt ?? ''),
        salary,
        location: job.jobGeo ?? 'Remote',
        tags,
        publishedAt: job.pubDate ? new Date(job.pubDate) : null,
        atsType: null,
      } satisfies RawJob;
    });
    return { source, jobs };
  } catch (error) {
    return { source, jobs: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function jobicyMatchesKeywords(raw: RawJob, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const haystack = `${raw.title} ${raw.tags?.join(' ') ?? ''}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}
