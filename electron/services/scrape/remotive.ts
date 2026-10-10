import { fetchJson, stripHtml } from './http';
import type { RawJob, SourceResult } from './types';

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
  how_to_apply?: string;
  company_name?: string;
}

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

export async function searchRemotive(keywords: string[], limit = 50): Promise<SourceResult> {
  const source = 'remotive';
  try {
    const query = keywords.slice(0, 3).join(' ').trim() || 'software engineer';
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=${Math.min(50, limit)}`;
    const data = await fetchJson<RemotiveResponse>(url);
    const jobs: RawJob[] = (data.jobs ?? []).map((job) => {
      const descriptionHtml = job.description ?? '';
      const emailMatch = (job.how_to_apply ?? '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return {
        source,
        sourceId: String(job.id),
        externalId: String(job.id),
        company: (job.company_name ?? '').trim() || 'Unknown company',
        title: (job.title ?? '').trim(),
        url: job.url,
        descriptionHtml,
        description: stripHtml(descriptionHtml),
        salary: job.salary?.trim() || null,
        location: job.candidate_required_location || 'Remote',
        tags: [...(job.tags ?? []), job.category].filter(Boolean) as string[],
        publishedAt: job.publication_date ? new Date(job.publication_date) : null,
        applyEmail: emailMatch ? emailMatch[0].toLowerCase() : undefined,
        atsType: emailMatch ? 'EMAIL' : null,
      } satisfies RawJob;
    });
    return { source, jobs };
  } catch (error) {
    return { source, jobs: [], error: error instanceof Error ? error.message : String(error) };
  }
}
