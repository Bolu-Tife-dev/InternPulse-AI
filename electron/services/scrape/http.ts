import * as cheerio from 'cheerio';
import { DEFAULT_USER_AGENT } from './types';

export interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25000);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,application/json', ...options.headers },
      body: options.body,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<cheerio.CheerioAPI> {
  const html = await fetchText(url, options);
  return cheerio.load(html);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractEmails(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(
    new Set(
      matches.filter(
        (value) =>
          !/example\.(com|org|net)/i.test(value) &&
          !/sentry\.io|@font|@media|wixpress|squarespace/i.test(value),
      ),
    ),
  );
}

export function detectAtsType(url: string): string | null {
  const lower = url.toLowerCase();
  if (/greenhouse\.io|boards\.greenhouse|job-boards\.greenhouse/.test(lower)) return 'GREENHOUSE';
  if (/lever\.co|jobs\.lever/.test(lower)) return 'LEVER';
  if (/ashbyhq\.com|jobs\.ashby/.test(lower)) return 'ASHBY';
  if (/bamboohr\.com|bamboo\.hr/.test(lower)) return 'BAMBOOHR';
  if (/myworkdayjobs\.com|wd5\.myworkdayjobs|wd3\.myworkdayjobs/.test(lower)) return 'WORKDAY';
  return null;
}
