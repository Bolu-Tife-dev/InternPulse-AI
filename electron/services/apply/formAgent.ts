import fs from 'node:fs';
import path from 'node:path';
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import type { CandidateProfileDto } from '../../../shared/types';
import { answerCustomQuestion } from '../gemini';
import { latestDocumentPath } from '../documentStore';
import { screenshotsDir } from '../../paths';
import { logLine } from '../../env';

export interface JobLike {
  id: string;
  company: string;
  title: string;
  url: string;
  applyUrl: string | null;
  atsType: string | null;
  description: string;
  techTags: string[];
  regionEligibility: string;
  location: string | null;
}

export interface FormApplyOutcome {
  ok: boolean;
  confirmationRef: string | null;
  detail: string;
  screenshotPath: string | null;
  answers: Record<string, string>;
}

let browser: Browser | null = null;

async function getBrowser(headless: boolean): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  return browser;
}

export async function closeApplyBrowser(): Promise<void> {
  if (!browser) return;
  const current = browser;
  browser = null;
  await current.close().catch(() => undefined);
}

type Ats = 'GREENHOUSE' | 'LEVER' | 'ASHBY' | 'BAMBOOHR' | 'WORKDAY' | 'UNKNOWN';

export function detectAts(url: string): Ats {
  const lower = url.toLowerCase();
  if (/greenhouse\.io/.test(lower)) return 'GREENHOUSE';
  if (/lever\.co/.test(lower)) return 'LEVER';
  if (/ashbyhq\.com/.test(lower)) return 'ASHBY';
  if (/bamboohr\.com|bamboo\.hr/.test(lower)) return 'BAMBOOHR';
  if (/myworkdayjobs\.com/.test(lower)) return 'WORKDAY';
  return 'UNKNOWN';
}

interface FieldDescriptor {
  index: number;
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  aria: string;
  label: string;
  required: boolean;
  value: string;
  visible: boolean;
  isFile: boolean;
  isSelect: boolean;
  options: string[];
}

async function describeFields(page: Page): Promise<FieldDescriptor[]> {
  return page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select',
      ),
    );
    return controls.map((control, index) => {
      const id = control.id ?? '';
      let label = '';
      if (id) {
        const labelNode = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (labelNode) label = (labelNode as HTMLElement).innerText || '';
      }
      if (!label) {
        const parentLabel = control.closest('label');
        if (parentLabel) label = (parentLabel as HTMLElement).innerText || '';
      }
      if (!label) {
        const wrapper = control.closest('div, li, fieldset, section');
        if (wrapper) {
          const heading = wrapper.querySelector('label, legend, span, p, div > span, div > p');
          if (heading) label = (heading as HTMLElement).innerText || '';
        }
      }
      const select = control as HTMLSelectElement;
      const options =
        control.tagName === 'SELECT'
          ? Array.from(select.options).map((option) => (option.textContent ?? '').trim()).filter(Boolean)
          : [];
      const rect = control.getBoundingClientRect();
      return {
        index,
        tag: control.tagName.toLowerCase(),
        type: (control as HTMLInputElement).type ?? '',
        name: control.getAttribute('name') ?? '',
        id,
        placeholder: control.getAttribute('placeholder') ?? '',
        aria: control.getAttribute('aria-label') ?? '',
        label: label.replace(/\s+/g, ' ').trim().slice(0, 140),
        required: (control as HTMLInputElement).required || control.getAttribute('aria-required') === 'true',
        value: (control as HTMLInputElement).value ?? '',
        visible: rect.width > 0 && rect.height > 0,
        isFile: (control as HTMLInputElement).type === 'file',
        isSelect: control.tagName === 'SELECT',
        options,
      };
    });
  });
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  const haystack = text.toLowerCase();
  return patterns.some((pattern) => pattern.test(haystack));
}

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  firstName: [/^first\s*name$/, /\bfirst\s*name\b/, /^given\s*name$/, /^fname$/, /^name$/],
  lastName: [/^last\s*name$/, /\blast\s*name\b/, /^surname$/, /^family\s*name$/, /^lname$/],
  fullName: [/^full\s*name$/, /^your\s*name$/, /^name\s*\(.*\)$/, /^applicant\s*name$/],
  email: [/^e-?mail$/, /email\s*address/, /^email$/],
  phone: [/^phone/, /mobile/, /telephone/, /^tel$/],
  linkedin: [/linkedin/],
  github: [/github/],
  portfolio: [/portfolio/, /website/, /personal\s*site/, /homepage/, /url/],
  location: [/location/, /city/, /country/, /where\s*do\s*you\s*(live|reside)/, /based\s*in/],
  coverLetter: [/cover\s*letter/, /why\s*do\s*you\s*want/, /motivation/, /message\s*to\s*the\s*hiring/],
  resume: [/resume/, /cv/, /curriculum/],
  url: [/url/, /link/],
};

const ATS_FIELD_IDS: Record<Ats, Partial<Record<keyof typeof FIELD_PATTERNS, string[]>>> = {
  GREENHOUSE: {
    firstName: ['#first_name', 'first_name'],
    lastName: ['#last_name', 'last_name'],
    email: ['#email', 'email'],
    phone: ['#phone', 'phone'],
    coverLetter: ['#cover_letter_text', 'cover_letter_text'],
    resume: ['#resume_upload', 'resume'],
    linkedin: ['linkedin'],
    github: ['github'],
    portfolio: ['portfolio'],
    location: ['location'],
  },
  LEVER: {
    fullName: ['#name', 'name'],
    email: ['#email', 'email'],
    phone: ['#phone', 'phone'],
    linkedin: ['urls[LinkedIn]', 'linkedin'],
    github: ['urls[GitHub]', 'github'],
    portfolio: ['urls[Portfolio]', 'portfolio'],
    coverLetter: ['#coverLetter', 'coverLetter'],
    resume: ['#resume', 'resume'],
  },
  ASHBY: {
    fullName: ['_systemfield_name'],
    email: ['_systemfield_email'],
    phone: ['_systemfield_phone'],
    resume: ['_systemfield_resume'],
  },
  BAMBOOHR: {},
  WORKDAY: {},
  UNKNOWN: {},
};

function scoreField(field: FieldDescriptor, patterns: RegExp[]): number {
  const pieces = [field.label, field.name, field.id, field.placeholder, field.aria];
  let score = 0;
  for (const piece of pieces) {
    if (!piece) continue;
    if (matchesAny(piece, patterns)) {
      score += piece === field.label || piece === field.name || piece === field.id ? 3 : 2;
    }
  }
  if (!field.visible) score -= 5;
  if (field.isFile || field.type === 'hidden' || field.type === 'checkbox' || field.type === 'radio') score -= 10;
  return score;
}

async function fillField(page: Page, field: FieldDescriptor, value: string): Promise<boolean> {
  const selector = field.id
    ? `${field.tag}#${CSS.escape(field.id)}`
    : field.name
      ? `${field.tag}[name="${field.name.replace(/"/g, '\\"')}"]`
      : null;
  const locator = selector ? page.locator(selector).first() : page.locator(`${field.tag}`).nth(field.index);
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
    if (field.isSelect) {
      const matched = field.options.find((option) => {
        const lower = option.toLowerCase();
        if (/nigeria|lagos|abuja|africa|remote|worldwide|other|specify|select/.test(lower)) return true;
        return value.toLowerCase().includes(lower) && lower.length > 1;
      });
      if (matched) {
        await locator.selectOption({ label: matched }).catch(async () => {
          await locator.selectOption({ label: matched });
        });
        return true;
      }
      return false;
    }
    await locator.fill(value, { timeout: 5000 });
    return true;
  } catch (error) {
    logLine(`[apply] fill failed for ${field.id || field.name || field.tag}: ${String(error)}`);
    return false;
  }
}

function firstNameOf(profile: CandidateProfileDto): string {
  return profile.firstName || profile.fullName?.split(' ')[0] || 'Applicant';
}

function lastNameOf(profile: CandidateProfileDto): string {
  return profile.lastName || (profile.fullName ? profile.fullName.split(' ').slice(1).join(' ') : '') || '-';
}

async function uploadResume(page: Page, resumePath: string): Promise<boolean> {
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    try {
      await input.setInputFiles(resumePath, { timeout: 8000 });
      await page.waitForTimeout(2500);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

async function answerOpenQuestions(
  page: Page,
  profile: CandidateProfileDto,
  job: JobLike,
  answers: Record<string, string>,
): Promise<number> {
  const fields = await describeFields(page);
  const freeText = fields.filter(
    (field) =>
      field.visible &&
      !field.isFile &&
      !field.value &&
      (field.tag === 'textarea' || (field.tag === 'input' && ['text', ''].includes(field.type))) &&
      (field.required || field.tag === 'textarea') &&
      field.label.length > 8,
  );

  let answered = 0;
  for (const field of freeText.slice(0, 8)) {
    const knownPatterns = Object.entries(FIELD_PATTERNS).some(([, patterns]) => matchesAny(field.label, patterns));
    if (knownPatterns && field.tag !== 'textarea') continue;
    try {
      const question = field.label || field.placeholder;
      const answer = await answerCustomQuestion(question, {
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
      const selector = field.id
        ? `${field.tag}#${CSS.escape(field.id)}`
        : field.name
          ? `${field.tag}[name="${field.name.replace(/"/g, '\\"')}"]`
          : null;
      const locator = selector ? page.locator(selector).first() : page.locator(field.tag).nth(field.index);
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
      await locator.fill(answer, { timeout: 6000 });
      answers[question] = answer;
      answered += 1;
      await page.waitForTimeout(400);
    } catch (error) {
      logLine(`[apply] question answering failed: ${String(error)}`);
    }
  }
  return answered;
}

async function capture(page: Page, jobId: string, label: string): Promise<string | null> {
  try {
    const file = path.join(screenshotsDir(), `${jobId}-${label}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch {
    return null;
  }
}

export async function runFormApplication(
  job: JobLike,
  profile: CandidateProfileDto,
  options: { headless?: boolean } = {},
): Promise<FormApplyOutcome> {
  const headless = options.headless ?? process.env.AUTOMATION_HEADLESS === 'true';
  const target = job.applyUrl || job.url;
  const ats = detectAts(target);
  const answers: Record<string, string> = {};
  const resumePath = await latestDocumentPath(profile.id, 'RESUME');

  let context: BrowserContext | null = null;
  let screenshotPath: string | null = null;

  try {
    const chromiumBrowser = await getBrowser(headless);
    context = await chromiumBrowser.newContext({
      viewport: { width: 1440, height: 960 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'Africa/Lagos',
    });
    const page = await context.newPage();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    // Some ATSes put the form behind an "Apply" button
    const applyButton = page.getByRole('button', { name: /apply now|apply for this job|apply/i }).first();
    if (await applyButton.isVisible().catch(() => false)) {
      const alreadyHasForm = (await page.locator('input[type="file"]').count()) > 0;
      if (!alreadyHasForm) {
        await applyButton.click().catch(() => undefined);
        await page.waitForTimeout(2000);
      }
    }

    const values: Array<[keyof typeof FIELD_PATTERNS, string]> = [
      ['firstName', firstNameOf(profile)],
      ['lastName', lastNameOf(profile)],
      ['fullName', profile.fullName ?? `${firstNameOf(profile)} ${lastNameOf(profile)}`],
      ['email', profile.email ?? ''],
      ['phone', profile.phone ?? ''],
      ['linkedin', profile.linkedinUrl ?? ''],
      ['github', profile.githubUrl ?? ''],
      ['portfolio', profile.portfolioUrl ?? ''],
      ['location', profile.location ?? 'Remote (Nigeria, WAT/UTC+1)'],
    ];

    const fields = await describeFields(page);
    const used = new Set<number>();

    for (const [kind, value] of values) {
      if (!value) continue;
      let targetField: FieldDescriptor | null = null;
      let best = 0;

      for (const selector of ATS_FIELD_IDS[ats][kind] ?? []) {
        const match = fields.find(
          (field) =>
            !used.has(field.index) &&
            !field.isFile &&
            (field.id === selector.replace('#', '') || field.name === selector.replace('#', '')),
        );
        if (match) {
          targetField = match;
          best = 99;
          break;
        }
      }

      if (!targetField) {
        const patterns = FIELD_PATTERNS[kind];
        for (const field of fields) {
          if (used.has(field.index) || field.isFile) continue;
          const score = scoreField(field, patterns);
          if (score > best) {
            best = score;
            targetField = field;
          }
        }
      }

      if (targetField && best >= 2) {
        const ok = await fillField(page, targetField, value);
        if (ok) used.add(targetField.index);
      }
    }

    // Cover letter text (base letter + AI tailoring happens upstream, we send the stored one)
    if (resumePath) {
      const uploaded = await uploadResume(page, resumePath);
      if (!uploaded) logLine(`[apply] resume upload failed for job ${job.id}`);
    }

    await answerOpenQuestions(page, profile, job, answers);
    await page.waitForTimeout(800);
    screenshotPath = await capture(page, job.id, 'review');

    const submit = page
      .getByRole('button', { name: /submit application|submit|send application|apply now|complete application|finish/i })
      .first();
    const submitAlt = page.locator('input[type="submit"]').first();
    let clicked = false;
    if (await submit.isVisible().catch(() => false)) {
      await submit.scrollIntoViewIfNeeded().catch(() => undefined);
      await submit.click({ timeout: 8000 }).then(() => (clicked = true)).catch(() => undefined);
    }
    if (!clicked && (await submitAlt.isVisible().catch(() => false))) {
      await submitAlt.click({ timeout: 8000 }).then(() => (clicked = true)).catch(() => undefined);
    }

    await page.waitForTimeout(4000);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    screenshotPath = (await capture(page, job.id, clicked ? 'submitted' : 'unsubmitted')) ?? screenshotPath;

    const confirmed =
      /thank you|application (?:has been )?(?:received|submitted|successfully)|we(’|')ll be in touch|confirmation number|applied/i.test(
        bodyText,
      ) || page.url() !== target;

    const refMatch =
      bodyText.match(/(?:confirmation(?:\s*(?:number|id|code))?|reference(?:\s*(?:number|id))?|ticket)\s*[:#]?\s*([A-Z0-9\-_]{4,32})/i) ??
      bodyText.match(/\b([A-Z]{2,6}-?\d{4,12})\b/);

    if (clicked && confirmed) {
      return {
        ok: true,
        confirmationRef: refMatch?.[1] ?? null,
        detail: `Submitted via ${ats} form (${target})`,
        screenshotPath,
        answers,
      };
    }

    return {
      ok: false,
      confirmationRef: null,
      detail: clicked
        ? `Form submitted but no confirmation detected on ${ats}. Screenshot saved for manual review.`
        : `Could not locate/activate a submit control on ${ats}. Screenshot saved for manual review.`,
      screenshotPath,
      answers,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLine(`[apply] form agent error for ${job.company}: ${message}`);
    return {
      ok: false,
      confirmationRef: null,
      detail: `Form automation failed: ${message}`,
      screenshotPath,
      answers,
    };
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}

export function resumeExistsFor(profileId: string): Promise<boolean> {
  return latestDocumentPath(profileId, 'RESUME').then((value) => Boolean(value && fs.existsSync(value)));
}
