import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Badge } from '../components/Badge';
import { Spinner, pushToast } from '../components/Toast';
import { api, toBase64, unwrap } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import type { CandidateProfileDto, DocumentDto } from '../../../shared/types';

export function ProfilePage() {
  const [profile, setProfile] = useState<CandidateProfileDto | null>(null);
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const letterInput = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const [nextProfile, nextDocs] = await Promise.all([unwrap(api.getProfile()), unwrap(api.listDocuments())]);
    setProfile(nextProfile);
    setDocuments(nextDocs);
  };

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const updated = await unwrap(api.updateProfile(profile));
      setProfile(updated);
      pushToast('success', 'Profile saved to the local database.');
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: 'RESUME' | 'COVER_LETTER', file: File) => {
    setUploading(kind);
    try {
      const buffer = await file.arrayBuffer();
      await unwrap(
        api.uploadDocument({ kind, filename: file.name, dataBase64: toBase64(buffer) }),
      );
      await reload();
      pushToast('success', `${kind === 'RESUME' ? 'CV' : 'Cover letter'} parsed locally.`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16">
        <Spinner label="Loading profile…" />
      </div>
    );
  }

  const field = (key: keyof CandidateProfileDto, label: string, type = 'text') => (
    <div>
      <label className="label" htmlFor={String(key)}>
        {label}
      </label>
      <input
        id={String(key)}
        className="input"
        type={type}
        value={String(profile?.[key] ?? '')}
        onChange={(event) => setProfile((current) => (current ? { ...current, [key]: event.target.value } : current))}
      />
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Profile & CV"
        subtitle="Documents are parsed with pdf-parse / mammoth on-device — nothing leaves your machine except auto-apply."
        actions={
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <section className="panel p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">Documents</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['RESUME', 'CV / Resume (PDF, DOCX)', resumeInput],
                  ['COVER_LETTER', 'Base cover letter (PDF, DOCX)', letterInput],
                ] as const
              ).map(([kind, label, ref]) => (
                <div key={kind} className="rounded-lg border border-ink-700/70 bg-ink-950/40 p-4">
                  <div className="text-xs font-semibold text-slate-200">{label}</div>
                  <input
                    ref={ref}
                    type="file"
                    accept=".pdf,.docx"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(kind, file);
                      event.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost mt-3 w-full"
                    onClick={() => ref.current?.click()}
                    disabled={uploading === kind}
                  >
                    {uploading === kind ? 'Parsing…' : 'Choose file'}
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              {documents.length === 0 ? (
                <p className="text-sm text-slate-500">No documents uploaded yet.</p>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-950/50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-200">
                        {doc.filename}
                        <span className="ml-2 text-xs text-slate-500">{formatBytes(doc.sizeBytes)}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {doc.kind} · {formatDate(doc.createdAt)} · {doc.textPreview ? `${doc.textPreview.length}+ chars parsed` : 'no text'}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={doc.parseStatus === 'PARSED' ? 'ok' : doc.parseStatus === 'FAILED' ? 'bad' : 'warn'}>
                        {doc.parseStatus}
                      </Badge>
                      <button
                        type="button"
                        className="text-xs text-slate-400 hover:text-white"
                        onClick={() => void unwrap(api.reparseDocument(doc.id)).then(() => reload())}
                      >
                        Reparse
                      </button>
                      <button
                        type="button"
                        className="text-xs text-rose-400 hover:text-rose-300"
                        onClick={() => void unwrap(api.deleteDocument(doc.id)).then(() => reload())}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">Contact details</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {field('fullName', 'Full name')}
              {field('email', 'Email')}
              {field('phone', 'Phone')}
              {field('location', 'Location')}
              {field('linkedinUrl', 'LinkedIn')}
              {field('githubUrl', 'GitHub')}
              {field('portfolioUrl', 'Portfolio')}
              {field('timezone', 'Timezone')}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="isNigerianCitizen">
                  Citizenship
                </label>
                <select
                  id="isNigerianCitizen"
                  className="input"
                  value={profile?.isNigerianCitizen ? 'true' : 'false'}
                  onChange={(event) =>
                    setProfile((current) =>
                      current ? { ...current, isNigerianCitizen: event.target.value === 'true' } : current,
                    )
                  }
                >
                  <option value="true">Nigerian citizen</option>
                  <option value="false">International / other</option>
                </select>
              </div>
              {field('workAuthorization', 'Work authorization')}
            </div>
            <div className="mt-3">
              <label className="label" htmlFor="summary">
                Professional summary
              </label>
              <textarea
                id="summary"
                className="input min-h-[110px]"
                value={profile?.summary ?? ''}
                onChange={(event) => setProfile((current) => (current ? { ...current, summary: event.target.value } : current))}
              />
            </div>
          </section>
        </div>

        <section className="panel h-fit p-5">
          <h2 className="mb-3 text-sm font-semibold text-white">Parsed intelligence</h2>
          <div className="mb-4">
            <div className="label">Skills &amp; tech stack ({profile?.skills.length ?? 0})</div>
            <div className="flex flex-wrap gap-1.5">
              {profile?.skills.length ? (
                profile.skills.map((skill) => (
                  <Badge key={skill} tone="accent">
                    {skill}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-slate-500">Upload a CV to extract skills.</span>
              )}
            </div>
          </div>

          <div className="mb-4">
            <div className="label">Projects ({profile?.projects.length ?? 0})</div>
            <div className="space-y-2">
              {profile?.projects.length ? (
                profile.projects.map((project) => (
                  <div key={project.name} className="rounded-lg bg-ink-950/50 px-3 py-2">
                    <div className="text-sm font-medium text-slate-200">{project.name}</div>
                    {project.detail ? <div className="mt-0.5 text-xs text-slate-400">{project.detail}</div> : null}
                  </div>
                ))
              ) : (
                <span className="text-sm text-slate-500">No projects detected yet.</span>
              )}
            </div>
          </div>

          <div>
            <div className="label">Languages</div>
            <div className="flex flex-wrap gap-1.5">
              {profile?.languages.length ? (
                profile.languages.map((language) => <Badge key={language}>{language}</Badge>)
              ) : (
                <span className="text-sm text-slate-500">—</span>
              )}
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-ink-700/70 bg-ink-950/40 p-3 text-xs text-slate-400">
            Parsed values only fill empty profile fields on first upload, so you never lose manual edits.
          </div>
        </section>
      </div>
    </div>
  );
}
