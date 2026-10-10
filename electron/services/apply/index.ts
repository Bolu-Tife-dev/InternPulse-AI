import { getDb, getSetting } from '../../db';
import type { ApplyResult, CandidateProfileDto, JobDto } from '../../../shared/types';
import { generateCoverLetter } from '../gemini';
import { readLatestDocumentText } from '../documentStore';
import { logLine } from '../../env';
import { runFormApplication } from './formAgent';
import { sendApplicationEmail } from './emailAgent';

const FORM_ATS = new Set(['GREENHOUSE', 'LEVER', 'ASHBY', 'BAMBOOHR', 'WORKDAY']);

function toDto(job: {
  id: string;
  company: string;
  title: string;
  url: string;
  applyUrl: string | null;
  applyEmail: string | null;
  atsType: string | null;
  description: string;
  techTags: string;
  regionEligibility: string;
  location: string | null;
}): JobDto & { applyEmail: string | null } {
  return {
    ...job,
    source: '',
    sourceId: '',
    atsType: (job.atsType ?? 'UNKNOWN') as JobDto['atsType'],
    regionEligibility: job.regionEligibility as JobDto['regionEligibility'],
    roleType: 'INTERNSHIP' as JobDto['roleType'],
    domain: 'UNKNOWN' as JobDto['domain'],
    salary: null,
    remotePolicy: 'REMOTE',
    regionConfidence: 0,
    regionNotes: [],
    techTags: JSON.parse(job.techTags || '[]') as string[],
    matchedScore: 0,
    status: 'ACTIVE',
    isApproved: true,
    approvalNote: null,
    publishedAt: null,
    fetchedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    applicationCount: 0,
  };
}

async function primaryProfile(): Promise<CandidateProfileDto> {
  const db = await getDb();
  const profile = await db.candidateProfile.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!profile) throw new Error('No candidate profile found. Upload your CV in the Profile tab first.');
  const resumeText = await readLatestDocumentText(profile.id, 'RESUME');
  void resumeText;
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

async function buildCoverLetter(profile: CandidateProfileDto, job: JobDto): Promise<string> {
  const baseLetter = await readLatestDocumentText(profile.id, 'COVER_LETTER');
  try {
    const tailored = await generateCoverLetter({
      candidate: {
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        headline: profile.headline,
        summary: profile.summary,
        skills: profile.skills,
        projects: profile.projects,
        isNigerianCitizen: profile.isNigerianCitizen,
        yearsOfExperience: profile.yearsOfExperience,
      },
      job: {
        company: job.company,
        title: job.title,
        description: job.description,
        techTags: job.techTags,
        location: job.location,
        regionEligibility: job.regionEligibility,
      },
    });
    return tailored;
  } catch (error) {
    logLine(`[apply] Gemini cover letter failed, using stored letter: ${String(error)}`);
    return (
      baseLetter ??
      `Dear ${job.company} hiring team,\n\nI am writing to apply for the ${job.title} position. ` +
        `${profile.summary ?? ''}\n\nMy core skills: ${profile.skills.slice(0, 12).join(', ')}.\n\n` +
        `Best regards,\n${profile.fullName ?? 'Applicant'}\n${profile.email ?? ''}`
    );
  }
}

export async function runApplications(jobIds: string[], options: { headless?: boolean; delayMs?: number } = {}): Promise<ApplyResult[]> {
  const db = await getDb();
  const profile = await primaryProfile();
  const headless = options.headless ?? (await getSetting('AUTOMATION_HEADLESS')) === 'true';
  const delay = options.delayMs ?? Number((await getSetting('APPLY_DELAY_MS')) || '8000');

  const results: ApplyResult[] = [];
  for (const jobId of jobIds) {
    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job) {
      results.push({
        jobId,
        company: 'unknown',
        title: 'unknown',
        strategy: 'FORM',
        ok: false,
        status: 'FAILED',
        detail: 'Job not found',
      });
      continue;
    }

    const dto = toDto({
      id: job.id,
      company: job.company,
      title: job.title,
      url: job.url,
      applyUrl: job.applyUrl,
      applyEmail: job.applyEmail,
      atsType: job.atsType,
      description: job.description,
      techTags: job.techTags,
      regionEligibility: job.regionEligibility,
      location: job.location,
    });

    const coverLetter = await buildCoverLetter(profile, dto);
    const strategy: 'FORM' | 'EMAIL' =
      FORM_ATS.has(job.atsType ?? '') && job.applyUrl ? 'FORM' : job.applyEmail ? 'EMAIL' : 'FORM';

    const application = await db.application.create({
      data: {
        jobId: job.id,
        strategy,
        status: 'APPLIED',
        coverLetter,
        submittedAt: new Date(),
      },
    });

    let outcome: { ok: boolean; status: ApplyResult['status']; detail: string; confirmationRef?: string };
    let screenshotPath: string | null = null;
    let answersJson: Record<string, string> = {};

    if (strategy === 'EMAIL') {
      const resumePath = await (
        await import('../documentStore')
      ).latestDocumentPath(profile.id, 'RESUME');
      const emailOutcome = await sendApplicationEmail({
        profile,
        to: job.applyEmail as string,
        company: job.company,
        title: job.title,
        coverLetter,
        resumePath,
      });
      outcome = {
        ok: emailOutcome.ok,
        status: emailOutcome.ok ? 'APPLIED' : 'FAILED',
        detail: emailOutcome.detail,
        confirmationRef: emailOutcome.messageId ?? undefined,
      };
    } else {
      const formOutcome = await runFormApplication(
        {
          id: job.id,
          company: job.company,
          title: job.title,
          url: job.url,
          applyUrl: job.applyUrl,
          atsType: job.atsType,
          description: job.description,
          techTags: JSON.parse(job.techTags || '[]') as string[],
          regionEligibility: job.regionEligibility,
          location: job.location,
        },
        profile,
        { headless },
      );
      screenshotPath = formOutcome.screenshotPath;
      answersJson = formOutcome.answers;
      outcome = {
        ok: formOutcome.ok,
        status: formOutcome.ok ? 'APPLIED' : 'FAILED',
        detail: formOutcome.detail,
        confirmationRef: formOutcome.confirmationRef ?? undefined,
      };
    }

    await db.application.update({
      where: { id: application.id },
      data: {
        status: outcome.status,
        statusDetail: outcome.detail,
        confirmationRef: outcome.confirmationRef ?? null,
        screenshotPath,
        answersJson: JSON.stringify(answersJson),
        updatedAt: new Date(),
      },
    });

    await db.job.update({
      where: { id: job.id },
      data: { isApproved: true, approvalNote: outcome.detail, status: 'ACTIVE' },
    });

    results.push({
      jobId: job.id,
      company: job.company,
      title: job.title,
      strategy,
      ok: outcome.ok,
      status: outcome.status,
      detail: outcome.detail,
      confirmationRef: outcome.confirmationRef,
    });

    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return results;
}
