# Siyana Tender Intelligence (STI)

Premium internal web application for tender discovery, qualification review, and bid intelligence. Reads existing Tender247 / BidAssist crawler data and ChatGPT qualification results from Supabase.

## Architecture

- **Next.js App Router** (TypeScript strict) under `web/`
- **Custom auth** (not Supabase Auth): `agenttender_users` + hashed sessions
- **Server-only** Supabase service role via `web/src/lib/db/server.ts`
- Repositories under `web/src/server/repositories/`
- Existing crawler / ChatGPT pipelines are untouched

## Local setup

```bash
# From repo root
npm install
npm --prefix web install

# Copy env
copy web\.env.example web\.env
# Fill SUPABASE_URL + SUPABASE_SECRET_KEY (or SERVICE_ROLE_KEY)
```

### Migrations

Apply in order (Supabase SQL editor, CLI, or MCP):

1. `202608060001_create_agenttender_tenders.sql` (existing)
2. `202608060002_create_agenttender_qualification_results.sql` (existing)
3. `202608060003_create_agenttender_custom_auth.sql` (**new** — users/sessions/auth events)
4. `202608060004_create_agenttender_web_tender_list.sql` (**new** — web list view + indexes)

### Create administrator

Set in `web/.env` (never pass password on the CLI):

```env
AGENTTENDER_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
AGENTTENDER_BOOTSTRAP_ADMIN_NAME=Admin User
AGENTTENDER_BOOTSTRAP_ADMIN_PASSWORD=YourStrongPass1!
```

```bash
npm --prefix web run create-admin
```

First login forces password change (`must_change_password=true`).

## Environment variables

See `web/.env.example`. Never use `NEXT_PUBLIC_` for secret keys.

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Server-only DB access |
| `AGENTTENDER_SESSION_COOKIE` | HttpOnly cookie name |
| `AGENTTENDER_SESSION_HOURS` | Session TTL (default 8) |
| `AGENTTENDER_LOGIN_MAX_ATTEMPTS` | Lock after N failures (5) |
| `AGENTTENDER_LOCK_MINUTES` | Lock duration (15) |

## Authentication model

1. Login validates email/password with Zod
2. Password verified via SQL `agenttender_verify_password` (bcrypt / pgcrypto)
3. Raw session token in HttpOnly cookie; **SHA-256** stored in `agenttender_user_sessions`
4. Failed attempts increment; 5 failures → 15-minute lock
5. Logout revokes session + clears cookie

## Role permissions

| Role | Access |
|------|--------|
| ADMIN | Full app + user management |
| BID_MANAGER | Dashboard, tenders, analytics, saved views |
| ANALYST | Dashboard, tenders, analytics, saved views (read qualification) |
| VIEWER | Dashboard, tenders, detail, read-only analytics |

Authorization is enforced with `requireSession` / `requireRole` on the server.

## Commands

```bash
npm run web:dev      # http://localhost:3000
npm run web:build
npm run web:start
npm run web:lint
npm run web:test
```

## Security notes

- No Supabase Auth
- No service-role key in the browser
- Passwords never logged or returned in API responses
- RLS enabled on auth tables; anon/authenticated have no grants
- Generic login error text
- Security headers via middleware + `next.config.ts`

## Tests

```bash
npm run web:test
```

Covers password policy, session hashing contract, filter parsing, role gates, badge rendering.
