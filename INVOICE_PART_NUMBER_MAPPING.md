# Production invoice ↔ part-number reconciliation

Status: **read-only review**. No production data has been changed and there is
no database-import/commit path yet.

Generated on 2026-08-02 from:

- Production MySQL (`root@46.224.17.213`), exported read-only:
  **1,442 invoices / 1,595 invoice lines**.
- `data-init/Facturi in lei cu detalii Bit.xls`: **1,374 invoices**.
- `data-init/Facturi in valuta cu detalii BIT.xls`: **295 invoices**.
- `data-init/Internal Affairs - 2023_2024_2025_2026 - Proiecte.csv`:
  **1,571 usable activities / 1,733 possible billing slots**.

## Important accounting-data finding

Repeated `nr_iesire` rows **inside one export** are line items belonging to the
same invoice. The matcher groups them correctly.

The RON and valuta exports also reuse some invoice numbers for **different**
invoices. These are not line items:

- `BT.BIT 37` in RON = Zipper Services, 2018-01-18, two RON lines.
- `BT.BIT 37` in production = Crowngem Limited, 2018-12-11, one EUR line.
- `BT.BIT 22` in RON = Fan Courier; production = Crowngem/EUR.
- `BT.BIT 204` in RON = Certsign; production = Creatopy/EUR.

The current accounting importer keys both files as
`externalRecordId = accounting:{nr_iesire}`. Valuta was imported after RON, so
**258 current RON-export invoices are absent from production** because their
keys were overwritten. Production is cumulative and also contains 31 older
rows no longer present in the two newest exports.

The matcher therefore uses:

1. The actual 1,442 production rows as the review/import target.
2. Production plus the 258 missing current RON rows as accounting evidence
   when deciding whether a tracker activity has already been invoiced.
3. A separate collision report; missing rows are never mixed into the
   production review import.

## Matching logic

### Company gate

Tracker `Societate` is matched to accounting/production `denumire` (the legal
entity name), after:

- case, punctuation and Romanian-diacritic normalization;
- removal of legal forms (`SRL`, `SA`, `LLC`, `SCA`, etc.);
- optional human-curated aliases from `scripts/tracker-org-aliases.json`;
- conservative fuzzy matching (review-only; never automatically trusted).

### Company cohorts

The algorithm deliberately uses different behavior for different histories:

| Cohort | Definition | Matching behavior |
|---|---|---|
| `SMALL` | fewer than 5 known invoices | Strict: contract/reference evidence is required for HIGH. Amount/date alone cannot become HIGH. |
| `RECURRENT` | at least 5 invoices, monthly cadence, plus repeatable service or dominant part number | Chronological one-to-one matching against monthly tracker rows. Date and historical pattern are stronger than nominal amount. |
| `MANY` | at least 15 invoices but not one clean recurrent series | Contract/date/description scoring plus company part-number profile. Ambiguous clients remain MEDIUM/manual. |
| `STANDARD` | 5–14 invoices, not recurrent | Normal conservative scoring. |
| `UNMATCHED` | company absent from tracker | No guess; remains blank. |

Current production cohort distribution:

| Cohort | Invoices | HIGH | Default import=yes |
|---|---:|---:|---:|
| RECURRENT | 482 | 460 | 451 |
| MANY | 435 | 90 | 83 |
| SMALL | 182 | 83 | 66 |
| STANDARD | 138 | 89 | 69 |
| UNMATCHED | 205 | 0 | 0 |

This fixes the earlier problem where PVOLVE, Waydev, Hertza and Keysight were
scored LOW despite being predictable:

- **PVOLVE**: monthly date selects the month-specific part number; invoice
  amount is systematically ~4.1% above tracker.
- **Waydev**: recurring service history maps to `BLUE-MDR-C-50`; contract value
  moved from 610 to actual 640/660.
- **Hertza**: `RED-PEN-B-E-B-30` dominates; actual 4,500 differs from tracker
  3,962.
- **Keysight**: monthly dates and an 82% dominant `KS-MM-RD-2` profile; values
  legitimately vary by delivered days.

### Contract values can increase or decrease

Amount is **supporting evidence, never a rejection rule**.

For recurrent companies, the matcher learns dated invoice/tracker ratios only
from near-exact date pairs and applies the local median around each invoice.
This captures systematic differences and step changes. It also records a
company trend (`UP`, `DOWN`, `STABLE`, `MIXED/UNKNOWN`), but does not change a
part number solely because price moved.

If tracker rows stop but the same company has at least five highly similar
issued invoices with at least 95% agreement on one part number, the matcher can
continue that historical pattern. Old evidence becomes MEDIUM instead of HIGH,
because a renewed contract may retain the same wording and change part number.

### One-to-one monthly reconciliation

Every tracker activity creates zero, one or two billing slots:

- advance (`Avans`);
- final (`Final`);
- total fallback.

Actual invoice lines and slots are matched one-to-one inside the same company.
Repeated monthly tracker rows are preserved; they are not deduplicated.

For multi-line invoices, each line is matched independently. If the lines map
to different part numbers, the invoice is `MULTI_LINE`, defaults to
`import=no`, and requires a manual decision because the current `Invoice`
schema stores only one part number.

Storno invoices do not consume a tracker billing slot. They inherit from a
sufficiently similar original invoice and default to manual review.

### Contract references

Only contract/agreement references are treated as contract IDs. Annex and order
numbers are deliberately excluded; treating `Anexa 12` as contract `12`
created false deterministic matches.

## Production results

| Confidence | Invoices | Share |
|---|---:|---:|
| HIGH | 722 | 50.1% |
| MEDIUM | 386 | 26.8% |
| LOW | 67 | 4.6% |
| NONE | 267 | 18.5% |
| **Default `import=yes`** | **669** | **46.4%** |

Not every HIGH row defaults to import:

- storno/reference inheritance;
- multi-line ambiguity;
- fuzzy company matching;

remain `import=no` until reviewed.

Most remaining human effort is concentrated in multi-product companies:
Orange, Silkweb, Selgros and Certsign. This is expected: company history alone
cannot safely choose among several concurrent products.

## Tracker invoiced flags and future invoices

`Facturat avans/final = Da/Nu` is never used as truth. The matcher first looks
for an actual invoice across all known accounting evidence.

Current schedule reconciliation:

- **1,195** tracker slots matched to accounting invoices.
- **55** matched slots still say `Nu`/`N/A` in the tracker: confirmed stale
  flags.
- **183** unmatched future slots (`UPCOMING`), from 2026-08-05 onward.
- **346** past unmatched slots (`PAST_UNMATCHED`): reconciliation required;
  this does **not** prove they were never invoiced.
- **9** unmatched slots without a usable date.

Upcoming by month begins with:

- Aug 2026: 22
- Sep 2026: 21
- Oct 2026: 23
- Nov 2026: 22
- Dec 2026: 20

Future rows are forecasts, not import-ready invoices. They may change, move,
increase/decrease in price, or be billed early.

## Generated files

| File | Purpose |
|---|---|
| `scripts/invoice-part-number-review.csv` | **The document to edit and return.** Exactly 1,442 production invoices, sorted by company then date. |
| `scripts/invoice-part-number-proposal.csv` | Same production rows with full matcher detail. |
| `scripts/invoice-mapping-company-summary.csv` | Company cohort, recurrence, dominant part number, cadence and price trend. |
| `scripts/invoice-schedule-reconciliation.csv` | Every tracker billing slot and the actual accounting invoice matched to it. |
| `scripts/upcoming-invoice-forecast.csv` | Unmatched future, past and no-date tracker slots. |
| `scripts/production-missing-ron-invoices.csv` | 258 current accounting rows absent from production because of key collisions. |
| `data-init/production-invoices-snapshot.json` | Read-only production snapshot used to generate the review sheet. |

Regenerate the production snapshot and all reports:

```bash
npx tsx scripts/export-production-invoice-snapshot.ts
npx tsx scripts/map-invoice-part-numbers.ts
```

## What to edit in the review CSV

Open `scripts/invoice-part-number-review.csv`. It is sorted by company/date so
you can review one customer history at a time.

Only the first four columns are editable:

| Column | Action |
|---|---|
| `invoiceKey` | **Never edit.** This is the actual production `externalRecordId`. |
| `import` | Set `yes` to approve writing; `no` to skip. |
| `partNumberFinal` | Confirm or replace with the correct part-number code. |
| `notes` | Optional explanation. |

Everything after `notes` is reference:

- `companyType`, invoice/activity counts, dominant part number/share, cadence
  and price trend;
- `confidence`, `matchMode`;
- invoice company/date/currency/value/service;
- proposed part number and alternatives;
- tracker row/date/contract;
- line-level mappings and reason.

Recommended review order:

1. Filter `companyType = RECURRENT`: most are already HIGH; scan each company
   chronologically for a part-number transition.
2. Review `matchMode = MULTI_LINE` and `STORNO_REFERENCE`.
3. Review MEDIUM rows company-by-company, especially MANY clients.
4. Leave LOW/NONE as `import=no` unless you know the answer.
5. Do not add the 258 collision rows to this CSV; they do not exist in
   production and need a separate importer repair.

No database write will be built or run until this reviewed CSV comes back and
the external-record key collision is fixed.
