// Shared DTO contract between the Electron main process and the React renderer.

export type DocumentKind = 'RESUME' | 'COVER_LETTER';

export interface ParsedProject {
  name: string;
  detail: string;
}

export interface CandidateProfileDto {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  location: string | null;
  timezone: string | null;
  isNigerianCitizen: boolean;
  workAuthorization: string;
  yearsOfExperience: number;
  headline: string | null;
  summary: string | null;
  skills: string[];
  projects: ParsedProject[];
  languages: string[];
  updatedAt: string;
}

export interface DocumentDto {
  id: string;
  profileId: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  parseStatus: 'PENDING' | 'PARSED' | 'FAILED';
  parseError: string | null;
  hasText: boolean;
  textPreview: string;
  createdAt: string;
}

export type RegionEligibility =
  | 'WORLDWIDE'
  | 'AFRICA_EMEA'
  | 'NIGERIA_EXPLICIT'
  | 'RESTRICTED'
  | 'UNKNOWN';

export type RoleType = 'INTERNSHIP' | 'GRADUATE' | 'JUNIOR' | 'UNKNOWN';
export type JobDomain = 'FRONTEND' | 'FULLSTACK' | 'BACKEND' | 'SOFTWARE' | 'WEB' | 'UNKNOWN';
export type JobStatus = 'ACTIVE' | 'HIDDEN' | 'DELETED';
export type AtsType = 'GREENHOUSE' | 'LEVER' | 'ASHBY' | 'BAMBOOHR' | 'WORKDAY' | 'EMAIL' | 'UNKNOWN';

export interface JobDto {
  id: string;
  source: string;
  sourceId: string;
  company: string;
  title: string;
  url: string;
  applyUrl: string | null;
  applyEmail: string | null;
  atsType: AtsType;
  description: string;
  salary: string | null;
  location: string | null;
  remotePolicy: string;
  regionEligibility: RegionEligibility;
  regionConfidence: number;
  regionNotes: string[];
  roleType: RoleType;
  domain: JobDomain;
  techTags: string[];
  matchedScore: number;
  status: JobStatus;
  isApproved: boolean;
  approvalNote: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  lastSeenAt: string;
  applicationCount: number;
}

export type ApplicationStrategy = 'FORM' | 'EMAIL';
export type ApplicationStatus =
  | 'APPLIED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'FAILED';

export interface ApplicationDto {
  id: string;
  jobId: string;
  strategy: ApplicationStrategy;
  status: ApplicationStatus;
  statusDetail: string | null;
  coverLetter: string | null;
  confirmationRef: string | null;
  errorMessage: string | null;
  createdAt: string;
  submittedAt: string | null;
  job: {
    id: string;
    company: string;
    title: string;
    url: string;
    atsType: AtsType;
  };
  emails: EmailMessageDto[];
}

export interface EmailMessageDto {
  id: string;
  graphId: string;
  subject: string;
  sender: string;
  bodyPreview: string;
  receivedAt: string;
  classification: string;
  sentiment: string;
  confidence: number;
}

export interface SearchRequest {
  keywords: string[];
  countries?: string[];
  limitPerSource?: number;
  includeSources?: string[];
  usePlaywrightScrapers?: boolean;
  customUrls?: string[];
}

export interface SearchReport {
  startedAt: string;
  finishedAt: string;
  fetched: number;
  newJobs: number;
  updatedJobs: number;
  rejected: number;
  perSource: Array<{ source: string; fetched: number; accepted: number; error?: string }>;
}

export interface ApplyRequest {
  jobIds: string[];
  headless?: boolean;
  delayMs?: number;
}

export interface ApplyResult {
  jobId: string;
  company: string;
  title: string;
  strategy: ApplicationStrategy;
  ok: boolean;
  status: ApplicationStatus;
  detail: string;
  confirmationRef?: string;
}

export interface OutlookAccountDto {
  signedIn: boolean;
  userPrincipalName: string | null;
  displayName: string | null;
  expiresOn: string | null;
  scopes: string[];
  deviceCodeMessage?: string;
}

export interface SettingsDto {
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  JOOBLE_API_KEY: string;
  GREENHOUSE_BOARDS: string;
  LEVER_COMPANIES: string;
  ASHBY_BOARDS: string;
  WORKDAY_TENANTS: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  MS_CLIENT_ID: string;
  MS_TENANT_ID: string;
  MS_SCOPES: string;
  AUTOMATION_HEADLESS: string;
  APPLY_DELAY_MS: string;
  OUTLOOK_SYNC_INTERVAL_MS: string;
}

export interface DashboardStats {
  activeJobs: number;
  approvedJobs: number;
  applications: number;
  interviews: number;
  rejections: number;
  responses: number;
  lastSyncAt: string | null;
  profileComplete: boolean;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
