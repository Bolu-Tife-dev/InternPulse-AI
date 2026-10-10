export interface RawJob {
  source: string;
  sourceId: string;
  externalId?: string;
  company: string;
  title: string;
  url: string;
  applyUrl?: string | null;
  applyEmail?: string | null;
  atsType?: string | null;
  descriptionHtml?: string;
  description?: string;
  salary?: string | null;
  location?: string;
  tags?: string[];
  publishedAt?: Date | null;
}

export interface SourceResult {
  source: string;
  jobs: RawJob[];
  error?: string;
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
