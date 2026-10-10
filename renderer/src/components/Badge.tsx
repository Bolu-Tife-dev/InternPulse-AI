import type { ReactNode } from 'react';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'accent';

const TONES: Record<Tone, string> = {
  ok: 'border-emerald-600/50 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-600/50 bg-amber-500/10 text-amber-300',
  bad: 'border-rose-600/50 bg-rose-500/10 text-rose-300',
  info: 'border-sky-600/50 bg-sky-500/10 text-sky-300',
  muted: 'border-ink-600 bg-ink-850 text-slate-400',
  accent: 'border-pulse-500/50 bg-pulse-500/10 text-pulse-300',
};

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
