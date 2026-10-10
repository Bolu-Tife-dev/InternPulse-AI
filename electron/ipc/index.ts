import { ipcMain, shell } from 'electron';
import { getDb, getSetting, getSettings, setSetting } from '../db';
import type {
  ApplicationDto,
  CandidateProfileDto,
  DashboardStats,
  DocumentDto,
  EmailMessageDto,
  JobDto,
  SearchRequest,
  SettingsDto,
} from '../../shared/types';
import { saveAndParseDocument, parseDocumentBuffer } from '../services/documentStore';
import { runJobSearch } from '../services/scrape';
import { runApplications } from '../services/apply';
import { closeScraperBrowser } from '../services/scrape/atsPlaywright';
import { closeApplyBrowser } from '../services/apply/formAgent';
import {
  getAccount,
  onDeviceCodeMessage,
  signInWithDeviceCode,
  signOut,
  syncOutlookInbox,
  getGraphToken,
} from '../services/outlook';
import { registerGraphTokenProvider } from '../services/apply/emailAgent';
import { testGeminiConnection } from '../services/gemini';
import { normalizeSkillList } from '../services/skillLexicon';

const SETTINGS_KEYS: Array<keyof SettingsDto> = [
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'JOOBLE_API_KEY',
  'GREENHOUSE_BOARDS',
  'LEVER_COMPANIES',
  'ASHBY_BOARDS',
  'WORKDAY_TENANTS',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'MS_CLIENT_ID',
  'MS_TENANT_ID',
  'MS_SCOPES',
  'AUTOMATION_HEADLESS',
  'APPLY_DELAY_MS',
  'OUTLOOK_SYNC_INTERVAL_MS',
];

function ok<T>(data: T) {
  return { ok: true as const, data };
}
function fail(error: unknown) {
  return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
}

function serializeProfile(profile: {
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
  skillsJson: string;
  projectsJson: string;
  languagesJson: string;
  updatedAt: Date;
}): CandidateProfileDto {
  return {
    id: profile.id,
    fullName: profile.fullName,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    linkedinUrl: profile.linkedinUrl,
    githubUrl: profile.githubUrl,
    portfolioUrl: profile.portfolioUrl,
    location: profile.location,
    timezone: profile.timezone,
    isNigerianCitizen: profile.isNigerianCitizen,
    workAuthorization: profile.workAuthorization,
    yearsOfExperience: profile.yearsOfExperience,
    headline: profile.headline,
    summary: profile.summary,
    skills: JSON.parse(profile.skillsJson || '[]') as string[],
    projects: JSON.parse(profile.projectsJson || '[]') as Array<{ name: string; detail: string }>,
    languages: JSON.parse(profile.languagesJson || '[]') as string[],
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function serializeJob(job: {
  id: string;
  source: string;
  sourceId: string;
  company: string;
  title: string;
  url: string;
  applyUrl: string | null;
  applyEmail: string | null;
  atsType: string | null;
  description: string;
  salary: string | null;
  location: string | null;
  remotePolicy: string;
  regionEligibility: string;
  regionConfidence: number;
  regionNotes: string;
  roleType: string;
  domain: string;
  techTags: string;
  matchedScore: number;
  status: string;
  isApproved: boolean;
  approvalNote?: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
  lastSeenAt: Date;
  _count?: { applications: number };
}): JobDto {
  return {
    id: job.id,
    source: job.source,
    sourceId: job.sourceId,
    company: job.company,
    title: job.title,
    url: job.url,
    applyUrl: job.applyUrl,
    applyEmail: job.applyEmail,
    atsType: (job.atsType ?? 'UNKNOWN') as JobDto['atsType'],
    description: job.description,
    salary: job.salary,
    location: job.location,
    remotePolicy: job.remotePolicy,
    regionEligibility: job.regionEligibility as JobDto['regionEligibility'],
    regionConfidence: job.regionConfidence,
    regionNotes: JSON.parse(job.regionNotes || '[]') as string[],
    roleType: job.roleType as JobDto['roleType'],
    domain: job.domain as JobDto['domain'],
    techTags: JSON.parse(job.techTags || '[]') as string[],
    matchedScore: job.matchedScore,
    status: job.status as JobDto['status'],
    isApproved: job.isApproved,
    approvalNote: job.approvalNote ?? null,
    publishedAt: job.publishedAt ? job.publishedAt.toISOString() : null,
    fetchedAt: job.fetchedAt.toISOString(),
    lastSeenAt: job.lastSeenAt.toISOString(),
    applicationCount: job._count?.applications ?? 0,
  };
}

function serializeEmail(message: {
  id: string;
  graphId: string;
  subject: string;
  sender: string;
  bodyPreview: string;
  receivedAt: Date;
  classification: string;
  sentiment: string;
  confidence: number;
}): EmailMessageDto {
  return {
    id: message.id,
    graphId: message.graphId,
    subject: message.subject,
    sender: message.sender,
    bodyPreview: message.bodyPreview,
    receivedAt: message.receivedAt.toISOString(),
    classification: message.classification,
    sentiment: message.sentiment,
    confidence: message.confidence,
  };
}

export function registerIpcHandlers(getMainWindow: () => Electron.BrowserWindow | null): void {
  registerGraphTokenProvider(() => getGraphToken());

  ipcMain.handle('app:versions', async () => {
    const { app } = await import('electron');
    let appVersion = '0.0.0';
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const pkgPath = path.join(app.getAppPath(), 'package.json');
      if (fs.existsSync(pkgPath)) {
        appVersion = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }).version ?? appVersion;
      }
    } catch {
      /* fall back to default */
    }
    return ok({
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      appVersion,
    });
  });

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
    return ok(true);
  });

  // ---------- Settings ----------
  ipcMain.handle('settings:get', async () => {
    const values = await getSettings(SETTINGS_KEYS as string[]);
    return ok(values as unknown as SettingsDto);
  });

  ipcMain.handle('settings:set', async (_event, patch: Partial<Record<string, string>>) => {
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (typeof value === 'string') await setSetting(key, value);
    }
    return ok(true);
  });

  // ---------- Profile ----------
  ipcMain.handle('profile:get', async () => {
    const db = await getDb();
    const profile = await db.candidateProfile.findFirst({ orderBy: { updatedAt: 'desc' } });
    return ok(profile ? serializeProfile(profile) : null);
  });

  ipcMain.handle('profile:ensure', async () => {
    const db = await getDb();
    const existing = await db.candidateProfile.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (existing) return ok(serializeProfile(existing));
    const created = await db.candidateProfile.create({ data: {} });
    return ok(serializeProfile(created));
  });

  ipcMain.handle('profile:update', async (_event, patch: Partial<CandidateProfileDto>) => {
    const db = await getDb();
    let profile = await db.candidateProfile.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!profile) profile = await db.candidateProfile.create({ data: {} });
    const data: Record<string, unknown> = {};
    const scalarKeys = [
      'fullName',
      'firstName',
      'lastName',
      'email',
      'phone',
      'linkedinUrl',
      'githubUrl',
      'portfolioUrl',
      'location',
      'timezone',
      'workAuthorization',
      'headline',
      'summary',
    ] as const;
    for (const key of scalarKeys) {
      if (patch[key] !== undefined) data[key] = patch[key];
    }
    if (patch.isNigerianCitizen !== undefined) data.isNigerianCitizen = patch.isNigerianCitizen;
    if (patch.yearsOfExperience !== undefined) data.yearsOfExperience = Number(patch.yearsOfExperience) || 0;
    if (patch.skills) data.skillsJson = JSON.stringify(normalizeSkillList(patch.skills));
    if (patch.projects) data.projectsJson = JSON.stringify(patch.projects);
    if (patch.languages) data.languagesJson = JSON.stringify(patch.languages);
    const updated = await db.candidateProfile.update({ where: { id: profile.id }, data });
    return ok(serializeProfile(updated));
  });

  // ---------- Documents ----------
  ipcMain.handle(
    'documents:upload',
    async (_event, payload: { kind: 'RESUME' | 'COVER_LETTER'; filename: string; dataBase64: string }) => {
      const db = await getDb();
      let profile = await db.candidateProfile.findFirst({ orderBy: { updatedAt: 'desc' } });
      if (!profile) profile = await db.candidateProfile.create({ data: {} });
      const buffer = Buffer.from(payload.dataBase64, 'base64');
      const result = await saveAndParseDocument(profile.id, payload.kind, payload.filename, buffer);

      if (result.extracted) {
        const merged: Record<string, unknown> = {};
        const current = await db.candidateProfile.findUnique({ where: { id: profile.id } });
        if (!current) throw new Error('Profile missing after creation');
        const extracted = result.extracted;
        if (extracted.fullName && !current.fullName) merged.fullName = extracted.fullName;
        if (extracted.firstName && !current.firstName) merged.firstName = extracted.firstName;
        if (extracted.lastName && !current.lastName) merged.lastName = extracted.lastName;
        if (extracted.email && !current.email) merged.email = extracted.email;
        if (extracted.phone && !current.phone) merged.phone = extracted.phone;
        if (extracted.linkedinUrl && !current.linkedinUrl) merged.linkedinUrl = extracted.linkedinUrl;
        if (extracted.githubUrl && !current.githubUrl) merged.githubUrl = extracted.githubUrl;
        if (extracted.portfolioUrl && !current.portfolioUrl) merged.portfolioUrl = extracted.portfolioUrl;
        if (extracted.location && !current.location) merged.location = extracted.location;
        if (extracted.headline && !current.headline) merged.headline = extracted.headline;
        if (extracted.summary && !current.summary) merged.summary = extracted.summary;
        if (extracted.yearsOfExperience && !current.yearsOfExperience) merged.yearsOfExperience = extracted.yearsOfExperience;
        const skills = normalizeSkillList([
          ...(JSON.parse(current.skillsJson || '[]') as string[]),
          ...extracted.skills,
        ]);
        merged.skillsJson = JSON.stringify(skills);
        const existingProjects = JSON.parse(current.projectsJson || '[]') as Array<{ name: string; detail: string }>;
        const projectMap = new Map(existingProjects.map((project) => [project.name.toLowerCase(), project]));
        for (const project of extracted.projects) {
          if (!projectMap.has(project.name.toLowerCase())) projectMap.set(project.name.toLowerCase(), project);
        }
        merged.projectsJson = JSON.stringify(Array.from(projectMap.values()).slice(0, 20));
        await db.candidateProfile.update({ where: { id: profile.id }, data: merged });
      }
      return ok({ documentId: result.documentId, extracted: result.extracted });
    },
  );

  ipcMain.handle('documents:list', async () => {
    const db = await getDb();
    const docs = await db.document.findMany({ orderBy: { createdAt: 'desc' } });
    const list: DocumentDto[] = docs.map((doc) => ({
      id: doc.id,
      profileId: doc.profileId,
      kind: doc.kind as DocumentDto['kind'],
      filename: doc.filename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      parseStatus: doc.parseStatus as DocumentDto['parseStatus'],
      parseError: doc.parseError,
      hasText: Boolean(doc.extractedText),
      textPreview: doc.extractedText.slice(0, 400),
      createdAt: doc.createdAt.toISOString(),
    }));
    return ok(list);
  });

  ipcMain.handle('documents:reparse', async (_event, documentId: string) => {
    const db = await getDb();
    const doc = await db.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new Error('Document not found');
    const fs = await import('node:fs/promises');
    const buffer = await fs.readFile(doc.storagePath);
    try {
      const text = await parseDocumentBuffer(doc.filename, buffer);
      const updated = await db.document.update({
        where: { id: doc.id },
        data: { extractedText: text, parseStatus: 'PARSED', parseError: null },
      });
      return ok({ id: updated.id, length: text.length });
    } catch (error) {
      await db.document.update({
        where: { id: doc.id },
        data: { parseStatus: 'FAILED', parseError: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  });

  ipcMain.handle('documents:delete', async (_event, documentId: string) => {
    const db = await getDb();
    await db.document.delete({ where: { id: documentId } });
    return ok(true);
  });

  // ---------- Jobs ----------
  ipcMain.handle(
    'jobs:list',
    async (
      _event,
      filter: {
        status?: string;
        search?: string;
        domain?: string;
        region?: string;
        onlyApproved?: boolean;
        limit?: number;
      } = {},
    ) => {
      const db = await getDb();
      const where: Record<string, unknown> = { status: filter.status ?? 'ACTIVE' };
      const and: Array<Record<string, unknown>> = [];
      if (filter.search) {
        and.push({
          OR: [
            { company: { contains: filter.search } },
            { title: { contains: filter.search } },
            { description: { contains: filter.search } },
          ],
        });
      }
      if (filter.domain) and.push({ domain: filter.domain });
      if (filter.region) and.push({ regionEligibility: filter.region });
      if (filter.onlyApproved) and.push({ isApproved: true });
      if (and.length) where.AND = and;

      const jobs = await db.job.findMany({
        where,
        include: { _count: { select: { applications: true } } },
        orderBy: [{ matchedScore: 'desc' }, { fetchedAt: 'desc' }],
        take: filter.limit ?? 500,
      });
      return ok(jobs.map(serializeJob));
    },
  );

  ipcMain.handle('jobs:search', async (_event, request: SearchRequest) => {
    const report = await runJobSearch(request);
    return ok(report);
  });

  ipcMain.handle('jobs:update', async (_event, payload: { id: string; patch: Partial<JobDto> }) => {
    const db = await getDb();
    const data: Record<string, unknown> = {};
    if (payload.patch.status) data.status = payload.patch.status;
    if (payload.patch.isApproved !== undefined) data.isApproved = payload.patch.isApproved;
    if (payload.patch.approvalNote !== undefined) data.approvalNote = payload.patch.approvalNote;
    if (payload.patch.title) data.title = payload.patch.title;
    if (payload.patch.company) data.company = payload.patch.company;
    if (payload.patch.applyEmail !== undefined) data.applyEmail = payload.patch.applyEmail;
    if (payload.patch.applyUrl !== undefined) data.applyUrl = payload.patch.applyUrl;
    if (payload.patch.techTags) data.techTags = JSON.stringify(payload.patch.techTags);
    await db.job.update({ where: { id: payload.id }, data });
    return ok(true);
  });

  ipcMain.handle('jobs:approve', async (_event, jobIds: string[]) => {
    const db = await getDb();
    await db.job.updateMany({
      where: { id: { in: jobIds } },
      data: { isApproved: true },
    });
    return ok(true);
  });

  // ---------- Applications ----------
  ipcMain.handle('applications:run', async (_event, request: { jobIds: string[]; headless?: boolean; delayMs?: number }) => {
    const results = await runApplications(request.jobIds, request);
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send('applications:progress', results);
    return ok(results);
  });

  ipcMain.handle('applications:list', async () => {
    const db = await getDb();
    const applications = await db.application.findMany({
      include: {
        job: true,
        emails: { orderBy: { receivedAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const list: ApplicationDto[] = applications.map((application) => ({
      id: application.id,
      jobId: application.jobId,
      strategy: application.strategy as ApplicationDto['strategy'],
      status: application.status as ApplicationDto['status'],
      statusDetail: application.statusDetail,
      coverLetter: application.coverLetter,
      confirmationRef: application.confirmationRef,
      errorMessage: application.errorMessage,
      createdAt: application.createdAt.toISOString(),
      submittedAt: application.submittedAt ? application.submittedAt.toISOString() : null,
      job: {
        id: application.job.id,
        company: application.job.company,
        title: application.job.title,
        url: application.job.url,
        atsType: application.job.atsType as ApplicationDto['job']['atsType'],
      },
      emails: application.emails.map(serializeEmail),
    }));
    return ok(list);
  });

  ipcMain.handle(
    'applications:updateStatus',
    async (_event, payload: { id: string; status: string; detail?: string }) => {
      const db = await getDb();
      await db.application.update({
        where: { id: payload.id },
        data: { status: payload.status, statusDetail: payload.detail, updatedAt: new Date() },
      });
      return ok(true);
    },
  );

  // ---------- Outlook ----------
  ipcMain.handle('outlook:account', async () => ok(await getAccount()));

  ipcMain.handle('outlook:signIn', async () => {
    const window = getMainWindow();
    onDeviceCodeMessage((message) => {
      if (window && !window.isDestroyed()) window.webContents.send('outlook:deviceCode', message);
    });
    const account = await signInWithDeviceCode();
    return ok(account);
  });

  ipcMain.handle('outlook:signOut', async () => {
    await signOut();
    return ok(true);
  });

  ipcMain.handle('outlook:sync', async () => ok(await syncOutlookInbox()));

  // ---------- AI / stats ----------
  ipcMain.handle('ai:test', async () => ok(await testGeminiConnection()));

  ipcMain.handle('stats:get', async () => {
    const db = await getDb();
    const activeJobs = await db.job.count({ where: { status: 'ACTIVE' } });
    const approvedJobs = await db.job.count({ where: { status: 'ACTIVE', isApproved: true } });
    const applications = await db.application.count();
    const interviews = await db.application.count({ where: { status: 'INTERVIEW' } });
    const rejections = await db.application.count({ where: { status: 'REJECTED' } });
    const responses = await db.application.count({ where: { status: { in: ['SCREENING', 'INTERVIEW', 'OFFER'] } } });
    const lastSync = await db.syncRun.findFirst({ orderBy: { startedAt: 'desc' } });
    const profile = await db.candidateProfile.findFirst({ orderBy: { updatedAt: 'desc' } });
    const stats: DashboardStats = {
      activeJobs,
      approvedJobs,
      applications,
      interviews,
      rejections,
      responses,
      lastSyncAt: lastSync ? lastSync.startedAt.toISOString() : null,
      profileComplete: Boolean(profile?.email && profile?.fullName),
    };
    return ok(stats);
  });

  ipcMain.handle('sync:runs', async () => {
    const db = await getDb();
    const runs = await db.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 });
    return ok(
      runs.map((run) => ({
        id: run.id,
        kind: run.kind,
        status: run.status,
        detail: run.detail,
        found: run.found,
        created: run.created,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt ? run.endedAt.toISOString() : null,
      })),
    );
  });
}

export async function shutdownAutomation(): Promise<void> {
  await Promise.allSettled([closeScraperBrowser(), closeApplyBrowser()]);
}
