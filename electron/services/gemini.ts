import { GoogleGenAI } from '@google/genai';
import { getSetting } from '../db';

export interface CoverLetterInput {
  candidate: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    headline: string | null;
    summary: string | null;
    skills: string[];
    projects: Array<{ name: string; detail: string }>;
    isNigerianCitizen: boolean;
    yearsOfExperience: number;
  };
  job: {
    company: string;
    title: string;
    description: string;
    techTags: string[];
    location: string | null;
    regionEligibility: string;
  };
}

let cachedClient: { key: string; client: GoogleGenAI } | null = null;

async function getModel(): Promise<{ ai: GoogleGenAI; model: string }> {
  const apiKey = await getSetting('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Add it in Settings (free tier: https://aistudio.google.com/apikey).');
  }
  if (!cachedClient || cachedClient.key !== apiKey) {
    cachedClient = { key: apiKey, client: new GoogleGenAI({ apiKey }) };
  }
  const model = (await getSetting('GEMINI_MODEL')) || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  return { ai: cachedClient.client, model };
}

async function generate(model: string, prompt: string, systemInstruction?: string): Promise<string> {
  const { ai } = await getModel();
  const candidates = [model, 'gemini-2.0-flash', 'gemini-2.5-flash'].filter(
    (value, index, array) => value && array.indexOf(value) === index,
  );
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      const response = await ai.models.generateContent({
        model: candidate,
        contents: prompt,
        config: systemInstruction ? { systemInstruction, temperature: 0.7 } : { temperature: 0.7 },
      });
      const text = response.text ?? '';
      if (text.trim()) return text.trim();
      lastError = new Error(`Empty response from ${candidate}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (/api key|401|403/i.test(lastError.message)) throw lastError;
    }
  }
  throw lastError ?? new Error('Gemini request failed');
}

function snippet(input: CoverLetterInput): string {
  const description = input.job.description.replace(/\s+/g, ' ').slice(0, 2500);
  const projects = input.candidate.projects
    .slice(0, 3)
    .map((project) => `${project.name}: ${project.detail}`)
    .join(' | ');
  return [
    `Candidate: ${input.candidate.fullName ?? 'Applicant'} (${input.candidate.headline ?? 'Software engineer'})`,
    `Location: ${input.candidate.location ?? 'Remote (Africa/Worldwide)'}`,
    `Nationality: ${input.candidate.isNigerianCitizen ? 'Nigerian citizen' : 'International'}`,
    `Experience: ${input.candidate.yearsOfExperience} years`,
    `Skills: ${input.candidate.skills.slice(0, 24).join(', ')}`,
    `Projects: ${projects || 'n/a'}`,
    `About: ${input.candidate.summary?.slice(0, 600) ?? 'n/a'}`,
    `Role: ${input.job.title} at ${input.job.company}`,
    `Job tech stack: ${input.job.techTags.join(', ')}`,
    `Region eligibility: ${input.job.regionEligibility}`,
    `Job description: ${description}`,
  ].join('\n');
}

export async function generateCoverLetter(input: CoverLetterInput): Promise<string> {
  const prompt = `Write a concise, professional cover letter (280-360 words) for the role below.
Requirements:
- Plain text only, no markdown, no placeholders like [Company].
- Open with the specific role and company name.
- Mention 2-3 concrete skills that map to the job tech stack, supported by a real project from the candidate block.
- Address remote collaboration and asynchronous communication.
- If the candidate is a Nigerian citizen applying to a worldwide/EMEA remote role, briefly note timezone overlap (WAT/UTC+1) and remote-first experience, without sounding defensive.
- Close with a clear call to action and the candidate's contact details on a final line.

${snippet(input)}`;
  return generate(await modelOnly(), prompt, 'You are an expert technical recruiter writing on behalf of a junior software engineer.');
}

async function modelOnly(): Promise<string> {
  const { model } = await getModel();
  return model;
}

export async function answerCustomQuestion(
  question: string,
  input: CoverLetterInput,
  existingAnswer = '',
): Promise<string> {
  const base = `Question from the application form: "${question}"`;
  const context = snippet(input);
  if (existingAnswer && !/^(yes|no)$/i.test(existingAnswer.trim())) {
    return existingAnswer;
  }
  const prompt = `${base}
${existingAnswer ? `Candidate's draft answer: "${existingAnswer}"` : ''}
Write a short, first-person answer (max 90 words, plain text, no markdown) that a hiring manager would accept.
If the question is a yes/no question, start with Yes or No and justify in one sentence.
If the question asks for availability, start date, work authorization, or nationality, answer truthfully: the candidate is ${
    input.candidate.isNigerianCitizen ? 'a Nigerian citizen' : 'an international applicant'
  }, open to fully remote contract work worldwide, and available to start within 2 weeks.
Candidate context:
${context}`;
  return generate(await modelOnly(), prompt, 'You answer application form questions honestly and concisely.');
}

export async function summarizeJob(description: string): Promise<string> {
  const prompt = `Summarize this job posting in 3 bullet points (max 20 words each): responsibilities, stack, and any location constraints.\n\n${description.slice(0, 3000)}`;
  return generate(await modelOnly(), prompt);
}

export async function testGeminiConnection(): Promise<{ ok: boolean; detail: string }> {
  try {
    const text = await generate(await modelOnly(), 'Reply with the single word: pong');
    return { ok: true, detail: text.slice(0, 80) };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
