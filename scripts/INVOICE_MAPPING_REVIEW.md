# Invoice → part-number review

Generated for the production snapshot and accounting exports as of 2026-08-02.

## Safety status

`scripts/invoice-part-number-review.csv` is a review file, not an import-ready
file. Every `import` cell intentionally defaults to `no`. No database changes
have been made.

The independent audit found unsafe identity, source-grouping, currency and
catalog assumptions in the earlier mapper. The current output now:

- keys every review row with the actual production `externalRecordId`;
- treats `id_iesire`, not the reused invoice number, as source identity;
- quarantines production invoices whose number was reused inside one workbook;
- keeps RON/valuta number collisions separate and reports overwritten RON rows;
- does not compare USD nominal values to tracker values without a learned,
  dated recurring ratio;
- rejects explicit avans/final contradictions;
- leaves multi-part invoices and storno invoices for review;
- resolves concrete part numbers to exactly one catalog template and extracts
  placeholder values;
- records input hashes and counts in
  `scripts/invoice-mapping-run-metadata.json`.

## Current reconciliation

- Production invoice rows: **1,442**
- Distinct current source invoices: **1,690** (1,383 RON + 307 valuta)
- Current source invoices absent from production: **279**
- Tracker activities / billing slots: **1,571 / 1,733**
- Invoice numbers reused inside a workbook: **21**
- Production rows quarantined due to within-workbook reuse: **15**

## Main file to edit

Open `scripts/invoice-part-number-review.csv`. It is sorted by company and date.

Edit only:

1. `import`
   - Leave `no` to skip the row.
   - Change to `yes` only after confirming the invoice and concrete part
     number.
2. `partNumberFinal`
   - Keep the proposed concrete code if correct.
   - Replace it with the correct concrete code if needed.
   - Do not enter the catalog template containing `<limit>` placeholders.
3. `reviewNote`
   - Optional explanation for corrections or unresolved cases.

Do not edit `invoiceKey`; it identifies the exact production row.

## Suggested review order

### 1. `recommendedAction = ACCEPT_CANDIDATE` — 567 rows

These are HIGH candidates with:

- an exact/curated organization resolution;
- a unique part-number catalog template;
- either a contract match within 14 days or a recurrent-date match within
  7 days;
- no storno, multi-line conflict, historical extrapolation, or source-number
  anomaly.

Review each company as a sequence, spot-check the invoice service text and
dates, then change `import` to `yes` for accepted rows. `ACCEPT_CANDIDATE` is a
recommendation, not authorization to import.

### 2. `recommendedAction = REVIEW` — 574 rows

These have a proposal but need individual judgment. Pay particular attention
to:

- `matchMode = MULTI_LINE`: different invoice lines may map to different part
  numbers; do not reduce them to one header part number unless all meaningful
  lines belong to the same code.
- `matchMode = STORNO_REFERENCE`: approve only if the referenced original
  invoice and reversed amount/currency are consistent.
- `matchMode = HISTORICAL_PATTERN` or `PROFILE`: these are extrapolations, not
  direct tracker matches.
- fuzzy or alias organization resolution.
- low score margin, multiple candidates, or a large date gap.

`lineProposals` contains line-level evidence for multi-line invoices.

### 3. `recommendedAction = SKIP_NO_MATCH` — 301 rows

No usable candidate was found. Leave `import = no` unless you manually identify
the correct code.

### 4. Never approve quarantined rows yet

Rows with `matchMode = SOURCE_REUSE_ANOMALY` represent invoice numbers reused
by different organization/date/`id_iesire` headers in one accounting workbook.
The corresponding production invoice may contain contaminated source lines.
Resolve these through a separate production-data cleanup first.

The detailed identities are in
`scripts/production-number-reuse-anomalies.csv`.

## Evidence columns

- `sourceId`: immutable source `id_iesire` for accounting rows, or production
  invoice ID for snapshot rows.
- `partNumberTemplate` / `partNumberValues`: catalog template and extracted
  placeholder values for the proposed concrete code.
- `catalogStatus`: must be `UNIQUE` before import.
- `partNumberCandidates`, `score`, `scoreMargin`, `signals`, and `reason`:
  matching evidence.
- `trackerRow`, `trackerExpectedDate`, `dateGapDays`, `trackerAmount`, and
  `trackerDescription`: selected billing-slot evidence.
- `companyType` and company profile columns: cohort context; they are not proof
  by themselves.

## Other outputs

- `invoice-part-number-proposal.csv`: detailed non-editable proposal evidence.
- `invoice-mapping-company-summary.csv`: company-level workload and patterns.
- `invoice-schedule-reconciliation.csv`: tracker slots matched to accounting
  evidence or classified as upcoming/past-unmatched.
- `upcoming-invoice-forecast.csv`: non-invoiced tracker slots; this is a
  forecast, not proof that an invoice is absent.
- `production-missing-ron-invoices.csv`: source invoices likely absent after
  RON/valuta production-key collisions.
- `production-number-reuse-anomalies.csv`: within-workbook number reuse.
- `invoice-mapping-run-metadata.json`: exact input files, SHA-256 hashes, and
  counts used for this run.

## Return workflow

After review, return the edited `invoice-part-number-review.csv`. Before any
production write, the final file must be validated for:

- unchanged/unique production keys;
- `import` values restricted to `yes`/`no`;
- a non-empty concrete `partNumberFinal` for every `yes`;
- exactly one catalog-template resolution for every accepted code;
- no accepted quarantined or unresolved multi-line row;
- production fingerprint agreement against a fresh read-only snapshot.

An importer should be generated only after this validation succeeds.
