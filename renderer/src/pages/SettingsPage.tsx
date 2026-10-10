import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Spinner, pushToast } from '../components/Toast';
import { api, unwrap } from '../lib/api';
import type { SettingsDto } from '../../../shared/types';

interface FieldSpec {
  key: keyof SettingsDto;
  label: string;
  placeholder?: string;
  type?: string;
  hint?: string;
  group: string;
}

const FIELDS: FieldSpec[] = [
  { key: 'GEMINI_API_KEY', label: 'Gemini API key', group: 'AI engine', placeholder: 'AIza…', hint: 'Free tier: https://aistudio.google.com/apikey' },
  { key: 'GEMINI_MODEL', label: 'Gemini model', group: 'AI engine', placeholder: 'gemini-1.5-flash' },
  { key: 'JOOBLE_API_KEY', label: 'Jooble API key', group: 'Job sources', placeholder: 'Free developer key', hint: 'https://jooble.org/api' },
  { key: 'GREENHOUSE_BOARDS', label: 'Greenhouse boards', group: 'Job sources', placeholder: 'gitlab,doximity', hint: 'Comma separated board slugs' },
  { key: 'LEVER_COMPANIES', label: 'Lever companies', group: 'Job sources', placeholder: 'netflix,spotify' },
  { key: 'ASHBY_BOARDS', label: 'Ashby boards', group: 'Job sources', placeholder: 'stripe,linear' },
  { key: 'WORKDAY_TENANTS', label: 'Workday tenants', group: 'Job sources', placeholder: 'acme:External', hint: 'Format TENANT:SITE' },
  { key: 'SMTP_HOST', label: 'SMTP host', group: 'Email delivery', placeholder: 'smtp.mailgun.org' },
  { key: 'SMTP_PORT', label: 'SMTP port', group: 'Email delivery', placeholder: '587' },
  { key: 'SMTP_SECURE', label: 'SMTP secure (true/false)', group: 'Email delivery', placeholder: 'false' },
  { key: 'SMTP_USER', label: 'SMTP username', group: 'Email delivery' },
  { key: 'SMTP_PASS', label: 'SMTP password', group: 'Email delivery', type: 'password' },
  { key: 'SMTP_FROM', label: 'From address', group: 'Email delivery', placeholder: 'you@domain.com' },
  { key: 'MS_CLIENT_ID', label: 'Microsoft client ID', group: 'Outlook / Microsoft Graph', placeholder: 'Azure app (public client) ID' },
  { key: 'MS_TENANT_ID', label: 'Microsoft tenant ID', group: 'Outlook / Microsoft Graph', placeholder: 'common' },
  { key: 'MS_SCOPES', label: 'Graph scopes', group: 'Outlook / Microsoft Graph', placeholder: 'User.Read,Mail.Read,Mail.Send' },
  { key: 'AUTOMATION_HEADLESS', label: 'Headless automation (true/false)', group: 'Automation', placeholder: 'false' },
  { key: 'APPLY_DELAY_MS', label: 'Delay between applications (ms)', group: 'Automation', placeholder: '8000' },
  { key: 'OUTLOOK_SYNC_INTERVAL_MS', label: 'Outlook sync interval (ms, 0 = off)', group: 'Automation', placeholder: '300000' },
];

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void unwrap(api.getSettings()).then(setSettings);
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await unwrap(api.setSettings(settings as unknown as Record<string, string>));
      pushToast('success', 'Settings persisted to the local database.');
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const testGemini = async () => {
    setTesting(true);
    try {
      const result = await unwrap(api.testGemini());
      pushToast(result.ok ? 'success' : 'error', `Gemini: ${result.detail}`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  if (!settings) {
    return (
      <div className="py-16">
        <Spinner label="Loading settings…" />
      </div>
    );
  }

  const groups = Array.from(new Set(FIELDS.map((field) => field.group)));

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Values are stored in the local SQLite database and override the .env defaults."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => void testGemini()} disabled={testing}>
              {testing ? 'Testing…' : 'Test Gemini'}
            </button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((group) => (
          <section key={group} className="panel p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">{group}</h2>
            <div className="space-y-3">
              {FIELDS.filter((field) => field.group === group).map((field) => (
                <div key={field.key}>
                  <label className="label" htmlFor={field.key}>
                    {field.label}
                  </label>
                  <input
                    id={field.key}
                    className="input"
                    type={field.type ?? 'text'}
                    placeholder={field.placeholder ?? ''}
                    value={settings[field.key] ?? ''}
                    onChange={(event) => setSettings({ ...settings, [field.key]: event.target.value })}
                  />
                  {field.hint ? <p className="mt-1 text-[11px] text-slate-500">{field.hint}</p> : null}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="panel mt-5 p-5 text-xs leading-relaxed text-slate-400">
        <h3 className="mb-2 text-sm font-semibold text-white">Microsoft Outlook setup</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Create an app registration at portal.azure.com → App registrations → New registration.</li>
          <li>Set “Supported account types” to “Accounts in any organizational directory and personal Microsoft accounts”.</li>
          <li>Under Authentication → Advanced settings, enable “Allow public client flows”.</li>
          <li>Add API permissions (delegated): User.Read, Mail.Read, Mail.Send.</li>
          <li>Paste the Application (client) ID above, save, then use “Connect Outlook” on the Applications page (device-code flow).</li>
        </ol>
      </div>
    </div>
  );
}
