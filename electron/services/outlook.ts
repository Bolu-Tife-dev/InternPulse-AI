import * as msal from '@azure/msal-node';
import { getDb, getSetting, setSetting } from '../db';
import { logLine } from '../env';
import type { OutlookAccountDto } from '../../shared/types';

const TOKEN_CACHE_KEY = 'MS_TOKEN_CACHE';
const ACCOUNT_KEY = 'MS_ACCOUNT';

function cachePlugin() {
  return {
    beforeCacheAccess: async (cacheContext: { tokenCache: { deserialize: (s: string) => Promise<void> | void } }) => {
      const serialized = await getSetting(TOKEN_CACHE_KEY, '');
      if (serialized) {
        await cacheContext.tokenCache.deserialize(serialized);
      }
    },
    afterCacheAccess: async (cacheContext: {
      tokenCache: { serialize: () => string };
      hasCacheChanged: boolean;
    }) => {
      if (cacheContext.hasCacheChanged) {
        await setSetting(TOKEN_CACHE_KEY, cacheContext.tokenCache.serialize());
      }
    },
  };
}

async function createClient(): Promise<msal.PublicClientApplication> {
  const clientId = await getSetting('MS_CLIENT_ID');
  if (!clientId) {
    throw new Error('MS_CLIENT_ID is not configured. Register an Azure app (public client) and paste the ID in Settings.');
  }
  const tenantId = (await getSetting('MS_TENANT_ID')) || 'common';
  return new msal.PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      knownAuthorities: tenantId === 'common' ? undefined : [`login.microsoftonline.com/${tenantId}`],
    },
    cache: { cachePlugin: cachePlugin() as never },
  });
}

export function scopes(): string[] {
  const raw = process.env.MS_SCOPES || 'User.Read,Mail.Read,Mail.Send';
  return raw
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
    .map((scope) => (scope.includes('/') ? scope : scope));
}

function defaultScopes(): string[] {
  return ['User.Read', 'Mail.Read', 'Mail.Send'];
}

let deviceCodeCallback: ((message: string) => void) | null = null;

export function onDeviceCodeMessage(callback: (message: string) => void): void {
  deviceCodeCallback = callback;
}

export async function signInWithDeviceCode(): Promise<OutlookAccountDto> {
  const pca = await createClient();
  const requested = await getSetting('MS_SCOPES', '');
  const requestedScopes = requested ? requested.split(',').map((s) => s.trim()).filter(Boolean) : defaultScopes();

  const result = await pca.acquireTokenByDeviceCode({
    deviceCodeCallback: (response) => {
      const message = `${response.message}\nWaiting for you to finish signing in…`;
      logLine(`[outlook] device code: ${response.userCode}`);
      if (deviceCodeCallback) deviceCodeCallback(message);
    },
    scopes: requestedScopes,
  });

  if (!result) throw new Error('Microsoft sign-in returned no token');
  await setSetting(ACCOUNT_KEY, JSON.stringify({ username: result.account?.username, name: result.account?.name }));
  return {
    signedIn: true,
    userPrincipalName: result.account?.username ?? null,
    displayName: result.account?.name ?? null,
    expiresOn: result.expiresOn ? new Date(result.expiresOn).toISOString() : null,
    scopes: result.scopes ?? requestedScopes,
  };
}

async function acquireSilent(): Promise<string | null> {
  const pca = await createClient();
  const cache = pca.getTokenCache();
  const accounts = await cache.getAllAccounts();
  if (!accounts.length) return null;
  const account = accounts[0];
  const requested = await getSetting('MS_SCOPES', '');
  const requestedScopes = requested ? requested.split(',').map((s) => s.trim()).filter(Boolean) : defaultScopes();
  try {
    const result = await pca.acquireTokenSilent({ account, scopes: requestedScopes });
    return result?.accessToken ?? null;
  } catch (error) {
    logLine(`[outlook] silent token failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function getGraphToken(): Promise<string | null> {
  return acquireSilent();
}

export async function getAccount(): Promise<OutlookAccountDto> {
  try {
    const pca = await createClient();
    const accounts = await pca.getTokenCache().getAllAccounts();
    if (!accounts.length) {
      return { signedIn: false, userPrincipalName: null, displayName: null, expiresOn: null, scopes: [] };
    }
    const stored = await getSetting(ACCOUNT_KEY, '');
    const parsed = stored ? (JSON.parse(stored) as { username?: string; name?: string }) : {};
    const token = await acquireSilent();
    return {
      signedIn: Boolean(token),
      userPrincipalName: accounts[0].username ?? parsed.username ?? null,
      displayName: parsed.name ?? accounts[0].name ?? null,
      expiresOn: null,
      scopes: defaultScopes(),
    };
  } catch (error) {
    logLine(`[outlook] getAccount failed: ${error instanceof Error ? error.message : String(error)}`);
    return { signedIn: false, userPrincipalName: null, displayName: null, expiresOn: null, scopes: [] };
  }
}

export async function signOut(): Promise<void> {
  const pca = await createClient();
  const accounts = await pca.getTokenCache().getAllAccounts();
  for (const account of accounts) {
    await pca.getTokenCache().removeAccount(account).catch(() => undefined);
  }
  await setSetting(TOKEN_CACHE_KEY, '');
  await setSetting(ACCOUNT_KEY, '');
}

interface GraphMessage {
  id: string;
  threadId?: string;
  subject?: string;
  receivedDateTime?: string;
  bodyPreview?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
}

const CLASSIFIERS: Array<{ type: string; sentiment: string; pattern: RegExp; weight: number }> = [
  { type: 'REJECTION', sentiment: 'NEGATIVE', pattern: /\b(unfortunately|not mov(?:e|ing) forward|position (?:has been )?(?:filled|closed)|another candidate|regret to inform|no longer under consideration|we will not be progressing)\b/i, weight: 0.9 },
  { type: 'INTERVIEW', sentiment: 'POSITIVE', pattern: /\b(interview|schedule a call|phone screen|screening call|video call|meet the team|availability for|calendar invite|timeslot)\b/i, weight: 0.85 },
  { type: 'ASSESSMENT', sentiment: 'POSITIVE', pattern: /\b(assessment|coding challenge|take[\s-]?home|hacker rank|hackerrank|codility|trial task|technical test|assessment link|complete the following)\b/i, weight: 0.85 },
  { type: 'OFFER', sentiment: 'POSITIVE', pattern: /\b(offer|congratulations|we would like to extend|welcome to the team|onboarding)\b/i, weight: 0.95 },
  { type: 'ACK', sentiment: 'NEUTRAL', pattern: /\b(thank you for (?:your|applying)|application (?:has been )?received|we have received|confirm(?:ation)? of your application|auto[\s-]?reply|do not reply)\b/i, weight: 0.7 },
];

export function classifyEmail(subject: string, preview: string): { classification: string; sentiment: string; confidence: number } {
  const haystack = `${subject} ${preview}`;
  let best = { classification: 'UNCLASSIFIED', sentiment: 'NEUTRAL', confidence: 0.2 };
  for (const classifier of CLASSIFIERS) {
    if (classifier.pattern.test(haystack) && classifier.weight > best.confidence) {
      best = { classification: classifier.type, sentiment: classifier.sentiment, confidence: classifier.weight };
    }
  }
  return best;
}

export interface OutlookSyncSummary {
  scanned: number;
  matched: number;
  tagged: number;
  errors: string[];
}

export async function syncOutlookInbox(): Promise<OutlookSyncSummary> {
  const db = await getDb();
  const summary: OutlookSyncSummary = { scanned: 0, matched: 0, tagged: 0, errors: [] };

  const token = await getGraphToken();
  if (!token) {
    summary.errors.push('Not signed in to Outlook');
    return summary;
  }

  const applications = await db.application.findMany({
    include: { job: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const terms: Array<{ jobId: string; applicationId: string; company: string; title: string }> = applications.map(
    (application) => ({
      jobId: application.jobId,
      applicationId: application.id,
      company: application.job.company,
      title: application.job.title,
    }),
  );

  const url =
    'https://graph.microsoft.com/v1.0/me/messages?$top=100&$orderby=receivedDateTime%20desc&$select=id,threadId,subject,receivedDateTime,bodyPreview,from';
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    summary.errors.push(`Graph messages failed: HTTP ${response.status}`);
    return summary;
  }
  const payload = (await response.json()) as { value?: GraphMessage[] };
  const messages = payload.value ?? [];
  summary.scanned = messages.length;

  for (const message of messages) {
    const subject = message.subject ?? '';
    const preview = message.bodyPreview ?? '';
    const sender = message.from?.emailAddress?.address ?? '';
    const haystack = `${subject} ${preview} ${sender}`.toLowerCase();

    const matches = terms.filter((term) => {
      const company = term.company.toLowerCase();
      const titleTokens = term.title
        .toLowerCase()
        .split(/\W+/)
        .filter((token) => token.length > 3);
      const companyHit = company.length > 3 && haystack.includes(company);
      const titleHit = titleTokens.length > 0 && titleTokens.filter((token) => haystack.includes(token)).length >= 2;
      return companyHit || titleHit;
    });
    if (!matches.length) continue;

    summary.matched += 1;
    const existing = await db.emailMessage.findUnique({ where: { graphId: message.id } });
    const verdict = classifyEmail(subject, preview);

    if (existing) {
      if (existing.classification !== verdict.classification) {
        await db.emailMessage.update({
          where: { id: existing.id },
          data: { classification: verdict.classification, sentiment: verdict.sentiment, confidence: verdict.confidence },
        });
        summary.tagged += 1;
      }
      continue;
    }

    await db.emailMessage.create({
      data: {
        graphId: message.id,
        threadId: message.threadId ?? null,
        applicationId: matches[0].applicationId,
        matchedJobId: matches[0].jobId,
        subject,
        sender,
        bodyPreview: preview.slice(0, 1500),
        receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
        classification: verdict.classification,
        sentiment: verdict.sentiment,
        confidence: verdict.confidence,
        rawJson: JSON.stringify({ subject, sender }),
      },
    });
    summary.tagged += 1;

    const statusMap: Record<string, string> = {
      ACK: 'APPLIED',
      ASSESSMENT: 'SCREENING',
      INTERVIEW: 'INTERVIEW',
      OFFER: 'OFFER',
      REJECTION: 'REJECTED',
    };
    const nextStatus = statusMap[verdict.classification];
    if (nextStatus) {
      await db.application.update({
        where: { id: matches[0].applicationId },
        data: {
          status: nextStatus,
          statusDetail: `Email: ${subject} (${verdict.classification})`,
          updatedAt: new Date(),
        },
      });
    }
  }

  await db.syncRun.create({
    data: {
      kind: 'OUTLOOK',
      status: 'SUCCESS',
      found: summary.matched,
      created: summary.tagged,
      endedAt: new Date(),
      detail: JSON.stringify(summary),
    },
  });

  return summary;
}
