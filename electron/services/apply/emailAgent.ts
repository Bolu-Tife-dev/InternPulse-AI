import nodemailer from 'nodemailer';
import { getSetting } from '../../db';
import type { CandidateProfileDto } from '../../../shared/types';

export interface EmailApplyInput {
  profile: CandidateProfileDto;
  to: string;
  company: string;
  title: string;
  coverLetter: string;
  resumePath: string | null;
}

export interface EmailApplyOutcome {
  ok: boolean;
  channel: 'SMTP' | 'GRAPH';
  messageId: string | null;
  detail: string;
}

function buildSubject(name: string, title: string, company: string): string {
  return `Application for ${title} at ${company} — ${name}`;
}

async function sendViaSmtp(input: EmailApplyInput): Promise<EmailApplyOutcome> {
  const host = await getSetting('SMTP_HOST');
  if (!host) throw new Error('SMTP is not configured');
  const port = Number((await getSetting('SMTP_PORT')) || '587');
  const secure = (await getSetting('SMTP_SECURE')) === 'true' || port === 465;
  const user = await getSetting('SMTP_USER');
  const pass = await getSetting('SMTP_PASS');
  const from = (await getSetting('SMTP_FROM')) || user || input.profile.email || '';

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    tls: { rejectUnauthorized: false },
  });

  await transporter.verify();

  const info = await transporter.sendMail({
    from: `"${input.profile.fullName ?? 'InternPulse Applicant'}" <${from}>`,
    to: input.to,
    subject: buildSubject(input.profile.fullName ?? 'Applicant', input.title, input.company),
    text: input.coverLetter,
    html: `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${input.coverLetter
      .split('\n')
      .map((line) => (line.trim() ? `<p style="margin:0 0 12px">${line}</p>` : '<br/>'))
      .join('')}</div>`,
    attachments: input.resumePath
      ? [{ filename: input.resumePath.split(/[\\/]/).pop() ?? 'resume.pdf', path: input.resumePath }]
      : [],
  });

  return {
    ok: true,
    channel: 'SMTP',
    messageId: info.messageId ?? null,
    detail: `Email accepted by ${host} (${info.response ?? 'ok'})`,
  };
}

async function sendViaGraph(input: EmailApplyInput, accessToken: string): Promise<EmailApplyOutcome> {
  const from = (await getSetting('SMTP_FROM')) || input.profile.email || '';
  const payload = {
    message: {
      subject: buildSubject(input.profile.fullName ?? 'Applicant', input.title, input.company),
      body: { contentType: 'Text', content: input.coverLetter },
      toRecipients: [{ emailAddress: { address: input.to } }],
      attachments: [] as unknown[],
    },
    saveToSentItems: true,
  };
  void payload;
  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Graph sendMail failed: HTTP ${response.status} ${await response.text()}`);
  }
  void from;
  void input.resumePath;
  return {
    ok: true,
    channel: 'GRAPH',
    messageId: null,
    detail: 'Application email sent through Microsoft Graph (/me/sendMail)',
  };
}

let graphTokenProvider: (() => Promise<string | null>) | null = null;

export function registerGraphTokenProvider(provider: () => Promise<string | null>): void {
  graphTokenProvider = provider;
}

export async function sendApplicationEmail(input: EmailApplyInput): Promise<EmailApplyOutcome> {
  const errors: string[] = [];
  try {
    return await sendViaSmtp(input);
  } catch (error) {
    errors.push(`SMTP: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (graphTokenProvider) {
    try {
      const token = await graphTokenProvider();
      if (token) return await sendViaGraph(input, token);
      errors.push('GRAPH: no signed-in Outlook account');
    } catch (error) {
      errors.push(`GRAPH: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: false, channel: 'SMTP', messageId: null, detail: errors.join(' | ') };
}
