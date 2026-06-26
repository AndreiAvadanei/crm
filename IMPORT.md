# CRM Import Runbook — From Scratch

There is **no single "import all" button**. Data comes in through three channels:

- **CLI scripts** — Jira, legacy Airtable CSVs
- **UI uploads** — organizations, invoices, part numbers via `.xls/.xlsx`
- **Webhooks** — Gmail invoice PDFs, inbound email leads

Order matters because of dependencies.

## The big picture (dependency order)

```
0. Infrastructure  ->  1. Settings  ->  2. Jira (clients/deals/tasks)
        ->  3. Organizations  ->  4. Invoices  ->  5. Map part numbers  ->  6. APIs/automation
```

Invoices have two import sources: **Step 4** (SAGA/WinMentor `.xls`) and **Step 4b**
(Airtable `facturi.csv`). Use whichever matches where your historical data lives — or both.

Key dependency rules:

- Invoices link to deals by `SAL-####` -> **Jira must run first** if you want those links.
- Invoice XLS import auto-creates orgs/clients, but importing **organizations first** gives cleaner billing data.
- **Issuers + part numbers** must exist before creating/finishing invoices that use them.
- Historical XLS invoice import does **not** set part numbers — those are mapped per-invoice afterward.

---

## Step 0 — Infrastructure & what you need

**You need:** Docker (or local Node 20+ and MySQL), and your source files (`jira.csv`, accounting `.xls` exports, part-number `.xlsx`).

```bash
cp .env.example .env
# edit .env (see API section below for which keys matter)
docker compose up --build        # MySQL + web; entrypoint runs migrate + seed
```

Local (non-docker) alternative:

```bash
docker compose up -d mysql
npm install
npm run db:deploy                # apply all prisma migrations
npm run seed                     # pipeline stages, tags, custom fields, admin
```

The **seed** (`prisma/seed.ts`) creates: the Sales pipeline + 15 Jira-aligned stages, 16 tags, the SAL counter, deal/client custom-field definitions, and the bootstrap admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

Then log in as that admin -> change the password -> enroll a passkey/2FA.

---

## Step 1 — Settings (do before importing invoices)

Admin -> Settings:

1. **Default deal owner** — owner assigned to imported/inbound deals.
2. **Default organization VAT %** — e.g. `21`; applied to new/imported orgs.
3. **Issuers** — create your billing entities (see Step 1a).
4. **Branding** — upload light/dark logos (see Step 1b).
5. **Part numbers** — upload your catalog (see Step 5a). Best done here, early.
6. **Webhook secrets** — generate the inbound-email and invoice-files secrets if you'll use automation (Step 6).

### Step 1a — Add Invoice issuers (manual, no bulk import)

Issuers are the **seller legal entities** you issue invoices from. They appear in the
new-invoice wizard and as an invoice filter, and once **any** issuer exists, selecting one is
**required** during the XLS invoice import. So create them before Step 4.

Admin -> Settings -> **Invoice issuers** -> **Add issuer**. Fields:

| Field | Required | Notes |
|---|---|---|
| **Name** | Yes | e.g. `BIT SENTINEL SECURITY SRL` (unique) |
| Legal name | No | Full registered name |
| Tax id (CUI / VAT) | No | e.g. `RO12345678` |
| Reg. com. (J) | No | Trade registry number |
| Country | No | Defaults to Romania |
| County (județ) | No | Dropdown for RO, free text otherwise |
| City | No | |
| Address | No | |
| Bank | No | |
| IBAN | No | |
| Phone | No | |
| Email | No | |
| **Active** | — | On = selectable on invoices (default on) |
| **Default issuer** | — | Pre-selected in the invoice wizard |

Notes:

- Mark one issuer **Default** to pre-fill it on new invoices.
- Deleting an issuer keeps linked invoices' issuer **name** but unlinks the relation.
- Actions: `createIssuerAction` / `updateIssuerAction` / `deleteIssuerAction` (`src/server/issuer-actions.ts`); UI in `src/components/admin/issuers-card.tsx`.

### Step 1b — Branding (logos)

Admin -> Settings -> **Branding**. Upload separate logos for light and dark themes (shown in the sidebar/app chrome).

- **Format:** PNG only, **max 2MB**. The server validates MIME, extension, and the actual PNG signature bytes.
- Upload **Light logo** and **Dark logo** independently; either can be removed.
- Admins only. Stored under `UPLOADS_DIR`; served app-wide after upload.
- Actions: `uploadBrandingLogoAction` / `deleteBrandingLogoAction` (`src/server/branding-actions.ts`).

### Step 1c — Adding organizations manually (optional)

Most organizations come in via the bulk import in Step 3, but you can add or edit
single ones directly: go to `/organizations` -> **New organization** (or edit an existing
row). The org form also has an **ANAF** button that auto-fills company details by CUI.
New orgs created this way inherit the default VAT % from Step 1.

---

## Step 2 — Jira (clients, deals, tasks, comments, attachments)

**You need:** a CSV export of the Jira **Sales** project at `./jira.csv`. Optionally `JIRA_EMAIL` + `JIRA_API_TOKEN` for attachment downloads.

Processed: `Customer` issues -> deals, `Subtask` -> tasks. Key columns include `Issue key` (must be `SAL-####`), `Summary`, `Description`, `Status`, `Labels`, `Assignee`, dates, `Parent key`, `Comment`, `Attachment`, and `Custom field (...)`. Clients are derived from company/customer fields.

```bash
npm run import:jira -- --file ./jira.csv --dry-run          # always preview first
npm run import:jira -- --file ./jira.csv --commit
npm run import:jira -- --file ./jira.csv --commit --download-files   # needs JIRA_EMAIL+JIRA_API_TOKEN
```

Idempotent — upserts on `Deal.salesId`, so you can re-run safely.

**Clients** come mostly from this step. Otherwise create them manually at `/clients`, or let org/invoice imports auto-create them. There is no dedicated client CSV importer.

---

## Step 3 — Organizations (billing entities)

**You need:** a SAGA/WinMentor **clienti** export as `.xls/.xlsx` (CSV not accepted in the UI).

UI: `/organizations` -> Import -> preview -> apply (admin only).

Row 1 headers (case-insensitive). **Required:** `denumire`. **Optional:** `cod_fiscal`, `tara`, `judet`, `localitate`, `adresa`, `cont_banca`, `banca`, `tel`, `email`, `reg_com`, `delegat`, `tip_tert`, `is_tva`, `cod_post`, etc. (needs >=2 recognized columns including `denumire`).

Behavior: upsert by `Organization.sourceName` (= `denumire`); creates/links a `Client` of the same name; first org per client becomes default; new orgs get the default VAT % from Step 1.

Optional enrichment: the org edit form's **ANAF** button pulls company data by CUI (`src/lib/anaf.ts`). Bulk import does **not** call ANAF.

---

## Step 4 — Invoices (historical)

**You need:** SAGA/WinMentor **facturi** exports as `.xls/.xlsx`. **Filename must contain `ron` OR `valuta`** (not both), e.g. `ron - facturi.xls`, `valuta - facturi.xls`.

UI: `/invoices` -> Import -> **select issuer** -> preview -> apply.

Required headers: `nr_iesire`, `denumire`, `data`, `baza_tva`, `tva`, `neachitat`, `denumire1`. Valuta files also need `cod_valuta`; RON files must not have it. Line items read from `denumire1`, `um`, `cantitate`, `pret_unitar`, `valoare`, `total1`, etc.

Behavior: groups rows by `nr_iesire` into one invoice + multiple `InvoiceLine`s; upserts on `externalRecordId = accounting:{nr_iesire}`; matches/creates orgs by `sourceName`; `paid` inferred when `neachitat` is zero.

---

## Step 4b — Invoices from Airtable (legacy CSV)

If your historical invoices live in **Airtable** (the old "table platform"), use the CLI
importer instead of / in addition to the SAGA XLS import.

**You need:** an Airtable export of the invoices table as `./facturi.csv`.

```bash
tsx scripts/import-invoices.ts                       # dry-run (default)
tsx scripts/import-invoices.ts --file ./facturi.csv  # dry-run on a specific file
tsx scripts/import-invoices.ts --file ./facturi.csv --commit   # write rows
```

**Prerequisites:** organizations must already exist (Step 3) — rows whose company name has
no matching `Organization.sourceName` are **skipped**. Run Jira first (Step 2) if you want
invoices linked to deals via `SAL-####`.

**How it works** (`scripts/import-invoices.ts`):

- Reads columns **by position** to match the Airtable `facturi.csv` layout:

  | Index | Airtable column | Maps to |
  |---|---|---|
  | 0 | reference | `externalRef` |
  | 1 | status | `status` (contabilitate / asteptare / generat / other) |
  | 3 | `Nume companie (from Client)` | org match (`sourceName`) |
  | 4 | issuer | `issuerName` |
  | 5 | services | `servicesDescription` (+ contract ref auto-extracted) |
  | 6 | amount | `amountRaw` |
  | 7 | currency | `currency` |
  | 8 | term | `paymentTermDays` |
  | 9 | `Referinta proiect` | deal link by `SAL-xxxx` |
  | 10 | issue date | `issueDate` (`dd.mm.yyyy`) |
  | 11 | files | `fileUrls` |
  | 12 | total | `totalAmount` |
  | 13 | number | invoice `number` |
  | 14 | created by | `createdByName` |
  | 17 | `Record ID` | `externalRecordId` (idempotency key) |

- **Idempotent:** upserts by Airtable `Record ID`, so re-running updates instead of duplicating.
- **Multi-invoice rows:** when a single Airtable cell holds several numbers/totals split across
  newlines (e.g. storno + reissue), each is expanded into its own invoice keyed
  `<recordId>#<i>`. A number/total count mismatch is kept as one row and reported.
- **Money parsing:** handles EU/US/space-grouped formats (`29.576,00`, `18,920.00`, `59 214.40`, `EUR 16 920.00`).
- Always do a **dry-run first** — it prints counts of matched/missing orgs, deal links, and parse failures.

Related legacy helper — link Airtable orgs/invoices to existing CRM clients:

```bash
tsx scripts/link-organizations.ts --commit     # uses clienti.csv + facturi.csv + org-client-overrides.json
```

> These legacy scripts are **not** wired to `package.json`; run them with `tsx` directly.

---

## Step 5 — Part numbers & mapping to invoices

### 5a. Import the catalog

**You need:** a part-number `.xlsx`. Admin -> Settings -> Part numbers -> upload (upsert by unique `code`).

Header variants accepted: `Part Number` (-> `code`, required), `Group`, `Title`, `Limitations`, `Category`, `Sub-category`, `Sub-sub-category`, `Type`, `Description`. (There's also an auto-populate from `data-init/part-numbers.xlsx` if present on the server.)

### 5b. Map invoices to part numbers

This is **not** part of the bulk invoice XLS import — it's done **per invoice** in the invoice form dialog using the hierarchical `PartNumberPicker` (drill down by group/category/type). It stores `partNumberId`, `partNumberValues`, and the resolved `partNumberCode` on the invoice. So historical invoices get part numbers assigned by editing them; new invoices get them at creation.

---

## Step 6 — APIs & ongoing automation

| Integration | Purpose | What you need |
|---|---|---|
| **OpenAI** | Extract number/total/date from returned invoice PDFs | `OPENAI_API_KEY` (+ `OPENAI_MODEL`, default `gpt-4o`). Empty = files stored, no extraction. |
| **Gmail Apps Script** | Auto-capture invoice PDF replies -> CRM | Deploy `scripts/gmail-invoice-attachments.gs`; set `WEBHOOK_URL` + `WEBHOOK_SECRET` to mirror the invoice webhook secret from Step 1; 5-min trigger. |
| **Invoice files webhook** | Receives the PDFs | `/api/webhooks/invoice-files`, auth via DB secret; needs `APP_BASE_URL` set. |
| **Inbound email webhook** | Website leads -> client + deal | `/api/webhooks/inbound-email`, DB secret. |
| **ANAF** | Romanian company lookup by CUI | Public; optional `ANAF_API_BASE` (defaults to a demo endpoint — set a real one for production). |
| **Postmark** | Outbound notification emails | `POSTMARK_API_KEY` + `EMAIL_FROM` (no-op if empty). |
| **TinyMCE** | Rich-text comments | `NEXT_PUBLIC_TINYMCE_API_KEY` (build-time — rebuild image after change). |

Operational invoice flow once set up: create invoice in UI (issuer + part number + SAL) -> Generate (emails billing) -> accounting replies with PDF -> Gmail script -> webhook -> OpenAI fills number/total/date -> status `GENERATA`.

---

## Environment variables reference

| Variable | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | Everything | MySQL connection string |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Docker MySQL | |
| `WEB_PORT`, `DB_PORT` | Host port mapping | |
| `AUTH_SECRET` | Sessions | 32+ char random secret |
| `SESSION_COOKIE_NAME` | Sessions | Default `crm_session` |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN` | Passkeys | Must match deployed domain |
| `UPLOADS_DIR` | File storage | Invoice PDFs, attachments, branding |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First admin | Seed only |
| `APP_BASE_URL` | Email links, invoice file URLs | |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | PDF invoice extraction | Skipped if key empty |
| `POSTMARK_API_KEY`, `EMAIL_FROM`, `POSTMARK_MESSAGE_STREAM` | Outbound email | No-op if empty (dev) |
| `NEXT_PUBLIC_TINYMCE_API_KEY` | Rich-text editor | Build-time; rebuild image after change |
| `ANAF_API_BASE` | Org ANAF lookup | Optional; not in `.env.example`; defaults to a demo endpoint |
| `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_COOKIE` | Jira attachment downloads | CLI only |
| `IMPORT_USER_EMAIL_DOMAIN` | Placeholder emails for imported Jira users | Default `import.local` |

DB-backed secrets (managed in Admin -> Settings, not env): `inbound_webhook_secret`, `invoice_webhook_secret`, `default_deal_owner_id`, `default_organization_tva_percent`.

---

## Import mechanisms at a glance

| Data | Format | UI | CLI | Webhook | Idempotency key |
|---|---|---|---|---|---|
| Organizations | `.xls/.xlsx` | `/organizations` | `link-organizations.ts` (CSV) | — | `Organization.sourceName` |
| Invoices (accounting) | `.xls/.xlsx` | `/invoices` | `import-invoices.ts` (CSV) | — | `accounting:{nr_iesire}` or `Record ID` |
| Invoice PDFs | PDF base64 JSON | — | — | `invoice-files` | message dedupe + invoice match |
| Part numbers | `.xlsx` | Settings | — | — | `PartNumber.code` |
| Issuers | — | Settings (manual) | — | — | `Issuer.name` |
| Clients | — | `/clients` | Jira, link-org | inbound-email | name/email dedupe |
| Deals/Tasks | `jira.csv` | docs only | `import:jira` | inbound-email (deals) | `Deal.salesId` |
| Leads | email JSON | — | — | `inbound-email` | `InboundLead.messageId` |
| Settings | — | Settings | — | — | `AppSetting.key` |

---

## Pre-flight checklist

- [ ] `.env` filled: `DATABASE_URL`, `AUTH_SECRET`, `UPLOADS_DIR`, `SEED_ADMIN_*`, `APP_BASE_URL`, `OPENAI_API_KEY` (if using PDF extraction), `NEXT_PUBLIC_TINYMCE_API_KEY`
- [ ] Migrations applied + seed run; admin login works
- [ ] Settings: default owner, VAT %, issuers, webhook secrets
- [ ] `jira.csv` ready -> dry-run -> commit
- [ ] `clienti.xls` ready -> org import
- [ ] `ron/valuta facturi.xls` ready -> invoice import (issuer selected)
- [ ] part-number `.xlsx` uploaded
- [ ] Per-invoice part-number mapping done where needed
- [ ] Gmail script + webhook secret mirrored (if automating)
