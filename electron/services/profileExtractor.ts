import { NORMALIZED_SKILLS, canonicalSkill, normalizeSkillList } from './skillLexicon';

export interface ExtractedProject {
  name: string;
  detail: string;
}

export interface ExtractedProfile {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  yearsOfExperience: number | null;
  skills: string[];
  projects: ExtractedProject[];
  languages: string[];
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{5,22}\d/g;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[A-Za-z0-9_\-/%.]+/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_\-]+/i;
const PORTFOLIO_RE = /(?:https?:\/\/)?(?:www\.)?(?:([A-Za-z0-9-]+)\.)?(?:vercel\.app|netlify\.app|github\.io|herokuapp\.com|pages\.dev|surge\.sh|web\.app|firebaseapp\.com)(?:\/[A-Za-z0-9_\-/%.]*)?/i;

const LOCATION_HINTS =
  /\b(?:[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s*(?:Nigeria|Ghana|Kenya|南非|United States|USA|UK|Canada|Germany|India|Remote|Worldwide|Africa|Europe|Lagos|Abuja|Port Harcourt|Ibadan|Africa))\b/;

const YEARS_RE = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)/i;

function tidy(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstMeaningfulLines(text: string, count: number): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 1 && line.length < 120)
    .slice(0, count);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

function detectName(text: string): { fullName: string | null; firstName: string | null; lastName: string | null } {
  const lines = firstMeaningfulLines(text, 8);
  for (const line of lines) {
    const cleaned = line.replace(/[•|_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (EMAIL_RE.test(cleaned)) continue;
    if (/linkedin|github|http|www\.|@/i.test(cleaned)) continue;
    if (/\d/.test(cleaned)) continue;
    if (cleaned.length > 45) continue;
    const words = cleaned.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (words.every((word) => word.length <= 2)) continue;
    const capitalized = words.filter((word) => /^[A-Z][a-zA-Z'’\-]+$/.test(word));
    if (capitalized.length < 2) continue;
    const fullName = titleCase(words.join(' '));
    return { fullName, firstName: titleCase(words[0]), lastName: titleCase(words[words.length - 1]) };
  }
  return { fullName: null, firstName: null, lastName: null };
}

function detectHeadline(text: string): string | null {
  const lines = firstMeaningfulLines(text, 12);
  const pattern =
    /(engineer|developer|programmer|architect|student|intern|graduate|designer|analyst|swe|full[\s-]?stack|frontend|front[\s-]?end|back[\s-]?end|software|devops|data)/i;
  for (const line of lines) {
    if (line.length < 8 || line.length > 90) continue;
    if (EMAIL_RE.test(line) || /linkedin|github/i.test(line)) continue;
    if (pattern.test(line) && line.split(' ').length <= 10) return line.replace(/\s*[|•/]\s*$/, '').trim();
  }
  return null;
}

function detectSummary(text: string): string | null {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter((block) => block.length > 120 && block.length < 900);
  const summaryHeader = /(?:profile|summary|about me|about|objective|professional summary)/i;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const previous = paragraphs[i - 1] ?? '';
    if (summaryHeader.test(previous) || /^(self[\s-]?driven|results[\s-]?driven|passionate|detail[\s-]?oriented)/i.test(paragraphs[i])) {
      return paragraphs[i];
    }
  }
  return paragraphs[0] ?? null;
}

function extractSkills(text: string): string[] {
  const lower = ` ${text.toLowerCase().replace(/[`]/g, '')} `;
  const found = new Set<string>();
  for (const skill of NORMALIZED_SKILLS) {
    const needle = skill.replace('.', '\\.');
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wide = new RegExp(`(^|[^a-z0-9+#.])${escaped}($|[^a-z0-9+#])`, 'i');
    if (wide.test(lower)) found.add(canonicalSkill(skill));
  }
  const bracketSection = text.match(/(?:tech stack|technologies|skills|core competencies|stack)[:\s]*([^\n]{0,400})/i);
  if (bracketSection) {
    for (const piece of bracketSection[1].split(/[,;|/•·]+/)) {
      const value = piece.trim().toLowerCase();
      if (value.length >= 2 && value.length <= 30 && !/^\d/.test(value)) found.add(canonicalSkill(value));
    }
  }
  return normalizeSkillList(Array.from(found));
}

function extractProjects(text: string): ExtractedProject[] {
  const projects: ExtractedProject[] = [];
  const lines = text.split('\n');
  let collecting: { name: string; body: string[] } | null = null;

  const header = /^\s*(?:#{0,3}\s*)?(?:selected\s+)?(?:personal\s+|academic\s+|key\s+)?projects?\b[:\-–]?/i;
  const itemStart = /^\s*(?:[-*•●▪]|\d+[.)])\s+(.{3,80})$/;

  const flush = () => {
    if (collecting && collecting.name) {
      const detail = collecting.body.join(' ').replace(/\s+/g, ' ').trim().slice(0, 280);
      projects.push({ name: collecting.name.replace(/\s*[:\-–]\s*$/, '').trim(), detail });
    }
    collecting = null;
  };

  let inSection = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ').trimEnd();
    if (header.test(line)) {
      flush();
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    const item = line.match(itemStart);
    if (item) {
      flush();
      collecting = { name: item[1].replace(/\s*[:\-–]\s*$/, '').trim(), body: [] };
      continue;
    }
    // Unbulleted resume line inside a Projects section: "Project name: description"
    const unbulleted = line.match(/^([A-Za-z0-9][^:]{2,78})\s*[:–-]\s*(.+)$/);
    if (unbulleted && !/^https?:/i.test(unbulleted[1])) {
      flush();
      collecting = { name: unbulleted[1].trim(), body: [unbulleted[2].trim()] };
      continue;
    }
    if (collecting) collecting.body.push(line.trim());
  }
  flush();

  const unique = new Map<string, ExtractedProject>();
  for (const project of projects) {
    if (project.name.length < 3) continue;
    if (!unique.has(project.name.toLowerCase())) unique.set(project.name.toLowerCase(), project);
  }
  return Array.from(unique.values()).slice(0, 12);
}

function extractLanguages(text: string): string[] {
  const known = [
    'english', 'french', 'spanish', 'portuguese', 'german', 'arabic', 'mandarin', 'chinese',
    'hindi', 'yoruba', 'igbo', 'hausa', 'swahili', 'dutch', 'italian', 'russian', 'japanese',
  ];
  const lower = text.toLowerCase();
  const found = known.filter((language) => new RegExp(`\\b${language}\\b`, 'i').test(lower));
  return Array.from(new Set(found));
}

function plausiblePhone(candidate: string): string | null {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (/^0{4,}$/.test(digits)) return null;
  return candidate.replace(/\s+/g, ' ').trim();
}

export function extractProfile(rawText: string): ExtractedProfile {
  const text = tidy(rawText);
  const emailMatches = text.match(EMAIL_RE) ?? [];
  const email = emailMatches.find((value) => !/example\.com|sentry\.io|@font|@media/i.test(value)) ?? null;

  const linkedinRaw = text.match(LINKEDIN_RE)?.[0] ?? null;
  const githubRaw = text.match(GITHUB_RE)?.[0] ?? null;
  const portfolioRaw = text.match(PORTFOLIO_RE)?.[0] ?? null;

  let phone: string | null = null;
  for (const candidate of text.match(PHONE_CANDIDATE_RE) ?? []) {
    const plausible = plausiblePhone(candidate);
    if (plausible) {
      phone = plausible;
      break;
    }
  }

  const locationMatch = text.match(LOCATION_HINTS);
  const location = locationMatch ? locationMatch[0].trim() : null;

  const yearsMatch = text.match(YEARS_RE);
  const years = yearsMatch ? Number.parseFloat(yearsMatch[1]) : null;

  const name = detectName(text);

  const absolute = (value: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.replace(/[.,;)]+$/, '');
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  };

  return {
    fullName: name.fullName,
    firstName: name.firstName,
    lastName: name.lastName,
    email: email ? email.toLowerCase() : null,
    phone,
    linkedinUrl: absolute(linkedinRaw),
    githubUrl: absolute(githubRaw),
    portfolioUrl: absolute(portfolioRaw),
    location,
    headline: detectHeadline(text),
    summary: detectSummary(text),
    yearsOfExperience: years,
    skills: extractSkills(text),
    projects: extractProjects(text),
    languages: extractLanguages(text),
  };
}

/** Cheap, dependency-free keyword extractor used for job descriptions too. */
export function extractTechTags(text: string): string[] {
  return extractSkills(text).slice(0, 24);
}
