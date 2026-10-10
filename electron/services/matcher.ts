import type { JobDomain, RegionEligibility, RoleType } from '../../shared/types';

export interface RegionVerdict {
  eligibility: RegionEligibility;
  confidence: number;
  notes: string[];
  allowed: boolean;
}

export interface RoleVerdict {
  roleType: RoleType;
  domain: JobDomain;
  remote: boolean;
  score: number;
  notes: string[];
}

const INTERN_WORDS =
  /\b(intern(ship)?|internship program|co-?op|apprentice(ship)?|student programmer|student engineer|summer intern|graduate trainee|graduate program|graduate scheme|new grad|bootcamp graduate|junior engineer|entry[\s-]?level|junior[\s-]?(developer|software|frontend|full[\s-]?stack|engineer))\b/i;

const NOT_INTERNSHIP =
  /\b(senior|staff|principal|lead|head of|director|vp of|manager|architect|10\+ years|8\+ years|5\+ years)\b/i;

const GRADUATE_WORDS =
  /\b(graduate trainee|graduate program|graduate scheme|graduate software engineer|graduate engineer|new grad|campus hire|university graduate|graduate level)\b/i;

const NON_TECH_TITLE =
  /\b(sales|marketing|account executive|customer success|human resources|\bhr\b|talent|finance|legal|recruiter|recruiting|design|product manager|project manager|program manager|communications|support|business development|account manager|content|operations|assistant|office|secretary|accountant|nurse|physician)\b/i;

const JUNIOR_WORDS = /\b(junior|entry[\s-]?level|early career|level i|0[\s-]?2\s*years|1[\s-]?2\s*years)\b/i;

const DOMAIN_SIGNALS: Array<[JobDomain, RegExp]> = [
  ['FRONTEND', /\b(front[\s-]?end|react(\.js|js)?|angular|vue(\.js|js)?|next\.?js|svelte|ui engineer|ui developer|web developer|javascript engineer|typescript engineer|css|html)\b/i],
  ['BACKEND', /\b(back[\s-]?end|server[\s-]?side|api engineer|platform engineer|node\.?js|django|flask|fastapi|spring boot|rails|golang|java engineer|\.net)\b/i],
  ['FULLSTACK', /\b(full[\s-]?stack|fullstack|product engineer|software engineer, full|generalist engineer)\b/i],
  ['WEB', /\b(web development|web engineer|webmaster|wordpress|webflow)\b/i],
  ['SOFTWARE', /\b(software engineer|software developer|programmer|swe|application developer|mobile engineer|android|ios|flutter|react native|machine learning engineer|ml engineer|data engineer|systems engineer|infrastructure engineer|security engineer|quality engineer|qa engineer)\b/i],
];

const REMOTE_OK =
  /\b(remote|work from home|wfh|anywhere in the world|worldwide|distributed team|fully remote|100% remote|online|telecommut)\b/i;

const REMOTE_ONSITE = /\b(on[\s-]?site|in[\s-]?office|relocation required|must be located|hybrid)\b/i;

const ACCEPT_STRONG = [
  /\bworldwide\b/i,
  /\bglobal(ly)?\s+(remote|candidates|team)\b/i,
  /\banywhere\b/i,
  /\ball (?:countries|locations|geographies|regions)\b/i,
  /\bno location (?:requirement|restriction)\b/i,
  /\bwork from anywhere\b/i,
];

const ACCEPT_AFRICA = [
  /\bnigeria[n]?\b/i,
  /\bafrica[n]?\b/i,
  /\bsub[\s-]?saharan\b/i,
  /\bemea\b/i,
  /\bmena\b/i,
  /\bwest africa\b/i,
  /\beast africa\b/i,
  /\bafrica and the middle east\b/i,
];

const ACCEPT_REMOTE_CONTRACTOR = [
  /\bremote (?:contractor|contract|freelanc|consultant)s?\b/i,
  /\bglobal contractors?\b/i,
  /\bworldwide contractors?\b/i,
  /\bany location\b/i,
  /\bnationality (?:is )?(?:not|no longer) (?:a )?(?:restriction|requirement|barrier)\b/i,
  /\bnationality does not matter\b/i,
];

const REJECT_TAX_RESIDENCY = [
  /\bmust (?:be|reside|live) (?:legally )?in (?:the )?(?:united states|usa|u\.s\.|us)\b/i,
  /\bus (?:citizens|residents|persons) only\b/i,
  /\bremote(?:ly)? (?:within|in|only in|-only)\s*(?:the )?(?:united states|usa|u\.s\.a?|uk|united kingdom|eu|european union|canada|australia|india|singapore|germany|japan)\b/i,
  /\b(united states|usa|u\.s\.a?|canada|united kingdom|uk|european union|eu|australia|germany|france|spain|netherlands|portugal|poland|india) (?:residency|tax residency|based)\b/i,
  /\b(authorized|authorised|legally) to work (?:in|within) (?:the )?(?:united states|usa|uk|eu|european union|germany|canada)\b/i,
  /\bonly (?:open to|accepting) candidates (?:located )?(?:in|from) (?:the )?(?:united states|usa|uk|eu)\b/i,
  /\bmust hold (?:a )?(?:valid )?(?:eu|uk|us|german) (?:work )?(?:visa|permit|citizenship)\b/i,
  /\bh[\s-]?1b\b|\bsponsorship (?:is )?(?:not available|not provided|required)\b/i,
  /\bexclusively (?:in|within|for) (?:the )?(?:united states|usa|uk|eu|european union)\b/i,
];

export function classifyRegion(text: string, location?: string | null): RegionVerdict {
  const haystack = `${text ?? ''}\n${location ?? ''}`;
  const notes: string[] = [];
  let strong = 0;
  let africa = 0;
  let contractor = 0;
  let reject = 0;

  for (const pattern of ACCEPT_STRONG) if (pattern.test(haystack)) strong += 1;
  for (const pattern of ACCEPT_AFRICA) if (pattern.test(haystack)) africa += 1;
  for (const pattern of ACCEPT_REMOTE_CONTRACTOR) if (pattern.test(haystack)) contractor += 1;
  for (const pattern of REJECT_TAX_RESIDENCY) if (pattern.test(haystack)) reject += 1;

  if (strong) notes.push(`worldwide signal x${strong}`);
  if (africa) notes.push(`africa/EMEA signal x${africa}`);
  if (contractor) notes.push(`global contractor signal x${contractor}`);
  if (reject) notes.push(`restricted-residency signal x${reject}`);

  if (strong > 0 && reject === 0) {
    return { eligibility: 'WORLDWIDE', confidence: Math.min(0.98, 0.7 + 0.1 * strong), notes, allowed: true };
  }
  if (reject > 0 && strong === 0 && africa === 0 && contractor === 0) {
    return { eligibility: 'RESTRICTED', confidence: Math.min(0.97, 0.7 + 0.12 * reject), notes, allowed: false };
  }
  if (reject > 0 && africa === 0 && contractor === 0) {
    // mixed signals leaning restrictive — only allow when an explicit africa mention exists
    return { eligibility: 'RESTRICTED', confidence: 0.55, notes, allowed: false };
  }
  if (africa > 0 && reject === 0) {
    return { eligibility: 'AFRICA_EMEA', confidence: Math.min(0.95, 0.72 + 0.08 * africa), notes, allowed: true };
  }
  if (africa > 0 && contractor > 0) {
    return { eligibility: 'AFRICA_EMEA', confidence: 0.8, notes, allowed: true };
  }
  if (/^\s*(remote|worldwide|anywhere|global)\s*$/i.test(location ?? '')) {
    return { eligibility: 'WORLDWIDE', confidence: 0.6, notes: [...notes, 'location field is remote/worldwide'], allowed: true };
  }
  if (/\bnigeria\b/i.test(location ?? '')) {
    return { eligibility: 'NIGERIA_EXPLICIT', confidence: 0.85, notes: [...notes, 'location field names Nigeria'], allowed: true };
  }
  return { eligibility: 'UNKNOWN', confidence: 0.35, notes, allowed: false };
}

export function classifyRole(title: string, description: string, tags: string[] = [], location?: string | null): RoleVerdict {
  const haystack = `${title}\n${location ?? ''}\n${tags.join(' ')}\n${description.slice(0, 4000)}`;
  const notes: string[] = [];
  let roleType: RoleType = 'UNKNOWN';

  if (INTERN_WORDS.test(title) || INTERN_WORDS.test(tags.join(' '))) {
    roleType = NOT_INTERNSHIP.test(title) ? 'UNKNOWN' : 'INTERNSHIP';
  } else if (GRADUATE_WORDS.test(title) || GRADUATE_WORDS.test(haystack) || /^graduate\b/i.test(title.trim())) {
    roleType = 'GRADUATE';
  } else if (JUNIOR_WORDS.test(title)) {
    roleType = 'JUNIOR';
  } else if (INTERN_WORDS.test(description)) {
    roleType = 'INTERNSHIP';
  } else if (JUNIOR_WORDS.test(haystack)) {
    roleType = 'JUNIOR';
  }
  notes.push(`roleType=${roleType}`);

  if (NOT_INTERNSHIP.test(title) && roleType !== 'INTERNSHIP') {
    notes.push('senior-level title signals mismatch');
  }

  let domain: JobDomain = 'UNKNOWN';
  for (const [candidate, pattern] of DOMAIN_SIGNALS) {
    if (pattern.test(title)) {
      domain = candidate;
      break;
    }
  }
  if (domain === 'UNKNOWN') {
    for (const [candidate, pattern] of DOMAIN_SIGNALS) {
      if (pattern.test(haystack)) {
        domain = candidate;
        break;
      }
    }
  }
  if (domain === 'UNKNOWN' && !NON_TECH_TITLE.test(title)) {
    if (/\b(engineer|developer|programmer|devops|sre|full[\s-]?stack|web)\b/i.test(title)) {
      domain = 'SOFTWARE';
    }
  }
  notes.push(`domain=${domain}`);

  const remote = REMOTE_OK.test(haystack) || (!REMOTE_ONSITE.test(title) && /\bremote\b/i.test(haystack));
  notes.push(remote ? 'remote policy ok' : 'no remote signal');

  let score = 0;
  if (roleType === 'INTERNSHIP') score += 55;
  else if (roleType === 'GRADUATE') score += 42;
  else if (roleType === 'JUNIOR') score += 28;
  else score += 5;
  if (domain !== 'UNKNOWN') score += 22;
  if (['FRONTEND', 'FULLSTACK', 'SOFTWARE'].includes(domain)) score += 8;
  if (remote) score += 20;

  return { roleType, domain, remote, score: Math.min(100, score), notes };
}

export function isEligibleRole(verdict: RoleVerdict): boolean {
  return (
    verdict.remote &&
    verdict.roleType !== 'UNKNOWN' &&
    ['FRONTEND', 'FULLSTACK', 'SOFTWARE', 'WEB', 'BACKEND'].includes(verdict.domain)
  );
}
