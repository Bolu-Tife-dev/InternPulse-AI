import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Spinner, pushToast } from '../components/Toast';
import { api, unwrap } from '../lib/api';
import {
  CLASSIFICATION_LABEL,
  STATUS_LABEL,
  formatDate,
} from '../lib/format';
import type { ApplicationDto, OutlookAccountDto } from '../../../shared/types';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'accent'> = {
  APPLIED: 'info',
  SCREENING: 'warn',
  INTERVIEW: 'accent',
  OFFER: 'ok',
  REJECTED: 'bad',
  WITHDRAWN: 'muted',
  FAILED: 'bad',
};

export function ApplicationsPage() {
  const [applications, setApplications] = useState<ApplicationDto[]>([]);
  const [account, setAccount] = useState<OutlookAccountDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApplicationDto | null>(null);

  const reload = async () => {
    const [nextApps, nextAccount] = await Promise.all([
      unwrap(api.listApplications()),
      unwrap(api.outlookAccount()),
    ]);
    setApplications(nextApps);
    setAccount(nextAccount);
  };

  useEffect(() => {
    const off = api.onOutlookDeviceCode((message) => setDeviceMessage(String(message)));
    void reload()
      .catch((error) => pushToast('error', error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
    return off;
  }, []);

  const signIn = async () => {
    setBusy('signin');
    try {
      await unwrap(api.outlookSignIn());
      setDeviceMessage(null);
      pushToast('success', 'Outlook connected. Mail.Read enabled.');
      await reload();
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      const summary = await unwrap(api.outlookSync());
      pushToast('success', `Scanned ${summary.scanned} mails · matched ${summary.matched} · tagged ${summary.tagged}.`);
      await reload();
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16">
        <Spinner label="Loading applications…" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Applications"
        subtitle="Every submission is logged with strategy, confirmation reference and the Outlook reply timeline."
        actions={
          account?.signedIn ? (
            <>
              <Badge tone="ok">{account.userPrincipalName ?? 'Connected'}</Badge>
              <button type="button" className="btn-ghost" onClick={() => void sync()} disabled={busy === 'sync'}>
                {busy === 'sync' ? 'Syncing…' : 'Sync inbox now'}
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => void unwrap(api.outlookSignOut()).then(reload)}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={() => void signIn()} disabled={busy === 'signin'}>
              {busy === 'signin' ? 'Waiting for device code…' : 'Connect Outlook'}
            </button>
          )
        }
      />

      {deviceMessage ? (
        <div className="mb-4 rounded-xl border border-pulse-500/40 bg-pulse-500/10 px-4 py-3 text-sm text-pulse-200">
          <div className="font-semibold">Microsoft sign-in</div>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed">{deviceMessage}</pre>
        </div>
      ) : null}

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-ink-700/70 bg-ink-950/60 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Company</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Applied</th>
                <th className="px-3 py-2.5">Strategy</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Email timeline</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {applications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    No applications yet. Approve listings on the Discover page to trigger auto-apply.
                  </td>
                </tr>
              ) : (
                applications.map((application) => (
                  <tr key={application.id} className="border-b border-ink-800/70 align-top hover:bg-ink-850/40">
                    <td className="px-3 py-3 font-semibold text-white">{application.job.company}</td>
                    <td className="max-w-[240px] px-3 py-3 text-slate-300">{application.job.title}</td>
                    <td className="px-3 py-3 text-xs text-slate-400">{formatDate(application.submittedAt ?? application.createdAt)}</td>
                    <td className="px-3 py-3">
                      <Badge tone={application.strategy === 'FORM' ? 'accent' : 'info'}>{application.strategy}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        className="input py-1 text-xs"
                        value={application.status}
                        onChange={(event) => {
                          const status = event.target.value;
                          void unwrap(api.updateApplicationStatus(application.id, status)).then(() => {
                            setApplications((current) =>
                              current.map((item) => (item.id === application.id ? { ...item, status: status as ApplicationDto['status'] } : item)),
                            );
                          });
                        }}
                      >
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1">
                        <Badge tone={STATUS_TONE[application.status] ?? 'muted'}>{STATUS_LABEL[application.status] ?? application.status}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {application.emails.length === 0 ? (
                        <span className="text-xs text-slate-500">—</span>
                      ) : (
                        <div className="space-y-1">
                          {application.emails.slice(0, 2).map((email) => (
                            <div key={email.id} className="text-[11px]">
                              <Badge tone={email.sentiment === 'NEGATIVE' ? 'bad' : email.sentiment === 'POSITIVE' ? 'ok' : 'muted'}>
                                {CLASSIFICATION_LABEL[email.classification] ?? email.classification}
                              </Badge>
                              <div className="mt-0.5 truncate text-slate-400">{email.subject}</div>
                            </div>
                          ))}
                          {application.emails.length > 2 ? (
                            <div className="text-[11px] text-slate-500">+{application.emails.length - 2} more</div>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <button type="button" className="text-xs text-pulse-300 hover:underline" onClick={() => setDetail(application)}>
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.job.company} — ${detail.job.title}` : ''}
        subtitle={detail ? `Strategy ${detail.strategy} · ${STATUS_LABEL[detail.status]}` : ''}
        wide
        footer={
          detail ? (
            <button type="button" className="btn-ghost" onClick={() => void api.openExternal(detail.job.url)}>
              Open original posting
            </button>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-4">
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-lg bg-ink-950/50 p-3">
                <div className="text-slate-500">Confirmation</div>
                <div className="mt-1 break-all text-slate-200">{detail.confirmationRef ?? '—'}</div>
              </div>
              <div className="rounded-lg bg-ink-950/50 p-3">
                <div className="text-slate-500">Engine detail</div>
                <div className="mt-1 text-slate-200">{detail.statusDetail ?? '—'}</div>
              </div>
            </div>

            <div>
              <div className="label">Tailored cover letter (Gemini)</div>
              <pre className="max-h-[260px] whitespace-pre-wrap rounded-lg bg-ink-950/60 p-4 font-sans text-[13px] leading-relaxed text-slate-300">
                {detail.coverLetter ?? '—'}
              </pre>
            </div>

            <div>
              <div className="label">Outlook reply timeline</div>
              {detail.emails.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No matching inbox messages yet. Connect Outlook and run a sync to auto-classify replies.
                </p>
              ) : (
                <ol className="space-y-2">
                  {detail.emails.map((email) => (
                    <li key={email.id} className="rounded-lg bg-ink-950/50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <Badge tone={email.sentiment === 'NEGATIVE' ? 'bad' : email.sentiment === 'POSITIVE' ? 'ok' : 'muted'}>
                          {CLASSIFICATION_LABEL[email.classification] ?? email.classification}
                        </Badge>
                        <span className="text-[11px] text-slate-500">{formatDate(email.receivedAt)}</span>
                      </div>
                      <div className="mt-1 text-sm text-slate-200">{email.subject}</div>
                      <div className="text-xs text-slate-500">{email.sender}</div>
                      <div className="mt-1 text-xs text-slate-400">{email.bodyPreview}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
