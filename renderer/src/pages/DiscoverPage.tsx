import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Spinner, pushToast } from '../components/Toast';
import { api, unwrap } from '../lib/api';
import {
  DOMAIN_LABEL,
  REGION_LABEL,
  REGION_TONE,
  ROLE_LABEL,
  formatDate,
} from '../lib/format';
import type { JobDto, SearchReport } from '../../../shared/types';

const DEFAULT_KEYWORDS = 'frontend intern, software engineer intern, full stack intern, graduate software engineer';

export function DiscoverPage() {
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [report, setReport] = useState<SearchReport | null>(null);
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [customUrls, setCustomUrls] = useState('');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [domain, setDomain] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<JobDto | null>(null);
  const [applying, setApplying] = useState(false);
  const [headless, setHeadless] = useState(false);

  const reload = async () => {
    const next = await unwrap(api.listJobs({ status: 'ACTIVE' }));
    setJobs(next);
  };

  useEffect(() => {
    void reload()
      .catch((error) => pushToast('error', error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, []);

  const runSearch = async () => {
    setSearching(true);
    try {
      const result = await unwrap(
        api.searchJobs({
          keywords: keywords
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          customUrls: customUrls
            .split(/[\s,]+/)
            .map((item) => item.trim())
            .filter(Boolean),
          limitPerSource: 40,
          usePlaywrightScrapers: true,
        }),
      );
      setReport(result);
      await reload();
      pushToast('success', `Found ${result.fetched} eligible roles (${result.newJobs} new).`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (region && job.regionEligibility !== region) return false;
      if (domain && job.domain !== domain) return false;
      if (!needle) return true;
      return (
        job.company.toLowerCase().includes(needle) ||
        job.title.toLowerCase().includes(needle) ||
        job.techTags.join(' ').toLowerCase().includes(needle)
      );
    });
  }, [jobs, query, region, domain]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const approveAndApply = async () => {
    const ids = Array.from(selected);
    if (!ids.length) {
      pushToast('info', 'Select at least one listing first.');
      return;
    }
    setApplying(true);
    try {
      await unwrap(api.approveJobs(ids));
      const results = await unwrap(api.runApplications({ jobIds: ids, headless }));
      const okCount = results.filter((item) => item.ok).length;
      pushToast(
        okCount ? 'success' : 'error',
        `${okCount}/${results.length} applications submitted. Full log in Applications.`,
      );
      setSelected(new Set());
      await reload();
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setApplying(false);
    }
  };

  const hideJob = async (job: JobDto) => {
    await unwrap(api.updateJob(job.id, { status: 'HIDDEN' }));
    setJobs((current) => current.filter((item) => item.id !== job.id));
    if (preview?.id === job.id) setPreview(null);
    pushToast('info', `Removed "${job.title}" from the grid.`);
  };

  if (loading) {
    return (
      <div className="py-16">
        <Spinner label="Loading listings…" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Discover"
        subtitle="Jobicy · Remotive · Jooble · Greenhouse · Lever · Ashby · Workday — filtered for internship + fully remote + region eligibility."
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} />
              Headless browser
            </label>
            <button type="button" className="btn-primary" onClick={() => void runSearch()} disabled={searching}>
              {searching ? 'Searching…' : 'Run live search'}
            </button>
          </>
        }
      />

      <div className="panel mb-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[2fr_2fr_auto]">
          <div>
            <label className="label" htmlFor="keywords">
              Keywords (comma separated)
            </label>
            <input id="keywords" className="input" value={keywords} onChange={(event) => setKeywords(event.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="customUrls">
              Custom careers URLs (optional)
            </label>
            <input
              id="customUrls"
              className="input"
              placeholder="https://job-boards.greenhouse.io/example"
              value={customUrls}
              onChange={(event) => setCustomUrls(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <div className="text-xs text-slate-500">
              Strict gate: internship/junior + remote + non-restricted region
            </div>
          </div>
        </div>

        {report ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Badge tone="accent">{report.fetched} eligible</Badge>
            <Badge tone="ok">{report.newJobs} new</Badge>
            <Badge>{report.updatedJobs} refreshed</Badge>
            <Badge tone="bad">{report.rejected} filtered out</Badge>
            {report.perSource.map((source) => (
              <Badge key={source.source} tone={source.error ? 'bad' : 'muted'}>
                {source.source}: {source.accepted}/{source.fetched}
                {source.error ? ` (${source.error.slice(0, 40)})` : ''}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Filter company / title / stack…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="input max-w-[190px]" value={region} onChange={(event) => setRegion(event.target.value)}>
          <option value="">All regions</option>
          {Object.entries(REGION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select className="input max-w-[170px]" value={domain} onChange={(event) => setDomain(event.target.value)}>
          <option value="">All domains</option>
          {Object.entries(DOMAIN_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-500">{selected.size} selected</span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void approveAndApply()}
            disabled={applying || selected.size === 0}
          >
            {applying ? 'Applying…' : 'Approve & Trigger Auto-Apply'}
          </button>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-ink-700/70 bg-ink-950/60 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2.5">✓</th>
                <th className="px-3 py-2.5">Company / Role</th>
                <th className="px-3 py-2.5">Tech stack</th>
                <th className="px-3 py-2.5">Region</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Method</th>
                <th className="px-3 py-2.5">Salary</th>
                <th className="px-3 py-2.5">Score</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    No listings yet — run a live search above.
                  </td>
                </tr>
              ) : (
                filtered.map((job) => {
                  const tags = job.techTags;
                  return (
                    <tr key={job.id} className="border-b border-ink-800/70 align-top hover:bg-ink-850/40">
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={selected.has(job.id)} onChange={() => toggle(job.id)} />
                      </td>
                      <td className="max-w-[280px] px-3 py-3">
                        <button
                          type="button"
                          className="text-left"
                          onClick={() => setPreview(job)}
                        >
                          <div className="font-semibold text-white hover:text-pulse-300">{job.title}</div>
                          <div className="text-xs text-slate-400">
                            {job.company} · {job.location ?? 'Remote'}
                          </div>
                        </button>
                        {job.isApproved ? <Badge tone="ok">Approved</Badge> : null}
                      </td>
                      <td className="max-w-[240px] px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {tags.slice(0, 5).map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                          {tags.length > 5 ? <Badge>+{tags.length - 5}</Badge> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={REGION_TONE[job.regionEligibility] ?? 'muted'}>
                          {REGION_LABEL[job.regionEligibility] ?? job.regionEligibility}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-xs text-slate-300">{ROLE_LABEL[job.roleType] ?? job.roleType}</div>
                        <div className="text-[11px] text-slate-500">{DOMAIN_LABEL[job.domain] ?? job.domain}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={job.applyEmail && !job.applyUrl ? 'info' : 'accent'}>
                          {job.atsType === 'EMAIL' || (job.applyEmail && !job.applyUrl) ? 'Email' : job.atsType}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-300">{job.salary ?? '—'}</td>
                      <td className="px-3 py-3 font-mono text-xs text-pulse-300">{Math.round(job.matchedScore)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <button type="button" className="text-xs text-pulse-300 hover:underline" onClick={() => setPreview(job)}>
                            Preview
                          </button>
                          <button
                            type="button"
                            className="text-xs text-rose-400 hover:underline"
                            onClick={() => void hideJob(job)}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ''}
        subtitle={preview ? `${preview.company} · ${preview.source}` : ''}
        wide
        footer={
          preview ? (
            <div className="flex items-center justify-between gap-3">
              <button type="button" className="btn-danger" onClick={() => void hideJob(preview)}>
                Remove listing
              </button>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost" onClick={() => void api.openExternal(preview.url)}>
                  Open posting
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setSelected((current) => new Set(current).add(preview.id));
                    setPreview(null);
                  }}
                >
                  Select for auto-apply
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {preview ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={REGION_TONE[preview.regionEligibility] ?? 'muted'}>
                {REGION_LABEL[preview.regionEligibility]}
              </Badge>
              <Badge tone="accent">{ROLE_LABEL[preview.roleType]}</Badge>
              <Badge>{DOMAIN_LABEL[preview.domain]}</Badge>
              <Badge tone="info">{preview.atsType}</Badge>
              {preview.applyEmail ? <Badge tone="ok">{preview.applyEmail}</Badge> : null}
              <Badge>{formatDate(preview.publishedAt ?? preview.fetchedAt)}</Badge>
            </div>

            <div className="flex flex-wrap gap-1">
              {preview.techTags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>

            <div className="grid gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-lg bg-ink-950/50 p-3">
                <div className="text-slate-500">Region notes</div>
                <div className="mt-1 text-slate-300">{preview.regionNotes.join(' · ') || '—'}</div>
              </div>
              <div className="rounded-lg bg-ink-950/50 p-3">
                <div className="text-slate-500">Confidence</div>
                <div className="mt-1 text-slate-300">{Math.round(preview.regionConfidence * 100)}%</div>
              </div>
              <div className="rounded-lg bg-ink-950/50 p-3">
                <div className="text-slate-500">Apply via</div>
                <div className="mt-1 break-all text-slate-300">{preview.applyEmail ?? preview.applyUrl ?? preview.url}</div>
              </div>
            </div>

            <div>
              <div className="label">Full description</div>
              <pre className="max-h-[320px] whitespace-pre-wrap rounded-lg bg-ink-950/60 p-4 font-sans text-[13px] leading-relaxed text-slate-300">
                {preview.description || 'No description captured.'}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
