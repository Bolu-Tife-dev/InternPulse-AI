import { useEffect, useState, type ReactNode } from 'react';

export interface ToastMessage {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}

let listener: ((toast: ToastMessage) => void) | null = null;
let nextId = 1;

export function pushToast(tone: ToastMessage['tone'], text: string): void {
  listener?.({ id: nextId++, tone, text });
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listener = (toast) => {
      setToasts((current) => [...current, toast]);
      setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, 5200);
    };
    return () => {
      listener = null;
    };
  }, []);

  const tones: Record<ToastMessage['tone'], string> = {
    success: 'border-emerald-600/60 bg-emerald-950/90 text-emerald-200',
    error: 'border-rose-600/60 bg-rose-950/90 text-rose-200',
    info: 'border-pulse-500/60 bg-ink-900/95 text-pulse-200',
  };

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[380px] flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className={`rounded-lg border px-4 py-3 text-sm shadow-panel ${tones[toast.tone]}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }): ReactNode {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-pulse-500 border-t-transparent" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}
