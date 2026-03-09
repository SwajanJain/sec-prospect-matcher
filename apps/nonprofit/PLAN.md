# Nonprofit Funding Matcher — Implementation Plan

> Based on verified IRS XML schema from real 990/990-PF filings (samples in `apps/nonprofit/samples/`).

---

## Goal

Match prospects against **newly published IRS 990/990-PF filings** to identify:
1. **Foundation donors** — who gave $5,000+ to a private foundation (990-PF Schedule B)
2. **Foundation grants** — what grants a prospect's foundation made (990-PF Part XV)
3. **Nonprofit board roles** — which nonprofits a prospect serves as officer/director/trustee (990 Part VII, 990-PF Part VII)

Run monthly. Download latest IRS XML batch, parse, match against prospect list, output CSV.

---

## Verified XML Schema (From Real Filings)

### 990-PF Schedule B — Foundation Donors (HIGHEST VALUE)

```xml
<IRS990ScheduleB>
  <ContributorInformationGrp>
    <ContributorNum>1</ContributorNum>
    <ContributorPersonNm>DARLENE FUNCHES</ContributorPersonNm>    <!-- MATCH THIS -->
    <ContributorUSAddress>
      <AddressLine1Txt>217 GRAFTON PLACE</AddressLine1Txt>
      <CityNm>MATTESON</CityNm>
      <StateAbbreviationCd>IL</StateAbbreviationCd>
      <ZIPCd>60443</ZIPCd>
    </ContributorUSAddress>
    <TotalContributionsAmt>9518</TotalContributionsAmt>           <!-- EXTRACT -->
    <PersonContributionInd>X</PersonContributionInd>
  </ContributorInformationGrp>
</IRS990ScheduleB>
```

**Fields:** Name, address (city/state/zip), amount, person vs org indicator.
**Note:** Some 990-PFs have `<ScheduleBNotRequiredInd>X</ScheduleBNotRequiredInd>` when total contributions are below threshold.

### 990-PF Part XV — Grants Paid by Foundation

```xml
<SupplementaryInformationGrp>
  <GrantOrContributionPdDurYrGrp>
    <RecipientBusinessName>
      <BusinessNameLine1Txt>AMERICAN HEART ASSOCIATION</BusinessNameLine1Txt>
    </RecipientBusinessName>
    <RecipientUSAddress>...</RecipientUSAddress>
    <RecipientRelationshipTxt>NONE</RecipientRelationshipTxt>
    <RecipientFoundationStatusTxt>501(C)3</RecipientFoundationStatusTxt>
    <GrantOrContributionPurposeTxt>CIVIC ENHANCEMENT</GrantOrContributionPurposeTxt>
    <Amt>1500</Amt>
  </GrantOrContributionPdDurYrGrp>
  <TotalGrantOrContriPdDurYrAmt>3500</TotalGrantOrContriPdDurYrAmt>
</SupplementaryInformationGrp>
```

**Fields:** Recipient name, address, relationship, foundation status, purpose, amount.
**Also has:** `<GrantOrContriApprvForFutGrp>` for approved-but-not-yet-paid grants.

### 990-PF Part VII — Foundation Officers/Directors

```xml
<OfficerDirTrstKeyEmplInfoGrp>
  <OfficerDirTrstKeyEmplGrp>
    <PersonNm>JOSE M FERRER IV</PersonNm>           <!-- MATCH THIS -->
    <TitleTxt>TRUSTEE</TitleTxt>
    <CompensationAmt>0</CompensationAmt>
  </OfficerDirTrstKeyEmplGrp>
</OfficerDirTrstKeyEmplInfoGrp>
```

### Regular 990 Part VII — Nonprofit Officers/Directors

```xml
<Form990PartVIISectionAGrp>
  <PersonNm>KEITH STUMP</PersonNm>                   <!-- MATCH THIS -->
  <TitleTxt>Executive Dir.</TitleTxt>
  <AverageHoursPerWeekRt>40.00</AverageHoursPerWeekRt>
  <OfficerInd>X</OfficerInd>                         <!-- Role flags -->
  <IndividualTrusteeOrDirectorInd>X</IndividualTrusteeOrDirectorInd>
  <ReportableCompFromOrgAmt>108997</ReportableCompFromOrgAmt>
  <ReportableCompFromRltdOrgAmt>0</ReportableCompFromRltdOrgAmt>
  <OtherCompensationAmt>0</OtherCompensationAmt>
</Form990PartVIISectionAGrp>
```

**Fields:** Name, title, hours/week, role flags (Officer, IndividualTrusteeOrDirector, KeyEmployee, HighestCompensatedEmployee, Former), compensation from org and related orgs.

### Common Header (Both 990 and 990-PF)

```xml
<Return returnVersion="2024v5.0">
  <ReturnHeader>
    <TaxPeriodEndDt>2024-12-31</TaxPeriodEndDt>
    <ReturnTypeCd>990PF</ReturnTypeCd>
    <Filer>
      <EIN>396057530</EIN>
      <BusinessName>
        <BusinessNameLine1Txt>JOHN OSTER FAMILY FOUNDATION INC</BusinessNameLine1Txt>
      </BusinessName>
      <USAddress>
        <CityNm>MILWAUKEE</CityNm>
        <StateAbbreviationCd>WI</StateAbbreviationCd>
        <ZIPCd>53234</ZIPCd>
      </USAddress>
    </Filer>
  </ReturnHeader>
</Return>
```

---

## Data Pipeline

```
Monthly IRS XML release (ZIP files at apps.irs.gov)
    ↓
Download index CSV → filter for new batch IDs since last run
    ↓
Download ZIP(s) → extract XML files
    ↓
Parse each XML → extract person records (donors, officers, grant recipients)
    ↓
Normalize names (first-last format → our standard)
    ↓
Store as JSON in state dir (like political matcher)
    ↓
Match against prospect CSV (shared @pm/core)
    ↓
Score + Route → client.csv + review.csv
```

---

## Architecture

### Shared from `@pm/core` (already built)
- `parsePersonName()` — name normalization (needs adaptation for first-last format)
- `buildProspectIndex()` — prospect name variant index
- `loadProspects()` / `loadProspectsDetailed()` — prospect CSV loading
- `matchEmployer()` — employer matching (for officer roles, org name ≈ "employer")
- `StateStore` — state directory management
- `createLogger()`, `loadConfig()`, `parseCsvLine()`, `escapeCsvValue()`

### New Code in `apps/nonprofit/`

```
apps/nonprofit/
├── PLAN.md                              # This file
├── RESEARCH.md                          # Research findings
├── samples/                             # Real IRS XML samples (gitignored)
│   ├── sample-990.xml
│   ├── sample-990pf.xml
│   ├── sample-990pf-2.xml
│   └── sample-990pf-with-donors.xml
├── package.json
├── tsconfig.json
├── src/
│   ├── cli/
│   │   ├── fetch.ts                     # CLI: download IRS XML batches
│   │   └── run.ts                       # CLI: match against prospects
│   ├── core/
│   │   ├── types.ts                     # Nonprofit-specific types
│   │   ├── NonprofitMatcher.ts          # Core matching engine
│   │   └── run-manifest.ts             # Run manifest helpers
│   ├── parsers/
│   │   ├── irs990-xml-parser.ts         # Parse 990 XML (Part VII officers)
│   │   └── irs990pf-xml-parser.ts       # Parse 990-PF XML (Schedule B donors, Part XV grants, Part VII officers)
│   ├── fetchers/
│   │   └── irs-bulk-fetcher.ts          # Download index CSV, ZIPs, extract XMLs
│   ├── lib/
│   │   ├── nonprofit-name-parser.ts     # Parse first-last names from 990 XML
│   │   ├── match-features.ts            # Build scoring features
│   │   ├── confidence-scorer.ts         # Score matches
│   │   └── review-router.ts            # Route to accepted/review
│   └── io/
│       └── csv-export.ts               # Write output CSVs
└── tests/
    ├── irs990pf-parser.test.ts          # Test against real XML samples
    ├── irs990-parser.test.ts
    └── matcher.integration.test.ts
```

---

## Types

```typescript
// Normalized record extracted from a 990/990-PF filing
interface NonprofitRecord {
  source: "990-PF-DONOR" | "990-PF-GRANT" | "990-PF-OFFICER" | "990-OFFICER";

  // Filing metadata
  ein: string;
  orgName: string;
  orgCity: string;
  orgState: string;
  taxPeriodEnd: string;        // "2024-12-31"
  returnVersion: string;       // "2024v5.0"
  objectId: string;            // IRS OBJECT_ID for linking back to filing

  // Person data (matched against prospects)
  personName: string;          // Raw name from XML
  personNameNormalized: string;
  firstName: string;
  lastName: string;
  middleName: string;
  suffix: string;

  // Source-specific fields
  amount: number;              // Contribution amount (donors) or grant amount or compensation
  title: string;               // Officer/director title
  role: string;                // "officer" | "director" | "trustee" | "key_employee" | "donor" | "grant_recipient"
  hoursPerWeek: number;        // For officers/directors
  purpose: string;             // Grant purpose (Part XV)

  // Address (from Schedule B contributors)
  city: string;
  state: string;
  zip: string;
}
```

---

## Parsers (Detailed)

### `irs990pf-xml-parser.ts` (~200 lines)

Parses a 990-PF XML file and extracts 3 types of records:

**1. Schedule B donors** (`ContributorInformationGrp`):
- Path: `Return > ReturnData > IRS990ScheduleB > ContributorInformationGrp`
- Extract: `ContributorPersonNm` (skip `ContributorBusinessName` — org donors, not people)
- Filter: `PersonContributionInd === "X"` (only personal contributions)
- Source type: `"990-PF-DONOR"`

**2. Part XV grants** (`GrantOrContributionPdDurYrGrp`):
- Path: `Return > ReturnData > IRS990PF > SupplementaryInformationGrp > GrantOrContributionPdDurYrGrp`
- Extract: `RecipientBusinessName`, `Amt`, `GrantOrContributionPurposeTxt`
- Not directly matchable against prospects (recipients are orgs, not people)
- But used for enrichment: "prospect's foundation gave $X to Y"
- Source type: `"990-PF-GRANT"`

**3. Part VII officers** (`OfficerDirTrstKeyEmplGrp`):
- Path: `Return > ReturnData > IRS990PF > OfficerDirTrstKeyEmplInfoGrp > OfficerDirTrstKeyEmplGrp`
- Extract: `PersonNm`, `TitleTxt`, `CompensationAmt`
- Source type: `"990-PF-OFFICER"`

### `irs990-xml-parser.ts` (~120 lines)

Parses a regular 990 XML file:

**Part VII officers** (`Form990PartVIISectionAGrp`):
- Path: `Return > ReturnData > IRS990 > Form990PartVIISectionAGrp`
- Extract: `PersonNm`, `TitleTxt`, `AverageHoursPerWeekRt`, `ReportableCompFromOrgAmt`, role flags
- Source type: `"990-OFFICER"`

### XML Parsing Approach

Use Node.js built-in or lightweight XML parser. Options:
- **`node:stream` + SAX-style parsing** — memory efficient for large files, more complex code
- **`fast-xml-parser`** (npm) — simple, parses entire XML to JS object. Files are 10-100KB each, so memory is not a concern.

**Recommendation:** Use `fast-xml-parser` for simplicity. Each XML file is small (~50KB avg). We process one at a time, not all in memory.

---

## Fetcher

### `irs-bulk-fetcher.ts` (~150 lines)

```
1. Download index CSV: apps.irs.gov/pub/epostcard/990/xml/{year}/index_{year}.csv
2. Filter for batches not yet processed (compare XML_BATCH_ID against state store)
3. For each new batch:
   a. Download ZIP: apps.irs.gov/pub/epostcard/990/xml/{year}/{BATCH_ID}.zip
   b. Extract all XMLs to temp dir
   c. Parse each XML (filter by RETURN_TYPE: 990 or 990PF)
   d. Write normalized JSON to state dir
   e. Record batch as processed in state store
4. Clean up temp files
```

**State tracking:** Store processed batch IDs in `{stateDir}/nonprofit/processed-batches.json`.

**ZIP sizes:** ~50-200MB per batch. Extract one at a time, process, delete.

---

## Matching Engine

### `NonprofitMatcher.ts` (~350 lines)

Same pattern as `PoliticalMatcher.ts`:

```
1. loadProspectsOrThrow(csvPath)     → prospect list + skip rate check
2. buildProspectIndex(prospects)     → name variant hash map
3. loadCurrentRecords()              → read parsed JSON from state dir
4. matchRecords()                    → for each record, lookup in prospect index
5. enrichMatches()                   → link officers to their foundation's grants
6. applyProspectAggregation()        → group by prospect, compute summary
7. exportCsv()                       → client.csv + review.csv
```

### Name Matching

990 names are `"JOSE M FERRER IV"` or `"Keith Stump"` (first-last, mixed case).
FEC names are `"FERRER, JOSE M IV"` (last-first, ALL CAPS).

We already have `parsePersonName()` in `@pm/core` which handles first-last format.
Need to normalize: lowercase, strip suffixes, generate variants (same as political matcher).

### Scoring

Simpler than political matcher — no employer matching needed (the org IS the context):

| Signal | Score |
|--------|-------|
| Exact name match + same state | +60 |
| Exact name match, different state | +40 |
| Nickname match + same state | +30 |
| Foundation donor ($50K+) | +20 bonus |
| Foundation donor ($5K-50K) | +10 bonus |
| Board member with compensation | +10 bonus |
| Common name penalty | -15 to -25 |

Threshold: 60+ → client.csv, below → review.csv.

---

## Output CSV Columns

| Column | Source |
|--------|--------|
| Match Confidence | Scoring engine |
| Match Quality | Verified / Likely / Review |
| Prospect Name | Prospect CSV |
| Prospect Company | Prospect CSV |
| Record Type | 990-PF-DONOR / 990-PF-OFFICER / 990-OFFICER |
| Organization Name | Filing org (foundation or nonprofit) |
| Organization EIN | Filing header |
| Person Role | donor / trustee / director / officer / key_employee |
| Title | From XML (e.g., "TRUSTEE", "Executive Dir.") |
| Amount | Contribution amount or compensation |
| Purpose | Grant purpose (for foundation grants) |
| Tax Period | Filing tax year (e.g., "2024") |
| Person City/State | From Schedule B address or org address |
| Filing ID | IRS OBJECT_ID (link to source) |
| Match Reason | Scoring explanation |

---

## Build Order

### Phase 1: Parsers + Fetcher (~4 files, ~550 lines)

1. `src/core/types.ts` — NonprofitRecord, MatchResult, types
2. `src/parsers/irs990pf-xml-parser.ts` — Parse 990-PF (donors + grants + officers)
3. `src/parsers/irs990-xml-parser.ts` — Parse 990 (officers)
4. `src/fetchers/irs-bulk-fetcher.ts` — Download index, ZIPs, extract, parse

**Test:** Parse sample XMLs from `samples/`, verify extracted records.

### Phase 2: Matching Engine (~4 files, ~500 lines)

5. `src/lib/nonprofit-name-parser.ts` — Adapt name parsing for 990 format
6. `src/lib/match-features.ts` — Build features
7. `src/lib/confidence-scorer.ts` — Score matches
8. `src/lib/review-router.ts` — Route accepted/review

### Phase 3: Core Engine + CLI (~4 files, ~500 lines)

9. `src/core/NonprofitMatcher.ts` — Orchestrator
10. `src/io/csv-export.ts` — Output CSVs
11. `src/cli/fetch.ts` — `nfund fetch` CLI
12. `src/cli/run.ts` — `nfund run --prospects=file.csv` CLI

### Phase 4: Tests (~3 files, ~200 lines)

13. `tests/irs990pf-parser.test.ts` — Parse sample XMLs
14. `tests/irs990-parser.test.ts` — Parse sample 990
15. `tests/matcher.integration.test.ts` — End-to-end test

---

## Dependencies

```json
{
  "dependencies": {
    "@pm/core": "*",
    "fast-xml-parser": "^4.x"
  }
}
```

One new dependency (`fast-xml-parser`). Everything else is shared from `@pm/core` or Node built-ins.

---

## Estimated Volumes

| Metric | Value |
|--------|-------|
| 990-PF filings per month | ~5,000-37,000 (varies by month) |
| 990 filings per month | ~13,000-74,000 (varies by month) |
| ZIP file size per batch | ~50-200MB |
| XML file size (avg) | ~30-60KB |
| Parse time per XML | ~1-5ms (fast-xml-parser) |
| Total parse time per month | ~30-120 seconds |
| Initial backfill (Nov 25 → Jan 26) | ~191K filings across 6 ZIPs |

---

## Open Decisions

1. **Backfill window:** Start with Nov 2025 → present? Or just latest month?
2. **990-EZ:** Skip entirely for now? (Small orgs, minimal officer data)
3. **Grant enrichment:** When prospect is a foundation officer, auto-attach the foundation's grants? Or separate CSV?
4. **Deduplication:** Same person appears on multiple filings — deduplicate or show all?
5. **`fast-xml-parser` vs built-in:** Confirm npm dependency is acceptable
