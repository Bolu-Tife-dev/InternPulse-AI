import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { getDb } from '../db';
import { uploadsDir } from '../paths';
import { extractProfile, ExtractedProfile } from './profileExtractor';

const ALLOWED_EXTENSIONS = ['.pdf', '.docx'];
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
]);

export async function parsePdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return (result.text ?? '').trim();
}

export async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? '').trim();
}

export async function parseDocumentBuffer(filename: string, buffer: Buffer): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return parsePdf(buffer);
  if (ext === '.docx') return parseDocx(buffer);
  throw new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
}

export async function saveAndParseDocument(
  profileId: string,
  kind: 'RESUME' | 'COVER_LETTER',
  filename: string,
  buffer: Buffer,
): Promise<{ documentId: string; extracted: ExtractedProfile | null }> {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
  const db = await getDb();
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const safeName = `${kind.toLowerCase()}-${Date.now()}${ext}`;
  const storagePath = path.join(uploadsDir(), safeName);
  await fs.writeFile(storagePath, buffer);

  const mimeType =
    ext === '.pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  const doc = await db.document.create({
    data: {
      profileId,
      kind,
      filename,
      storagePath,
      mimeType,
      sizeBytes: buffer.length,
      extractedText: '',
      parseStatus: 'PENDING',
      checksum,
    },
  });

  let extracted: ExtractedProfile | null = null;
  try {
    const text = await parseDocumentBuffer(filename, buffer);
    await db.document.update({
      where: { id: doc.id },
      data: { extractedText: text, parseStatus: 'PARSED', parseError: null },
    });
    if (kind === 'RESUME') extracted = extractProfile(text);
  } catch (error) {
    await db.document.update({
      where: { id: doc.id },
      data: { parseStatus: 'FAILED', parseError: error instanceof Error ? error.message : String(error) },
    });
  }

  return { documentId: doc.id, extracted };
}

export async function readDocumentText(documentId: string): Promise<string> {
  const db = await getDb();
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error('Document not found');
  if (doc.extractedText) return doc.extractedText;
  const buffer = await fs.readFile(doc.storagePath);
  const text = await parseDocumentBuffer(doc.filename, buffer);
  await db.document.update({ where: { id: documentId }, data: { extractedText: text, parseStatus: 'PARSED' } });
  return text;
}

export async function readLatestDocumentText(profileId: string, kind: 'RESUME' | 'COVER_LETTER'): Promise<string | null> {
  const db = await getDb();
  const docs = await db.document.findMany({
    where: { profileId, kind },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  if (!docs.length) return null;
  return readDocumentText(docs[0].id);
}

export async function latestDocumentPath(profileId: string, kind: 'RESUME' | 'COVER_LETTER'): Promise<string | null> {
  const db = await getDb();
  const docs = await db.document.findMany({
    where: { profileId, kind },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  if (!docs.length) return null;
  try {
    await fs.access(docs[0].storagePath);
    return docs[0].storagePath;
  } catch {
    return null;
  }
}
