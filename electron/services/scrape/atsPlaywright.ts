import { chromium, Browser, Page } from 'playwright';
import { detectAtsType, extractEmails, stripHtml } from './http';
import type { RawJob, SourceResult } from './types';

const ROLE_PATTERN = /intern|internship|apprentice|graduate trainee|new grad|entry[\s-]?level|junior|co-?op/i;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(headless = true): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless, args: ['--disable-blink-features=AutomationControlled'] });
  }
  return browserPromise;
}

export async function closeScraperBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close().catch(() => undefined);
}

async function safeGoto(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);
}

function absolutize(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

interface CardCandidate {
  title: string;
  url: string;
  location?: string;
  salary?: string;
  tags?: string[];
}

function collectCardsFromDom(page: Page): Promise<CardCandidate[]> {
  return page.evaluate(() => {
    const results: Array<{ title: string; url: string; location?: string; salary?: string; tags?: string[] }> = [];
    const seen = new Set<string>();
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) continue;
      const text = (anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 6 || text.length > 160) continue;
      const absolute = (() => {
        try {
          return new URL(href, document.baseURI).toString();
        } catch {
          return href;
        }
      })();
      if (!/greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|/i.test(absolute) && !/jobs?\/|careers?\//i.test(absolute)) {
        continue;
      }
      const row = anchor.closest('li, tr, div, article');
      const rowText = ((row as HTMLElement | null)?.innerText || text).replace(/\s+/g, ' ').trim().slice(0, 300);
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      const location = rowText.match(/(Remote|Worldwide|Any ?location|Africa|EMEA|Nigeria|Hybrid|On[\s-]site)[^,|]*/i)?.[0]?.trim();
      const salary = rowText.match(/([$€£]\s?\d[\d,.kK]*\s*[-–]\s*[$€£]?\s?\d[\d,.kK]*(?:\s*(?:USD|EUR|GBP|per ?year|\/yr))?)/i)?.[0]?.trim();
      results.push({ title: text.replace(/\s*\(?remote\)?\s*$/i, '').trim(), url: absolute, location, salary });
    }
    return results;
  });
}

async function fetchJobDetail(page: Page, url: string): Promise<{ description: string; salary?: string; location?: string }> {
  try {
    await safeGoto(page, url);
    const html = await page.content();
    const description =
      (await page
        .evaluate(() => {
          const selectors = [
            '[data-automation-id="jobPostingDescription"]',
            '#content',
            '.job__description',
            '.section-wrapper',
            '.content',
            'main',
          ];
          for (const selector of selectors) {
            const node = document.querySelector(selector) as HTMLElement | null;
            if (node && (node.innerText || '').length > 200) return node.innerText;
          }
          return document.body.innerText;
        })
        .catch(() => '')) || stripHtml(html);
    const salary = description.match(/([$€£]\s?\d[\d,.kK]*\s*[-–]\s*[$€£]?\s?\d[\d,.kK]*)/)?.[0]?.trim();
    const location = description.match(/\b(Remote|Worldwide|Nigeria|EMEA|Africa|Hybrid|On[\s-]site)\b/i)?.[0]?.trim();
    return { description: description.slice(0, 20000), salary, location };
  } catch {
    return { description: '' };
  }
}

/**
 * Targeted Playwright scrapers for Greenhouse / Lever / Ashby / Workday career pages
 * (used when the JSON board APIs are unavailable or a custom careers URL is supplied).
 */
export async function scrapeAtsPage(
  url: string,
  options: { headless?: boolean; maxPages?: number; sourceLabel?: string } = {},
): Promise<SourceResult> {
  const source = options.sourceLabel ?? `playwright:${detectAtsType(url) ?? 'generic'}`;
  const headless = options.headless ?? true;
  const maxPages = options.maxPages ?? 25;
  try {
    const browser = await getBrowser(headless);
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1400, height: 900 },
    });
    const page = await context.newPage();
    await safeGoto(page, url);

    // Ashby ships its job board inside __NEXT_DATA__
    let ashbyJobs: RawJob[] = [];
    try {
      const nextData = await page.evaluate(() => {
        const node = document.querySelector('#__NEXT_DATA__');
        return node ? node.textContent : null;
      });
      if (nextData) {
        const parsed = JSON.parse(nextData) as {
          props?: { pageProps?: { jobBoard?: { jobs?: Array<Record<string, unknown>> } } };
        };
        const jobs = parsed.props?.pageProps?.jobBoard?.jobs ?? [];
        ashbyJobs = jobs.map((job, index) => {
          const record = job as {
            id?: string;
            title?: string;
            locationName?: string;
            jobUrl?: string;
            applyUrl?: string;
            descriptionPlain?: string;
            descriptionHtml?: string;
            publishedAt?: string;
          };
          return {
            source,
            sourceId: record.id ?? `${index}-${record.title}`,
            company: new URL(url).hostname.split('.')[1] ?? 'company',
            title: record.title ?? '',
            url: record.jobUrl ?? url,
            applyUrl: record.applyUrl,
            description: record.descriptionPlain ?? stripHtml(record.descriptionHtml ?? ''),
            descriptionHtml: record.descriptionHtml ?? '',
            location: record.locationName ?? 'Remote',
            publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
            atsType: 'ASHBY',
          } satisfies RawJob;
        });
      }
    } catch {
      /* fall through to DOM scraping */
    }

    const cards = await collectCardsFromDom(page);
    const relevant = cards.filter((card) => ROLE_PATTERN.test(card.title)).slice(0, maxPages);
    const jobs: RawJob[] = ashbyJobs.length ? ashbyJobs : [];
    const seen = new Set(jobs.map((job) => job.url));

    for (const card of relevant) {
      if (seen.has(card.url)) continue;
      seen.add(card.url);
      const detail = await fetchJobDetail(page, card.url);
      const emails = extractEmails(detail.description);
      jobs.push({
        source,
        sourceId: `${card.url.split('/').slice(3).join('/') || card.title}`.slice(0, 180),
        company: card.url.includes('greenhouse')
          ? card.url.split('/')[3] ?? 'Unknown'
          : card.url.includes('lever')
            ? card.url.split('/')[3] ?? 'Unknown'
            : card.url.includes('ashbyhq')
              ? card.url.split('/')[3] ?? 'Unknown'
              : new URL(url).hostname.split('.')[1] ?? 'Unknown',
        title: card.title,
        url: card.url,
        description: detail.description,
        descriptionHtml: '',
        salary: detail.salary ?? card.salary,
        location: detail.location ?? card.location ?? 'Remote',
        tags: [],
        publishedAt: null,
        applyEmail: emails[0],
        atsType: detectAtsType(card.url) ?? detectAtsType(url) ?? 'UNKNOWN',
      } satisfies RawJob);
    }

    await context.close();
    return { source, jobs };
  } catch (error) {
    return { source, jobs: [], error: error instanceof Error ? error.message : String(error) };
  }
}
