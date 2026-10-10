import type {
  ApplicationDto,
  ApplyResult,
  CandidateProfileDto,
  DashboardStats,
  DocumentDto,
  JobDto,
  OutlookAccountDto,
  SearchReport,
  SearchRequest,
  SettingsDto,
} from './types';

export interface SyncRunDto {
  id: string;
  kind: string;
  status: string;
  detail: string;
  found: number;
  created: number;
  startedAt: string;
  endedAt: string | null;
}

/** Contract implemented by electron/preload.ts and consumed by the renderer. */
export interface InternPulseApi {
  versions(): Promise<{ ok: true; data: { node: string; electron: string; chrome: string; appVersion: string } }>;
  openExternal(url: string): Promise<{ ok: true; data: boolean }>;

  getSettings(): Promise<{ ok: true; data: SettingsDto }>;
  setSettings(patch: Record<string, string>): Promise<{ ok: true; data: boolean }>;

  getProfile(): Promise<{ ok: true; data: CandidateProfileDto | null }>;
  ensureProfile(): Promise<{ ok: true; data: CandidateProfileDto }>;
  updateProfile(patch: Partial<CandidateProfileDto>): Promise<{ ok: true; data: CandidateProfileDto }>;

  uploadDocument(payload: {
    kind: 'RESUME' | 'COVER_LETTER';
    filename: string;
    dataBase64: string;
  }): Promise<{ ok: true; data: { documentId: string; extracted: unknown } }>;
  listDocuments(): Promise<{ ok: true; data: DocumentDto[] }>;
  reparseDocument(id: string): Promise<{ ok: true; data: { id: string; length: number } }>;
  deleteDocument(id: string): Promise<{ ok: true; data: boolean }>;

  listJobs(filter?: Record<string, unknown>): Promise<{ ok: true; data: JobDto[] }>;
  searchJobs(request: Partial<SearchRequest>): Promise<{ ok: true; data: SearchReport }>;
  updateJob(id: string, patch: Partial<JobDto>): Promise<{ ok: true; data: boolean }>;
  approveJobs(jobIds: string[]): Promise<{ ok: true; data: boolean }>;

  runApplications(payload: {
    jobIds: string[];
    headless?: boolean;
    delayMs?: number;
  }): Promise<{ ok: true; data: ApplyResult[] }>;
  listApplications(): Promise<{ ok: true; data: ApplicationDto[] }>;
  updateApplicationStatus(id: string, status: string, detail?: string): Promise<{ ok: true; data: boolean }>;

  outlookAccount(): Promise<{ ok: true; data: OutlookAccountDto }>;
  outlookSignIn(): Promise<{ ok: true; data: OutlookAccountDto }>;
  outlookSignOut(): Promise<{ ok: true; data: boolean }>;
  outlookSync(): Promise<{
    ok: true;
    data: { scanned: number; matched: number; tagged: number; errors: string[] };
  }>;
  onOutlookDeviceCode(listener: (message: string) => void): () => void;
  onApplicationsProgress(listener: (results: ApplyResult[]) => void): () => void;

  testGemini(): Promise<{ ok: true; data: { ok: boolean; detail: string } }>;
  getStats(): Promise<{ ok: true; data: DashboardStats }>;
  getSyncRuns(): Promise<{ ok: true; data: SyncRunDto[] }>;
}
