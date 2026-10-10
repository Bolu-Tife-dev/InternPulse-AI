export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const REGION_LABEL: Record<string, string> = {
  WORLDWIDE: 'Worldwide OK',
  AFRICA_EMEA: 'Africa / EMEA',
  NIGERIA_EXPLICIT: 'Nigeria listed',
  RESTRICTED: 'Restricted region',
  UNKNOWN: 'Unverified',
};

export const REGION_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'muted'> = {
  WORLDWIDE: 'ok',
  AFRICA_EMEA: 'ok',
  NIGERIA_EXPLICIT: 'ok',
  RESTRICTED: 'bad',
  UNKNOWN: 'warn',
};

export const ROLE_LABEL: Record<string, string> = {
  INTERNSHIP: 'Internship',
  GRADUATE: 'Graduate',
  JUNIOR: 'Junior',
  UNKNOWN: 'Unverified',
};

export const DOMAIN_LABEL: Record<string, string> = {
  FRONTEND: 'Frontend',
  FULLSTACK: 'Full-stack',
  BACKEND: 'Backend',
  WEB: 'Web',
  SOFTWARE: 'Software',
  UNKNOWN: 'General',
};

export const STATUS_LABEL: Record<string, string> = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  FAILED: 'Failed',
};

export const CLASSIFICATION_LABEL: Record<string, string> = {
  ACK: 'Application acknowledged',
  ASSESSMENT: 'Assessment sent',
  INTERVIEW: 'Interview requested',
  REJECTION: 'Rejection notice',
  OFFER: 'Offer',
  UNCLASSIFIED: 'Unclassified',
};
