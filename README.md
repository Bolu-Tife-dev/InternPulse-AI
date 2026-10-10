# InternPulse AI

**Localized, automated remote software-engineering internship discovery, tailored auto-apply, and application tracking — for Nigerian citizens and global remote developers.**

InternPulse AI is a production desktop application (Electron + React + TypeScript + Tailwind) with a complete local backend: SQLite via Prisma, live job scraping, local PDF/DOCX parsing, Playwright form automation, Gmail-free SMTP / Microsoft Graph email delivery, Google Gemini cover-letter tuning, and Outlook inbox synchronisation that auto-classifies employer replies.

No mock data. No hardcoded job arrays. Every listing, application, and email row in the UI comes from live sources and is persisted in your local database.

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Database & migrations](#database--migrations)
- [Running in development](#running-in-development)
- [Building installers](#building-installers)
- [Downloading the app](#downloading-the-app)
- [How the auto-apply engine works](#how-the-auto-apply-engine-works)
- [Outlook / Microsoft Graph sync](#outlook--microsoft-graph-sync)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

### 1. Document management & profile engine
- Upload CV/Resume and base cover letters (`.pdf`, `.docx`).
- Text is parsed **on-device** with `pdf-parse` and `mammoth`.
- A local extractor pulls email, phone, LinkedIn, GitHub, portfolio, location, headline, summary, years of experience, skills (300+ term lexicon), projects, and languages into SQLite.
- Parsed values only fill *empty* profile fields — manual edits are never overwritten. Every field stays editable in the UI.

### 2. Free job scraping & search engine
Live, free sources (no paid job APIs):

| Source | Mechanism |
| --- | --- |
| Jobicy | `https://jobicy.com/api/v2/remote-jobs` |
| Remotive | `https://remotive.com/api/remote-jobs` |
| Jooble | `https://jooble.org/api/<key>` (free developer key) |
| Greenhouse | `boards-api.greenhouse.io` (two-phase: light listing → full content for intern matches) |
| Lever | `api.lever.co/v0/postings/<company>` |
| Ashby | `api.ashbyhq.com/posting-api/job-board/<board>` |
| Workday | `*.wd5.myworkdayjobs.com/wday/cxs/...` search feed |
| Custom ATS pages | Targeted **Playwright** scrapers (Greenhouse / Lever / Ashby / Workday / generic careers pages), incl. Ashby `__NEXT_DATA__` extraction |

**Strict matching rules (all must pass):**

- **Role type** — Internship, graduate trainee, junior/entry-level, co-op, new grad.
- **Domain** — Frontend, full-stack, backend, web, software/ML/data engineering (non-tech titles such as sales, HR, marketing, design, PM are rejected).
- **Remote policy** — explicit remote / WFH / worldwide signals; in-office and hybrid roles are rejected.
- **Region eligibility** — the description and location are classified as `WORLDWIDE`, `AFRICA_EMEA`, `NIGERIA_EXPLICIT`, `RESTRICTED`, or `UNKNOWN`. Roles restricted to US/EU/UK tax residency (or "remote within the US") are excluded unless Nigerian/global remote contractors are explicitly welcomed.

Everything that passes is upserted into SQLite (`source + sourceId` unique key ⇒ re-running a search refreshes, never duplicates).

### 3. Interactive preview, filtering & approval dashboard
- Data grid: company, title, tech-stack tags, salary/stipend, regional eligibility, application method (ATS form vs. email), and match score.
- Full-description preview modal with eligibility notes and confidence.
- Filter/search by company, title, stack, region, domain.
- Soft-delete (`HIDDEN`) any incorrect or undesired listing.
- Single **Approve & Trigger Auto-Apply** button for the selected rows.

### 4. Automated application engine
- **Web forms** — a Playwright agent drives Greenhouse, Lever, Ashby, BambooHR and Workday application forms: name/email/phone/LinkedIn/GitHub/portfolio, select dropdowns (location), CV upload, and free-text custom questions. ATS-specific field IDs are used first, with label/name/placeholder heuristics as fallback. Confirmation text, confirmation numbers and screenshots are captured.
- **Email** — when a posting specifies an email application, a personalised email (subject, body, attached CV) is sent over SMTP (any provider) or Microsoft Graph `/me/sendMail`.
- **AI customisation** — Google Gemini (default `gemini-1.5-flash`, overridable) tailors the cover letter and answers form questions using the job description + your profile, with a deterministic fallback to your stored cover letter if the API is unavailable.
- **Rate limiting** — configurable delay between applications (default 8 s), optional visible/headless browser.

### 5. Applied jobs tracker & Outlook integration
- Tracker grid: company, role, applied date, strategy (FORM/EMAIL), status (`Applied`, `Screening`, `Interview`, `Offer`, `Rejected`, …) with manual override.
- Microsoft OAuth 2.0 **device-code flow** (`@azure/msal-node`) with `User.Read`, `Mail.Read`, `Mail.Send`; token cache persisted locally.
- Periodic (configurable) inbox scan matches messages against companies/titles in the `Application` table.
- Zero-cost rule-based classification tags each reply: **Application Acknowledged**, **Assessment Sent**, **Interview Requested**, **Rejection Notice**, **Offer** — with sentiment and confidence. Statuses are promoted automatically (e.g. interview mail ⇒ `INTERVIEW`).
- The email timeline appears in the job detail modal.

---

## Architecture

```
┌──────────────────────────── Electron main ────────────────────────────┐
│  ipc/ (typed IPC handlers)        services/                           │
│   ├─ documents (upload/parse)      ├─ documentStore (pdf-parse/mammoth)│
│   ├─ jobs (search/list/approve)    ├─ profileExtractor + skillLexicon  │
│   ├─ applications (auto-apply)     ├─ matcher (role/domain/region)     │
│   ├─ outlook (OAuth + sync)        ├─ scrape/* (Jobicy, Remotive,      │
│   ├─ settings / stats / ai           Jooble, Greenhouse, Lever, Ashby, │
│   └─ scheduler (periodic sync)       Workday, Playwright ATS crawlers) │
│                                    ├─ apply/formAgent (Playwright)     │
│                                    ├─ apply/emailAgent (SMTP/Graph)    │
│                                    ├─ gemini (cover letters/answers)   │
│                                    └─ outlook (MSAL + Graph)           │
│  Prisma Client → SQLite (userData/internpulse/internpulse.db)          │
└───────────────────────────────▲───────────────────────────────────────┘
                                │ contextBridge (window.internpulse)
┌───────────────────────────────┴───────────────────────────────────────┐
│  Renderer: React 19 + TypeScript + Tailwind (Vite)                     │
│  Dashboard · Discover (grid + preview + approve) · Applications        │
│  Profile & CV · Settings                                               │
└───────────────────────────────────────────────────────────────────────┘
```

- **Renderer security**: `contextIsolation: true`, `nodeIntegration: false`, allow-listed IPC channels only.
- **Main process** is compiled with `tsc` (CommonJS) so native/prebuilt binaries (`@prisma/client`, `playwright`, `mammoth`, `nodemailer`) resolve normally at runtime — no bundler surprises.
- **Renderer** is bundled by Vite; the typed `InternPulseApi` contract lives in `shared/api.ts` and is enforced on both sides.

## Prerequisites

- Node.js **20+** (Electron 33 / electron-builder 26 verified on Node 20 and 22)
- npm 10+
- Windows 10/11, macOS 12+, or Linux (builds for all three)
- Git (optional, for cloning)

## Setup

```bash
git clone https://github.com/Bolu-Tife-dev/InternPulse-AI.git
cd InternPulse-AI

npm install              # also runs `prisma generate` via postinstall
copy .env.example .env   # Windows (use cp .env.example .env on macOS/Linux)
npm run playwright:install   # downloads Chromium used by the automation agents
npm run prisma:migrate       # creates/updates the local SQLite database
```

Then fill in `.env` (or, better, set values in **Settings** inside the app — DB values override `.env`).

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | auto | SQLite URL; the app overrides it with `userData/internpulse/internpulse.db` at runtime |
| `GEMINI_API_KEY` | recommended | Google AI Studio key (free tier) for cover letters & answers |
| `GEMINI_MODEL` | optional | default `gemini-1.5-flash` (auto-falls back to `gemini-2.0-flash`/`gemini-2.5-flash`) |
| `JOOBLE_API_KEY` | optional | free key from https://jooble.org/api |
| `GREENHOUSE_BOARDS` | optional | comma list, e.g. `gitlab,stripe` — replaces the curated default board list |
| `LEVER_COMPANIES` | optional | comma list, e.g. `palantir` |
| `ASHBY_BOARDS` | optional | comma list, e.g. `notion,perplexity` |
| `WORKDAY_TENANTS` | optional | comma list of `TENANT:SITE`, e.g. `acme:External` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | for email apply | any SMTP provider (Gmail app password, Mailgun, SES, …) |
| `MS_CLIENT_ID` | for Outlook | Azure app (public client) ID |
| `MS_TENANT_ID` | optional | default `common` |
| `MS_SCOPES` | optional | default `User.Read,Mail.Read,Mail.Send` |
| `AUTOMATION_HEADLESS` | optional | `false` shows the browser while filling forms |
| `APPLY_DELAY_MS` | optional | default `8000` between applications |
| `OUTLOOK_SYNC_INTERVAL_MS` | optional | default `300000`; `0` disables the scheduler |

> If the ATS board lists are left empty, the app ships with a curated set of public boards that actively hire interns/new-grads worldwide (Stripe, Robinhood, Databricks, Affirm, Datadog, Anthropic, Figma, Scale AI, Cloudflare, Samsara, MongoDB, Twilio, Vercel, GitLab, Canonical + Lever/Palantir + Ashby/Notion, Perplexity, OpenAI, Ramp). Supplying your own list replaces the defaults entirely.

## Database & migrations

- Prisma schema: `prisma/schema.prisma` (SQLite).
- Migrations: `prisma/migrations/*/migration.sql`, committed to git.
- On first launch the app **applies pending migrations itself** (it replays the committed SQL files and records them in `_applied_migrations`), so end users never need the Prisma CLI.
- Developer commands:

```bash
npm run prisma:migrate   # create/apply a new migration (dev)
npm run prisma:deploy    # apply committed migrations (prod)
npm run prisma:studio    # browse the local DB
```

## Running in development

```bash
npm run dev
```

This runs Vite (renderer HMR on `127.0.0.1:5173`), a `tsc --watch` for the main process, and launches Electron against the dev server.

```bash
npm run build        # production build (renderer + main)
npm start            # run the built app without packaging
npm run typecheck    # strict TS for both projects
npm run smoke        # headless end-to-end check of parser/matcher/scrapers/DB
```

## Building installers

```bash
npm run dist:win     # → release/internpulse-ai-<v>-win-x64-setup.exe   (NSIS)
npm run dist:mac     # → release/internpulse-ai-<v>-mac-{x64,arm64}.dmg
npm run dist:linux   # → release/internpulse-ai-<v>-linux-x86_64.{AppImage,deb}
```

macOS builds require a Mac; Linux targets can be produced on any OS. The
recommended path is the **Release CI workflow**
(`.github/workflows/release.yml`): pushing a version tag builds all three
platforms on GitHub-hosted runners and attaches the installers to the
matching GitHub release.

Configuration lives in `electron-builder.yml` (asar enabled; Prisma engines, Playwright, pdf-parse, mammoth and MSAL are `asarUnpack`ed; `npmRebuild` is disabled because no native ABI rebuild is required).

### Code signing

Installers are unsigned until a certificate is configured. See
[docs/CODE_SIGNING.md](docs/CODE_SIGNING.md) for the Windows (Azure Trusted
Signing or PFX) and macOS signing setup — the CI workflow signs
automatically once the `WIN_CSC_LINK`/`WIN_CSC_PASSWORD` (or Apple)
secrets are set.

## Downloading the app

Pre-built installers are published on the **GitHub Releases** page of the landing-page repository and linked from https://intern-pulse-ai.vercel.app:

- **All releases**: https://github.com/Bolu-Tife-dev/InternPulse-AI-Website/releases/latest
- **v1.0.1**: `internpulse-ai-1.0.1-win-x64-setup.exe`,
  `internpulse-ai-1.0.1-mac-{x64,arm64}.dmg`,
  `internpulse-ai-1.0.1-linux-x86_64.{AppImage,deb}` (built by CI on tag push)

> **Windows**: the installer is not code-signed yet — SmartScreen may warn on first run; choose “More info → Run anyway”. **macOS**: the DMG is unsigned — right-click → Open on first launch. **Linux**: `chmod +x` the AppImage before running.

## How the auto-apply engine works

1. You select listings on **Discover** → *Approve & Trigger Auto-Apply*.
2. For each job the engine:
   - loads your profile and latest CV/cover letter,
   - asks Gemini for a tailored cover letter (falls back to your stored letter),
   - picks a strategy: `FORM` for Greenhouse/Lever/Ashby/BambooHR/Workday, `EMAIL` when an application address is present,
   - **FORM**: launches Chromium, opens the posting, clicks *Apply*, fills known ATS fields, uploads your CV, answers free-text questions with Gemini (≤ 8 questions), submits, then captures a screenshot and any confirmation reference,
   - **EMAIL**: sends the letter + CV attachment via SMTP, or via Microsoft Graph when SMTP is not configured,
   - writes an `Application` row (status, strategy, cover letter, answers, confirmation, screenshot path) and marks the job approved,
   - waits `APPLY_DELAY_MS` before the next job.
3. Any failure is recorded with the error detail and screenshot so you can finish it manually.

## Outlook / Microsoft Graph sync

1. In Azure Portal → App registrations → new registration (public client), enable **Allow public client flows**, add delegated permissions `User.Read`, `Mail.Read`, `Mail.Send`.
2. Paste the client ID in **Settings** → save.
3. **Applications → Connect Outlook** — a device-code + URL is shown; complete it in any browser.
4. **Sync inbox now** (or wait for the scheduler) to classify replies and promote application statuses.

## Testing

```bash
npm run smoke
```

`scripts/smoke-test.js` runs against the **real compiled services**: it bootstraps SQLite from the committed migrations, verifies CV parsing (contact/skills/projects), asserts region & role eligibility rules (worldwide accepted, US-only rejected, senior roles rejected, Nigeria/contractor signals accepted), performs a **live search** against Jobicy/Remotive/Jooble/ATS boards, persists results, and proves the upsert is idempotent.

## Project structure

```
electron/                 main process (tsc → dist/main)
  main.ts                 app lifecycle, window, scheduler
  preload.ts              contextBridge API (window.internpulse)
  ipc/index.ts            typed IPC handlers
  db.ts                   Prisma client + migration bootstrap + settings
  paths.ts / env.ts       runtime paths, .env loader, file logger
  services/
    profileExtractor.ts   contact/skills/projects extraction
    skillLexicon.ts       300+ term tech lexicon + normalisation
    matcher.ts            role/domain/remote/region eligibility engine
    documentStore.ts      pdf-parse / mammoth parsing + storage
    gemini.ts             cover letters, question answers, summaries
    outlook.ts            MSAL device-code auth, Graph mail sync, classifiers
    scheduler.ts          periodic Outlook sync
    scrape/               jobicy, remotive, jooble, atsFeeds, atsPlaywright
    apply/                formAgent (Playwright), emailAgent (SMTP/Graph), orchestrator
shared/                   DTO contract shared by main + renderer
renderer/                 React 19 + Tailwind UI (Vite)
prisma/                   schema + committed migrations
scripts/smoke-test.js     headless end-to-end verification
electron-builder.yml      packaging (NSIS / DMG / AppImage)
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Prisma Client could not locate the Query Engine` after packaging | engines are `asarUnpack`ed in `electron-builder.yml`; rebuild with `npm run dist:win` after changing it |
| `Playwright browser not found` | run `npm run playwright:install` on the machine that runs the app |
| No jobs found | add a Jooble key, add ATS boards in Settings, or run a search later — boards post interns in cycles; check the per-source chips on Discover for HTTP errors |
| Gemini errors | verify `GEMINI_API_KEY`; the app automatically falls back to newer model IDs and, failing that, your stored cover letter |
| Email apply fails | configure SMTP (host/port/user/pass) or sign in to Outlook; the failure detail is stored on the Application row |
| Outlook shows nothing | employer replies must arrive in the connected mailbox; matching uses company name + ≥ 2 title tokens |

## License

MIT — see [LICENSE](LICENSE).
