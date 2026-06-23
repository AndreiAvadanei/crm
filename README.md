# CRM

A modern, self-hosted HubSpot-style sales CRM: clients, deals (with `SAL-####` ids), kanban pipelines, tasks/next-actions, comments, file uploads, admin-configurable custom fields, role-based access with tag/date-scoped visibility and explicit sharing, mandatory password-change + 2FA/passkey auth, and a professional analytics dashboard.

## Stack

- **Next.js 16** (App Router, TypeScript, Server Actions) + **React 19**
- **MySQL 8** + **Prisma 6** (migrations via `prisma migrate`)
- **Tailwind CSS v4** + shadcn-style UI + `next-themes` (dark/light)
- **Auth**: argon2 passwords, DB-backed sessions, **TOTP 2FA** (`otplib`) and **passkeys** (`@simplewebauthn`)
- **Charts**: `recharts`
- **Files**: local volume (`UPLOADS_DIR`)

## Quick start (Docker)

```bash
cp .env.example .env          # adjust secrets + ports
docker compose up --build
```

- App: `http://localhost:${WEB_PORT}` (default `3000`).
- **Ports are configurable** via `.env` to avoid conflicts with other local services:
  - `WEB_PORT` — host port for the web app (container always listens on `3000` internally).
  - `DB_PORT` — host port mapped to MySQL `3306` (used by the Prisma CLI / Studio from your machine).
  - If you change `WEB_PORT`, passkeys also need `WEBAUTHN_ORIGIN=http://localhost:${WEB_PORT}` (compose derives this automatically from `WEB_PORT`).
- On boot the `web` container waits for MySQL, runs `prisma migrate deploy` (**this applies the first/initial migration automatically**), then seeds the pipeline, tags, custom fields and a bootstrap admin (all idempotent).
- Default admin (from `.env`): `admin@crm.local` / `ChangeMe123!`
  - First login forces a **password change**, then **mandatory 2FA enrollment** (TOTP or passkey).

## Local development

```bash
# 1. Start MySQL only
docker compose up -d mysql

# 2. Install + migrate + seed
npm install
npm run db:deploy        # or: npm run db:migrate (creates new migrations)
npm run seed

# 3. Run dev server
npm run dev
```

Set `DATABASE_URL` in `.env` to `mysql://crm:crm@127.0.0.1:${DB_PORT}/crm` for local dev/CLI (matches the `DB_PORT` you mapped).

## Database migrations

**Initial migration (already wired):** the `0_init` migration under `prisma/migrations/` creates the full schema. It is applied automatically on container boot (`prisma migrate deploy`). You can also apply it manually against a running DB:

```bash
npm run db:deploy        # applies all committed migrations (no prompts) — use in prod/containers
```

**Creating the *next* migration** (after you change `prisma/schema.prisma`):

```bash
# 1. Make sure MySQL is reachable on DATABASE_URL (e.g. `docker compose up -d mysql`)
# 2. Create + apply a new migration locally and regenerate the client:
npm run db:migrate -- --name <describe_change>     # prisma migrate dev
# 3. Commit the new folder in prisma/migrations/ — it will auto-apply on the next deploy.
```

- `npm run db:migrate` = `prisma migrate dev` (creates a migration from schema changes, applies it, regenerates the client). Dev only.
- `npm run db:deploy` = `prisma migrate deploy` (applies committed migrations without generating new ones). Prod/containers.
- `npm run db:generate` = regenerate the Prisma client only.
- The client is generated to `src/generated/prisma`.

## Jira import

The importer maps the exported `jira.csv` (Sales project) into the CRM:

- `Customer` issues -> **Deals** (+ auto-created **Clients**), `Issue key` -> `salesId`, `Status` -> stage, `Labels` -> tags, `Custom field (...)` -> custom field values.
- `Subtask` issues -> **Tasks** linked to their parent deal; subtask descriptions/comments/files are preserved on the parent deal with the subtask key/title.
- `Comment` columns -> deal **comments**; `Attachment` columns -> **attachment** records. By default attachments keep the original Jira URL; use `--download-files` to copy them into CRM storage.

It is **idempotent** and defaults to a **dry run**:

```bash
# Preview only (no writes):
npm run import:jira -- --file ./jira.csv --dry-run

# Preview and verify the first 2 Jira attachment downloads (no writes):
npm run import:jira -- --file ./jira.csv --dry-run --verify-downloads 2

# Apply (only run when you are satisfied with the preview):
npm run import:jira -- --file ./jira.csv --commit

# Apply and download Jira attachments into UPLOADS_DIR:
JIRA_EMAIL="you@example.com" JIRA_API_TOKEN="..." npm run import:jira -- --file ./jira.csv --commit --download-files
```

> The import is guarded and never runs automatically.

The import is designed for retry after interruption. Deals are upserted by exact Jira `SAL-` id, comments/files are de-duplicated, and file downloads create an attachment marker before downloading so a rerun can fill any partially imported file records.

## Roles & visibility

- **ADMIN**: full access; manages users, custom fields, pipeline/tags, sharing and per-user visibility; can run the import.
- **SALES**: sees deals/clients they own, plus records matching their **tag + date** access rules, plus records explicitly **shared** with them by an admin.

## Project layout

```
prisma/                Prisma schema, migrations, seed
src/app/               Routes (auth, dashboard, deals, clients, admin, account)
src/components/ui/     shadcn-style primitives
src/lib/               db, auth (password/session/totp/webauthn), rbac, storage, custom-fields
src/server/            server actions & services
scripts/import-jira.ts Guarded Jira CSV importer
docker/                container entrypoint
```
