# Prospect Intelligence — Developer Integration Guide

This guide is written for developers integrating the **Political Funding** and **Real Estate** matching products into a pipeline. Both tools are currently implemented as CLI programs. This document covers the data flow, input/output schemas, state management, and how to call them programmatically.

---

## Table of Contents

1. [Monorepo Structure](#1-monorepo-structure)
2. [Shared Concepts](#2-shared-concepts)
3. [Political Funding Matcher (`pfund`)](#3-political-funding-matcher-pfund)
4. [Real Estate Matcher (`restate`)](#4-real-estate-matcher-restate)
5. [Integration Patterns](#5-integration-patterns)
6. [Environment & Configuration](#6-environment--configuration)

---

## 1. Monorepo Structure

```
sec-prospect-matcher/
├── packages/
│   └── core/               # @pm/core — shared utilities (name parsing, prospect loading, CSV)
├── apps/
│   ├── political/          # pfund CLI — FEC + IRS 527 political donation matching
│   ├── real-estate/        # restate CLI — ATTOM property transaction matching
│   └── nonprofit/          # IRS 990 nonprofit grant matching (separate guide TBD)
├── data/                   # Prospect CSV files (client-specific)
├── .restate/               # Runtime state: API cache, watermarks, prior state
└── .env                    # API keys (ATTOM_API_KEY, FEC_API_KEY)
```

**Build order matters.** `@pm/core` must be built before any app:

```bash
npm run build:core         # always first
npm run build:political
npm run build:real-estate
```

---

## 2. Shared Concepts

### Prospect File

Both products consume the same prospect CSV format. The loader accepts flexible column aliases, but canonical columns are:

| Column | Required | Notes |
|--------|----------|-------|
| `prospect_id` | Yes | Unique ID — pass-through to output |
| `name` | Yes | Full name, e.g. `John A. Smith` |
| `city` | No | Home city |
| `state` | No | Two-letter state code |
| `zip` | No | ZIP code — improves match quality |
| `address` | No | Street address — enables exact address matching |
| `company` | No | Employer / affiliation |
| `alias_names` | No | Pipe-separated alternate names, e.g. `Jack Smith\|J. Smith` |

The loader normalizes names into `firstName`, `lastName`, `middleName` parts and builds an in-memory index keyed on name variants (exact, first+last, nickname, alias). Prospects with unparseable names are skipped and logged.

### Match Quality Tiers

Both products use a four-tier quality system:

| Tier | Meaning | Default routing |
|------|---------|-----------------|
| `high` / `Verified` | Strong name + address confirmation | `client.csv` |
| `medium` / `Likely Match` | Name confirmed, weaker location signal | `client.csv` |
| `low` / `Review Needed` | Marginal — needs human review | `review.csv` |
| `review` / `Low Confidence` | Ambiguous — likely FP | `review.csv` |

### Output Structure

Every run produces a timestamped directory:

```
{output_dir}/{run_id}/
├── client.csv      # Accepted matches — goes to gift officers
├── review.csv      # Borderline matches — needs human triage
├── manifest.json   # Full run metadata (counts, timings, paths)
└── stats.json      # Counts only (for dashboards)
```

---

## 3. Political Funding Matcher (`pfund`)

### What It Does

Matches your prospect list against federal political donation records. For each prospect, it finds donations they made to federal candidates and PACs, scores the match confidence, and outputs a CSV with donation details and partisan lean.

**Data sources:**
- **FEC bulk files** — Individual contribution data downloaded from `api.open.fec.gov`. Covers federal election cycles. Updated continuously by the FEC.
- **IRS 527 filings** — Donations to 527 political organizations (soft money). Downloaded separately from the IRS.
- **LDA lobbying data** — Lobbying registrations (stub — requires LDA API key).

### Data Flow

```
[FEC API / bulk files]  ──┐
[IRS 527 files]          ─┼──► Normalize ──► Deduplicate ──► Match against prospect index
[LDA registrations]      ─┘                                         │
                                                                     ▼
                                                          Score + route ──► client.csv / review.csv
```

### CLI Usage

**Step 1 — Fetch fresh FEC data** (downloads to `.pfund/raw/`):

```bash
node apps/political/dist/src/cli/index.js fetch \
  --start=2025-01-01 \
  --end=2026-03-31
```

This is a one-time or periodic fetch. The fetcher uses `execFileSync("curl")` internally and writes raw FEC bulk files to the state directory.

**Step 2 — Run matching:**

```bash
node apps/political/dist/src/cli/index.js run \
  --prospects=/path/to/prospects.csv \
  [--state-dir=/path/to/.pfund] \
  [--output-dir=/path/to/output]
```

Outputs the paths to `client.csv` and `review.csv` as JSON on stdout:

```json
{
  "clientCsv": "/path/to/output/pfund-2026-03-31T.../client.csv",
  "reviewCsv":  "/path/to/output/pfund-2026-03-31T.../review.csv",
  "operatorReport": "...",
  "manifestJson": "..."
}
```

**Other commands:**

```bash
pfund validate --prospects=...    # Validate prospect CSV format, show parse warnings
pfund inspect --run-id=...        # Print manifest for a completed run
```

### Output CSV Schema — `client.csv`

| Column | Type | Description |
|--------|------|-------------|
| `Prospect ID` | string | From your prospect file |
| `Prospect Name` | string | From your prospect file |
| `Donor Name (FEC)` | string | Exact name as filed with FEC |
| `Prospect Company` | string | From your prospect file |
| `Donor Employer` | string | Employer as filed with FEC |
| `Prospect Title` | string | From your prospect file |
| `Donor Occupation` | string | Occupation as filed with FEC |
| `Prospect City/State` | string | From your prospect file |
| `Donor City/State` | string | From FEC filing |
| `Donation Amount` | currency | e.g. `$5,000.00` |
| `Donation Date` | `MM/DD/YYYY` | Date of contribution |
| `Recipient` | string | PAC or candidate name |
| `Party` | string | `DEM`, `REP`, `IND`, etc. |
| `Candidate Name` | string | If recipient is a candidate |
| `Candidate Office` | string | e.g. `Senate`, `President` |
| `Data Source` | string | `FEC`, `527`, `Lobbying` |
| `Match Confidence` | integer 0–100 | Composite score |
| `Match Tags` | string | Pipe-separated signals, e.g. `name:exact\|location:city_state` |
| `Signal Type` | string | `Contribution` or `Registration` |
| `Partisan Lean` | string | e.g. `Strong Democrat`, `Lean Republican` |
| `Flags` | string | Warnings, e.g. `employer_mismatch` |
| `Action` | string | Recommended next step for gift officer |
| `FEC Filing Link` | URL | Direct link to FEC filing (FEC source only) |

### Matching Logic (Summary)

1. **Name lookup** — Each donation's donor name is normalized and looked up in the prospect index. Variants tried: `exact`, `first_last`, `nickname`, `alias`.
2. **Feature extraction** — For each candidate pair: employer similarity, location agreement (city/state), occupation match, name frequency bucket (common names penalized).
3. **Confidence scoring** — Weighted sum across features. Score 0–100.
4. **Guardrails** — Hard blocks applied before routing: employer conflict, extreme name ambiguity, state conflict.
5. **Routing** — Score ≥ 70 + guardrail pass → `client.csv`. Everything else → `review.csv`.

### State Directory Layout (`.pfund/`)

```
.pfund/
├── raw/
│   ├── fec/           # Downloaded FEC bulk contribution files
│   └── irs527/        # Downloaded IRS 527 files
├── normalized/        # Parsed + deduped contribution records
└── cursors/           # Fetch watermarks (last fetched date per source)
```

The state directory is **safe to reuse across runs**. The matcher reads from `normalized/` — stale data is only a problem if you haven't fetched recently.

---

## 4. Real Estate Matcher (`restate`)

### What It Does

Scans ATTOM property deed records for a set of counties and a date window. For each property transaction in that window, it matches the **buyer** (new owner) and **seller** (previous owner) against your prospect list. Outputs a CSV flagging who bought or sold property.

**Data source:** [ATTOM Data Solutions](https://www.attomdata.com/) — aggregates deed recordings from 3,100+ US county recorders.

**Key endpoint:** `GET /propertyapi/v1.0.0/property/expandedprofile`
Query parameters: `fips` (county FIPS code), `startcalendardate`, `endcalendardate`, `page`, `pageSize=100`

### Data Flow

```
[ATTOM API — expandedprofile]
        │
        ▼
  Fetch by county + date window (paginated, 100 records/page)
        │
        ├──► Cache to .restate/raw/attom/{fips}/{start}_{end}/page-{n}.json
        │
        ▼
  Filter: saleRecDate in alert window + saleAmt > $100 + arms-length
        │
        ├──► Extract buyer  (assessment.owner.owner1.fullName + mailingAddressOneLine)
        └──► Extract seller (sale.sellerName)
                │
                ▼
        Match against prospect index (name variants)
                │
                ▼
        Score: name weight + address weight
        Buyer  → can reach HIGH  (mailing address available)
        Seller → capped at MEDIUM (no post-sale mailing address)
                │
                ▼
        Enrich ambiguous matches via /saleshistory/expandedhistory
                │
                ▼
        Route → client.csv / review.csv
```

### Key Data Concepts

**`calendardate` vs `saleRecDate`**

ATTOM has two date fields that are easy to confuse:

- `calendardate` — the date ATTOM **refreshed** the record internally. This is what the API's date filter (`startcalendardate`/`endcalendardate`) applies to. A property sold in 2018 that ATTOM re-indexed in 2026 will appear in a 2026 query. This is noisy.
- `saleRecDate` — the date the deed was **recorded at the county recorder's office**. This is the actual transaction date.

**The system queries ATTOM with a wide `calendardate` window** (90 days before the alert end date) to capture all recently-refreshed records, then **filters locally by `saleRecDate`** to keep only transactions that actually occurred in your target period.

**Buyer vs Seller data availability**

| Field | Buyer | Seller |
|-------|-------|--------|
| Full name | `assessment.owner.owner1.fullName` | `sale.sellerName` |
| Mailing address | `assessment.owner.mailingAddressOneLine` | **Not available** (assessor record flips to new owner immediately) |
| Confirmation method | Name + mailing address | Name + property situs city/state only |
| Max quality tier | `high` | `medium` (capped) |

Seller matches are inherently less certain. The system adds a disclaimer to all seller rows: *"Location shown is the sold property address, not a verified seller residence."*

**Arms-length filter**

The matcher skips non-market transactions:
- `saleTransType != "Resale"` (excludes family transfers, foreclosures, bank sales)
- `quitClaimFlag == "True"` (excludes quitclaim deeds — often used for estate planning)
- `saleAmt <= 100` (excludes $1 nominal transfers)

### CLI Usage

**Step 1 — Bulk-fetch county data** (separate from matching):

```bash
node apps/real-estate/dist/src/cli/index.js bulk-fetch \
  --counties=04013,06037,36061,48201 \
  --start=2026/01/01 \
  --end=2026/03/31
```

This downloads and caches all pages for the specified counties and date range. Pages are written to `.restate/raw/attom/`. **This step is resumable** — re-running the same command skips already-cached pages. Retries up to 4× on 504/503 errors with backoff.

**Step 2 — Run matching** (reads from cache, no API calls if fully cached):

```bash
node apps/real-estate/dist/src/cli/index.js monitor \
  --prospects=/path/to/prospects.csv \
  --counties=04013,06037,36061,48201 \
  --start=2026/01/01 \
  --end=2026/03/31 \
  [--output=.restate/runs] \
  [--state-dir=.restate]
```

Prints the path to `client.csv` on stdout when complete.

**Other commands:**

```bash
restate fetch --fips=36061 --start=2026/01/01 --end=2026/03/31 --page=1
# Fetch a single page (low-level, used for debugging)

restate validate --prospects=...
# Validate prospect CSV

restate inspect --run-id=...
# Print manifest for a completed run
```

### Output CSV Schema — `client.csv`

| Column | Type | Description |
|--------|------|-------------|
| `Prospect ID` | string | From your prospect file |
| `Prospect Name` | string | From your prospect file |
| `Role` | `buyer` \| `seller` | Whether prospect bought or sold |
| `Match Quality` | `high`/`medium`/`low`/`review` | Confidence tier |
| `Combined Score` | integer 0–100 | Composite confidence score |
| `Match Reason` | string | Semicolon-separated scoring signals, e.g. `name:first_last; address:mailing_city_state` |
| `Source Name on Record` | string | Exact name as it appears in ATTOM deed data |
| `Property Address` | string | Situs (physical) address of the property |
| `Property City` | string | |
| `Property State` | string | Two-letter code |
| `Property ZIP` | string | |
| `Sale Date` | `YYYY-MM-DD` | `saleRecDate` (deed recording date at county) |
| `Sale Price` | integer | Sale amount in USD |
| `Property Type` | string | e.g. `SFR`, `CONDO`, `MFR` |
| `Assessed Value` | integer | County assessed value in USD |
| `Buyer Mailing Address` | string | New owner's mailing address — **buyers only**, blank for sellers |
| `Disclaimer` | string | For seller rows: *"Location shown is the sold property address, not a verified seller residence."* |
| `Signal` | string | Human-readable signal for gift officer |
| `Action` | string | Recommended action |
| `Source Vendor` | string | Always `attom` |
| `Source Property ID` | string | ATTOM's internal property identifier |

### Scoring Details

Name scoring weights:

| Variant | Points |
|---------|--------|
| `exact` (full normalized match) | 50 |
| `first_last` | 40 |
| `nickname` | 25 |
| `trust_extracted` | 30 |
| `co_owner` | 20 |

Address scoring weights (buyers):

| Address match | Points |
|---------------|--------|
| `mailing_exact` | 45 |
| `mailing_zip` | 38 |
| `mailing_city_state` | 22 |
| `mailing_state` | 5 |
| `situs_exact` | 25 |
| `situs_city_state` | 15 |
| `situs_state` | 3 |

Quality thresholds: **high ≥ 85**, **medium ≥ 65**, **low ≥ 40**, **review < 40**

Seller matches are hard-capped at `medium` regardless of score.

Address `mismatch` forces the match to `review` regardless of score.

### State Directory Layout (`.restate/`)

```
.restate/
├── raw/
│   └── attom/
│       └── {fips}/
│           └── {start}_{end}/
│               ├── page-1.json        # Raw ATTOM API response (100 properties)
│               ├── page-2.json
│               └── scan-manifest.json # Pages fetched, total pages, status
├── normalized/
│   └── prior-state/
│       └── {attomId}.json             # Last-seen snapshot per property (for change detection)
├── cursors/
│   └── real-estate-watermarks.json    # Per-county: lastCompleted, lastStarted, status
└── runs/
    └── monitor-{timestamp}/
        ├── client.csv
        ├── review.csv
        ├── manifest.json
        └── stats.json
```

**Cache behavior:** The monitor command checks the cache before every API call. If a page file exists for `(fips, start, end, page)`, it reads from disk — zero API calls. This means you can pre-fetch data (`bulk-fetch`) and run matching multiple times against different prospect files with no additional API cost.

### API Key Management

ATTOM keys are comma-separated in `.env`:

```
ATTOM_API_KEY=key1,key2,key3
```

The client rotates to the next key on every `401 Unauthorized` response. Once all keys are exhausted, the county fails and the run continues with the next county. Failed counties can be retried by re-running `bulk-fetch` with fresh keys.

ATTOM enforces a daily call quota per key. For 138 counties × ~50 pages avg = ~7,000 API calls. With a typical quota of ~1,000–2,000 calls/key/day, plan for 4–7 keys or multiple days of fetching.

---

## 5. Integration Patterns

### Pattern A — Scheduled Pipeline (Recommended)

```
[Cron: weekly]
    │
    ├── 1. pfund fetch --start={last_run} --end={today}
    │       (incremental — only new donations)
    │
    ├── 2. restate bulk-fetch --counties=... --start={90_days_ago} --end={today}
    │       (full re-fetch or incremental by moving the start date)
    │
    ├── 3. pfund run --prospects={client_file}
    │       → outputs: client.csv, review.csv
    │
    ├── 4. restate monitor --prospects={client_file} --counties=... --start=... --end=...
    │       → outputs: client.csv, review.csv
    │
    └── 5. Upload CSVs to CRM / data warehouse
```

### Pattern B — Programmatic Invocation (Node.js)

Both CLIs are thin wrappers around TypeScript classes. You can import them directly:

```typescript
// Political
import { PoliticalMatcher } from "@pm/political/core/PoliticalMatcher";
import { StateStore, createLogger } from "@pm/core";

const matcher = new PoliticalMatcher({ runId, logger, stateStore, outputDir, maxProspectSkipRate: 0.1 });
const manifest = matcher.execute("/path/to/prospects.csv");
// manifest.outputs.clientCsv → path to output file

// Real estate
import { MonitoringEngine } from "@pm/real-estate/core/MonitoringEngine";

const engine = MonitoringEngine.fromEnv(cwd, stateDir);
const manifest = await engine.execute({
  runId, logger, prospectsPath, counties, startDate, endDate, outputDir
});
// manifest.outputs.clientCsv → path to output file
```

### Pattern C — Shell Invocation with JSON parsing

Both CLIs print the output file paths as JSON to stdout on success. You can parse this in any language:

```bash
OUTPUT=$(node apps/political/dist/src/cli/index.js run --prospects=data/prospects.csv)
CLIENT_CSV=$(echo "$OUTPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['clientCsv'])")
```

### Handling Partial Runs

Both tools are designed to be **fault-tolerant and resumable**:

- `bulk-fetch` skips counties with a complete `scan-manifest.json`
- `pfund fetch` uses watermarks to fetch only new records since the last run
- All state is stored in the state directory — safe to kill and restart

If a run produces zero matches, check:
1. `manifest.json` → `prospectLoad.skipped` — are prospects being parsed correctly?
2. `stats.json` → `propertyRecordsProcessed` — did we actually fetch data?
3. `review.csv` — matches may be routing to review instead of client

---

## 6. Environment & Configuration

### `.env` file (project root)

```bash
ATTOM_API_KEY=key1,key2,key3,key4   # Comma-separated; rotates on 401
FEC_API_KEY=your_fec_key             # From api.open.fec.gov
LDA_API_KEY=your_lda_key             # Optional — lobbying registrations
```

### State directory

Default locations:
- Political: `.pfund/` (relative to CWD)
- Real estate: `.restate/` (relative to CWD)

Override with `--state-dir` flag or `RESTATE_STATE_DIR` / `PFUND_STATE_DIR` env vars.

### Prospect file column aliases

The loader accepts several naming conventions for each field:

| Canonical | Also accepted |
|-----------|---------------|
| `prospect_id` | `id`, `constituent_id`, `system_record_id` |
| `name` | `full_name`, `original_name` |
| `city` | — |
| `state` | — |
| `zip` | `postcode`, `postal_code` |
| `address` | `address_block` |
| `company` | — |
| `alias_names` | — |

### Build & test

```bash
npm install                   # from repo root
npm run build:core            # required before any app
npm run build:political
npm run build:real-estate
npm run test:political        # 8 tests
npm run test:real-estate      # 60 tests
```
