import { useEffect, useState, type ReactNode } from 'react';
import { unwrap, api } from '../lib/api';

export type PageKey = 'dashboard' | 'profile' | 'discover' | 'applications' | 'settings';

const NAV: Array<{ key: PageKey; label: string; hint: string }> = [
  { key: 'dashboard', label: 'Dashboard', hint: 'Overview' },
  { key: 'discover', label: 'Discover', hint: 'Live job search' },
  { key: 'applications', label: 'Applications', hint: 'Tracker & email sync' },
  { key: 'profile', label: 'Profile & CV', hint: 'Documents & parsing' },
  { key: 'settings', label: 'Settings', hint: 'Keys, mail, OAuth' },
];

export function Layout({
  page,
  onNavigate,
  children,
}: {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  children: ReactNode;
}) {
  const [stats, setStats] = useState<{ activeJobs: number; applications: number } | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const value = await unwrap(api.getStats());
        setStats({ activeJobs: value.activeJobs, applications: value.applications });
      } catch {
        setStats(null);
      }
      try {
        const info = await unwrap(api.versions());
        setVersion(`v${info.appVersion} · Electron ${info.electron}`);
      } catch {
        setVersion('');
      }
    })();
  }, [page]);

  return (
    <div className="flex h-full">
      <aside className="flex w-[236px] shrink-0 flex-col border-r border-ink-700/70 bg-ink-900/70">
        <div className="border-b border-ink-700/70 px-5 py-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-pulse-500 to-indigo-600 text-sm font-black text-white">
              IP
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">InternPulse AI</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Remote internship OS</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
            const active = item.key === page;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                className={`flex w-full flex-col items-start rounded-lg px-3 py-2.5 text-left transition ${
                  active
                    ? 'bg-pulse-600/15 text-pulse-300 ring-1 ring-pulse-500/40'
                    : 'text-slate-400 hover:bg-ink-850 hover:text-slate-200'
                }`}
              >
                <span className="text-[13px] font-semibold">{item.label}</span>
                <span className="text-[10px] text-slate-500">{item.hint}</span>
              </button>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-ink-700/70 px-5 py-4 text-[11px] text-slate-500">
          {stats ? (
            <div className="mb-2 rounded-lg bg-ink-950/60 px-3 py-2">
              <div>{stats.activeJobs} live listings</div>
              <div>{stats.applications} applications sent</div>
            </div>
          ) : null}
          <div>{version}</div>
          <div>Local SQLite · No cloud lock-in</div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
