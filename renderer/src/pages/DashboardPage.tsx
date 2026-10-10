import { useEffect, useState } from 'react';
import { PageHeader, type PageKey } from '../components/Layout';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Toast';
import { api, unwrap } from '../lib/api';
import { formatDate } from '../lib/format';
import type { DashboardStats } from '../../../shared/types';
import type { SyncRunDto } from '../../../shared/api';

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="panel px-4 py-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent ? 'text-pulse-300' : 'text-white'}`}>{value}</div>
    </div>
  );
}

export function DashboardPage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [runs, setRuns] = useState<SyncRunDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [nextStats, nextRuns] = await Promise.all([unwrap(api.getStats()), unwrap(api.getSyncRuns())]);
        setStats(nextStats);
        setRuns(nextRuns);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="py-16">
        <Spinner label="Loading workspace…" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live pipeline health — every number below comes from your local database."
      />

      {stats && !stats.profileComplete ? (
        <div className="mb-5 rounded-xl border border-amber-600/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Your candidate profile is incomplete. Upload a CV so auto-apply can fill forms with real data.{' '}
          <button type="button" className="font-semibold underline" onClick={() => onNavigate('profile')}>
            Open Profile
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live listings" value={stats?.activeJobs ?? 0} accent />
        <StatCard label="Approved for apply" value={stats?.approvedJobs ?? 0} />
        <StatCard label="Applications sent" value={stats?.applications ?? 0} />
        <StatCard label="Positive responses" value={stats?.responses ?? 0} />
        <StatCard label="Interviews" value={stats?.interviews ?? 0} />
        <StatCard label="Rejections" value={stats?.rejections ?? 0} />
        <StatCard label="Last sync" value={stats?.lastSyncAt ? formatDate(stats.lastSyncAt) : 'never'} />
        <StatCard label="Profile" value={stats?.profileComplete ? 'Ready' : 'Incomplete'} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <h2 className="mb-3 text-sm font-semibold text-white">Quick start</h2>
          <ol className="space-y-2 text-sm text-slate-300">
            <li>1. Upload your CV (PDF/DOCX) — skills and contact details are parsed locally.</li>
            <li>2. Add API keys in Settings (Gemini, Jooble, SMTP, Microsoft client ID).</li>
            <li>3. Run a search on Discover — sources are filtered for internship + remote + region eligibility.</li>
            <li>4. Inspect each listing, then hit Approve &amp; Trigger Auto-Apply.</li>
            <li>5. Sync Outlook to auto-tag acknowledgements, assessments, interviews and rejections.</li>
          </ol>
        </div>

        <div className="panel p-5">
          <h2 className="mb-3 text-sm font-semibold text-white">Recent sync runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No sync runs yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.slice(0, 8).map((run) => (
                <div key={run.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-950/50 px-3 py-2 text-xs">
                  <div>
                    <span className="font-semibold text-slate-200">{run.kind}</span>
                    <span className="ml-2 text-slate-500">{formatDate(run.startedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">
                      {run.found} found / {run.created} new
                    </span>
                    <Badge tone={run.status === 'SUCCESS' ? 'ok' : run.status === 'FAILED' ? 'bad' : 'warn'}>
                      {run.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
