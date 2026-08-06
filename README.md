# Tender Download Automation (Phase 1)

Windows-based automation that downloads tender Excel files from configured sources using Node.js, TypeScript, and Playwright (Chromium).

**Phase 1 scope:** download Excel files and maintain logs only.  
ChatGPT qualification (when enabled) uses these final decision statuses:

`GO` · `CONDITIONAL_GO` · `PARTNER_BID` · `VERIFY` · `NO_GO`

Legacy statuses (`WILL_BID`, `NO_BID`, `PARTNERSHIP`, `MAY_BID`) are migrated
automatically on batch start and kept only for backward compatibility.

Not included yet: Excel processing, Supabase, merging, deduplication, or PQ/TQ evaluation.

## Web application (Siyana Tender Intelligence)

Internal Next.js app under `web/` for browsing tenders and qualifications.

```bat
npm --prefix web install
copy web\.env.example web\.env
REM Fill SUPABASE_URL + SUPABASE_SECRET_KEY, then apply migrations 003+004
npm --prefix web run create-admin
npm run web:dev
```

See [web/README.md](web/README.md) for auth model, roles, and production build.

## Sources

| Source     | Status                                      |
|------------|---------------------------------------------|
| Tender247  | Implemented (requires live auth verification) |
| BidAssist  | Placeholder — returns `BIDASSIST_NOT_CONFIGURED` |

---

## 1. Prerequisites

- Windows 10/11
- [Node.js](https://nodejs.org/) 18+ (LTS recommended)
- npm (comes with Node.js)
- Internet access
- A valid Tender247 account
- Computer powered on and online for scheduled runs

---

## 2. Installation

From the project root:

```bat
cd /d "C:\Users\goura\OneDrive\Desktop\tender-automation"
npm install
npm run setup
```

`npm run setup` installs Playwright Chromium.

---

## 3. Create `.env`

Copy the example file:

```bat
copy .env.example .env
```

Default values:

```env
HEADLESS=false
TENDER247_ENABLED=true
BIDASSIST_ENABLED=false
TENDER247_URL=https://www.tender247.com/auth/tender
DOWNLOAD_ROOT=./downloads
LOG_ROOT=./logs
SCREENSHOT_ROOT=./screenshots
DOWNLOAD_TIMEOUT_MS=120000
PAGE_TIMEOUT_MS=90000
MAX_RETRIES=2
TENDER_DETAIL_CONCURRENCY=2
TENDER_DETAIL_MAX_RETRIES=2
MAX_TENDERS=0
DOWNLOAD_ALL_DOCUMENTS_TOO=false
TENDER247_EMAIL=
TENDER247_PASSWORD=
```

Do not commit `.env`.

`TENDER247_EMAIL` and `TENDER247_PASSWORD` stay only in your local `.env`. They are used **only** when Tender247 shows the actual LOGIN modal (heading LOGIN + Email Id + Password + Submit) on a detail page. Prefer the saved Playwright session from `npm run auth:tender247` for normal runs. Never put credentials in source code or commit them.

---

## 4. Install Chromium

```bat
npm run setup
```

Equivalent to:

```bat
npx playwright install chromium
```

---

## 5. Save the Tender247 login session

Credentials are never stored in source code. Playwright saves a browser `storageState` file.

```bat
npm run auth:tender247
```

This will:

1. Open a visible Chromium window
2. Navigate to the Tender247 tender page
3. Let you log in manually
4. Wait for you to press Enter in the terminal
5. Save the session to `auth/tender247.json`

If `auth/tender247.json` is missing, downloads fail with `TENDER247_AUTH_NOT_FOUND`.

### Optional LOGIN modal fallback

If a tender detail page shows Tender247’s real **LOGIN** modal (not the public header “Log in” button), the crawler can fill it using:

```env
TENDER247_EMAIL=your@email.com
TENDER247_PASSWORD=your-password
```

Those values remain in local `.env` only. After a successful modal login, the crawler refreshes `auth/tender247.json` (and `auth/tender247-session.json` when used). OTP/CAPTCHA is never bypassed — the run fails with `TENDER247_MANUAL_LOGIN_REQUIRED` instead.

---

## 6. Test in visible browser mode

Ensure `.env` has:

```env
HEADLESS=false
```

Then:

```bat
npm run test:tender247
```

This runs only the Tender247 downloader with a visible browser.

---

## 7. Switch to headless mode

For scheduled / unattended runs, set in `.env`:

```env
HEADLESS=true
```

Then run:

```bat
npm run start
```

---

## 8. Run the downloader manually

```bat
npm run start
```

Behavior:

- Tender247 runs when `TENDER247_ENABLED=true`
- BidAssist stays skipped when `BIDASSIST_ENABLED=false` (default)
- Exit code `0` only when all **enabled** sources succeed
- Skipped sources do not fail the run

Example summary:

```text
Tender automation completed

Tender247: SUCCESS
File: downloads/2026-07-30/Tender247_2026-07-30.xlsx

BidAssist: SKIPPED
Reason: BIDASSIST_NOT_CONFIGURED
```

---

## 9. Windows Task Scheduler (7:00 AM)

Use `run-automation.bat`. It:

- Changes to the project directory via `%~dp0`
- Creates `logs` if missing
- Runs `npm run start`
- Appends stdout/stderr to `logs\scheduler.log`
- Preserves the process exit code

### Create the task

1. Open **Task Scheduler**
2. Create Task (not “Create Basic Task”)
3. **General**
   - Name: `Tender Automation Daily`
   - Select **Run whether user is logged on or not**
   - Check **Run with highest privileges**
   - Configure for: Windows 10/11
4. **Triggers**
   - New → Daily → Start at **7:00:00 AM**
   - Advanced: enable **Run task as soon as possible after a scheduled start is missed**
5. **Actions**
   - Start a program
   - Program/script:  
     `C:\Users\goura\OneDrive\Desktop\tender-automation\run-automation.bat`
   - Start in (optional):  
     `C:\Users\goura\OneDrive\Desktop\tender-automation`
6. **Conditions**
   - Optionally enable **Wake the computer to run this task**
   - Prefer running only if a network connection is available (if shown)
7. **Settings**
   - Allow task to be run on demand
   - **If the running task does not end when requested, force it to stop**
   - **Stop the task if it runs longer than:** `1 hour`
   - **If the task is already running:** **Do not start a new instance**
8. Save and enter Windows credentials when prompted

### Requirements

- Computer must be powered on (or wake-enabled) and connected to the internet
- Node.js must be on the PATH for the account that runs the task
- Tender247 auth session must be valid (`auth/tender247.json`)

---

## 10. Refresh login when the session expires

If the run fails with `TENDER247_LOGIN_REQUIRED` or the site redirects to login:

```bat
npm run auth:tender247
```

Log in again, press Enter, then re-test:

```bat
npm run test:tender247
```

---

## 11. Where files are saved

| Type        | Path example                                      |
|-------------|---------------------------------------------------|
| Downloads   | `downloads/YYYY-MM-DD/Tender247_YYYY-MM-DD.xlsx`  |
| Daily logs  | `logs/YYYY-MM-DD.log`                             |
| Scheduler   | `logs/scheduler.log`                              |
| Screenshots | `screenshots/YYYY-MM-DD/Tender247_<ERROR>_....png` |
| Auth state  | `auth/tender247.json`                             |
| Lock file   | `automation.lock` (removed when run finishes)     |

If the destination Excel already exists, a numbered copy is used:

- `Tender247_YYYY-MM-DD_2.xlsx`
- `Tender247_YYYY-MM-DD_3.xlsx`

---

## 12. How BidAssist will be added later

BidAssist is intentionally incomplete. The module returns:

```text
BIDASSIST_NOT_CONFIGURED
```

To add it later:

1. Provide the BidAssist URL
2. Provide screenshots of the click sequence
3. Capture authentication the same way (`auth/bidassist.json`)
4. Implement real locators in `src/sources/bidassist.ts`
5. Set `BIDASSIST_ENABLED=true` in `.env`

Do not invent fake selectors before the real UI flow is documented.

---

## Useful npm scripts

| Script                    | Purpose                                      |
|---------------------------|----------------------------------------------|
| `npm run setup`           | Install Playwright Chromium                  |
| `npm run auth:tender247`  | Save Tender247 login session                 |
| `npm run test:tender247`  | Run Tender247 only (visible if HEADLESS=false) |
| `npm run start`           | Run enabled sources                          |
| `npm run typecheck`       | Strict TypeScript check                      |

---

## Error codes (selected)

| Code                       | Meaning                                      |
|----------------------------|----------------------------------------------|
| `TENDER247_AUTH_NOT_FOUND` | Missing `auth/tender247.json`                |
| `TENDER247_LOGIN_REQUIRED` | Session expired / login page shown           |
| `DATE_FIELD_NOT_FOUND`     | Date-range control not found                 |
| `TODAY_OPTION_NOT_FOUND`   | “Today” shortcut not found                   |
| `SEARCH_BUTTON_NOT_FOUND`  | SEARCH button not found                      |
| `XLS_NOT_FOUND`            | XLS icon not found (debug dump + screenshot) |
| `DOWNLOAD_DID_NOT_START`   | No Playwright download event                 |
| `DOWNLOAD_FILE_EMPTY`      | Downloaded file is 0 bytes                   |
| `DUPLICATE_EXECUTION`      | Lock file present — another run is active    |
| `BROWSER_LAUNCH_FAILED`    | Chromium failed to launch                    |
| `TIMEOUT`                  | Page/download timeout                        |

On failure the runner captures a full-page screenshot, writes the error to the daily log, closes the browser, and exits non-zero.

---

## Daily tender pipeline

Run Tender247 crawl and ChatGPT qualification **sequentially** (never in parallel):

```bat
npm run daily:tender-pipeline
```

Phases:

1. Tender247 batch crawl (`batch:tender247`)
2. GPT readiness refresh (`gpt-readiness.json`) + settle delay
3. ChatGPT qualification for ready tenders only (`CHATGPT_PROCESS_READY_ONLY=true`)

If the crawl fails, ChatGPT does not start. If no new ready tenders remain,
ChatGPT is skipped and the pipeline exits successfully. A machine-readable
summary is written to `downloads/YYYY-MM-DD/daily-pipeline-summary.json`.

---

## Project structure

```text
tender-automation/
├── src/
│   ├── config.ts
│   ├── logger.ts
│   ├── dateUtils.ts
│   ├── fileUtils.ts
│   ├── browserUtils.ts
│   ├── run.ts
│   ├── setupTender247Auth.ts
│   └── sources/
│       ├── tender247.ts
│       └── bidassist.ts
├── auth/
├── downloads/
├── logs/
├── screenshots/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── run-automation.bat
└── README.md
```
# tender-automation
