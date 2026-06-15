# Real Estate Matcher — Master Plan

> Canonical execution plan created March 2026. Updated March 9, 2026 with ATTOM API validation results and revised architecture.
>
> This is the sole build plan for `apps/real-estate/`.
>
> Positioning:
> - `RESEARCH.md`: market, source, and product research
> - `MASTER-PLAN.md`: canonical execution plan
> - `improvements.md`: future enrichment sources (Census, BLS)

---

## Goal

Build a real estate intelligence matcher for nonprofit advancement offices (colleges, universities) that:

1. continuously monitors nationwide property transactions via ATTOM API
2. matches property ownership changes against a prospect/alumni index (1-2M names)
3. scores matches with explainable rules
4. exports client-ready outputs with evidence and review routing

This product should surface:

- ownership change alerts — MVP: buy-side only (new owner = alumni); sell-side via prior-state diff in Phase 2
- current ownership signals
- portfolio signals (multi-property owners)
- mortgage / equity signals
- trust / LLC ownership clues
- directional capacity context from real-estate holdings

### ICP

Colleges and universities with large alumni bases (1-2M prospects). Gift officers and research ops teams use the output to identify alumni who recently bought or sold property — a strong signal of wealth and giving capacity.

---

## Canonical Thesis

The MVP must be **vendor-first** (ATTOM), not county-first. The core product is **transaction monitoring** — continuously scanning for property ownership changes nationwide and matching them against the alumni index.

### Two operational modes

**Mode 1 — Ongoing monitoring (core product)**

```text
daily ATTOM scan by county (FIPS + calendardate)
  -> get all recently updated property records with owner names
  -> classify changes vs prior-state cache (owner_change, refinance, no_change, etc.)
  -> filter to actionable changes only (suppress no-change refreshes)
  -> normalize owner names on actionable records
  -> match against local alumni/prospect name index
  -> score matches (name rarity + mailing address corroboration)
  -> alert on new matches
  -> update prior-state cache
  -> client.csv / review.csv / manifest / stats
```

This is the SEC matcher pattern applied to real estate: scan a public data feed by geography and date, classify what actually changed, then match locally.

**Mode 2 — Initial screening (one-time enrichment)**

```text
prospect CSV
  -> prospect normalization
  -> vendor fetcher (address-based lookup)
  -> cache-store
  -> source normalization
  -> owner parsing
  -> address corroboration
  -> scoring
  -> client.csv / review.csv / manifest / stats
```

For prospects with known addresses, do a one-time property lookup to establish baseline ownership data.

### Why monitoring is the core product

- Gift officers want alerts when alumni buy/sell — not a one-time static report
- Monitoring creates recurring value (daily/weekly alerts vs one-time CSV)
- Matches the SEC matcher pattern (scan feed → match locally) which is proven
- ATTOM's geography+date API makes this operationally feasible

### County data role

County bulk data is still useful, but only as:

- parser-development input
- test fixtures
- false-positive analysis data
- optional secondary ingestion later

It is not the default MVP ingestion model.

---

## Product Boundaries

### What we are building

A nationwide property transaction monitoring system that alerts when known alumni/prospects buy, sell, or refinance real estate. Part of the prospect intelligence suite alongside SEC, political, and nonprofit matchers.

### What we are not building in phase 1

- an MLS product (MLS = Multiple Listing Service — active listing data for homes currently for sale; requires broker license, expensive, and not needed for our use case since we care about completed transactions, not listings)
- a consumer property search tool
- a national county scraping system
- a full net-worth platform
- a beneficial-owner investigation product
- a map-first parcel UI

---

## Success Criteria

The MVP is good enough if it can:

1. scan ATTOM daily for property changes across US counties
2. match owner names against a 1-2M alumni index with acceptable precision
3. produce evidence-backed property match alerts
4. show signals that a prospect researcher would actually use
5. keep review volume manageable
6. run repeatably inside this monorepo without extra infrastructure
7. make vendor costs and data rights explicit

### Acceptance targets

- every accepted row has a short, defensible match reason
- name + mailing address corroboration produces materially better precision than name-only
- daily monitoring runs complete within operational time/cost budget (~75K-100K API calls/month)
- cache and manifest data make reruns reproducible
- common-name handling works standalone via name-rarity scoring + mailing address corroboration (cross-matcher corroboration is a Phase 7 precision improvement, not an MVP dependency)

---

## Operating Model

### Core: daily monitoring run

1. load alumni/prospect index (1-2M names, built once, refreshed periodically)
2. for each monitored county (FIPS code), query ATTOM for records updated since last run (page-level caching, resumable on failure)
3. cache raw ATTOM response pages
4. normalize vendor payloads into canonical `PropertyRecord`s
5. **classify changes** vs prior-state cache: owner_change, new_to_cache, refinance, assessment_update, no_change
6. filter to actionable changes only (suppress no_change and assessment_update)
7. parse owner names from actionable property records
8. match parsed owner names against the local prospect name index
9. for matches: corroborate using name rarity + owner mailing address city/state vs prospect's known location
10. score and route matches
11. update prior-state cache
12. update county watermark
13. export alert artifacts (client.csv, review.csv, manifest, stats)

### Supplementary: one-time screening run

For prospects with known addresses:

1. load prospect CSV
2. for each prospect with an address, query ATTOM by address
3. normalize, parse, score, and export as above

### Why monitoring-first is the right model

- gift officers want ongoing alerts, not static reports
- national coverage from day 1 via county FIPS codes
- same architectural pattern as SEC matcher (scan feed → match locally)
- ATTOM's geography+date endpoint makes this operationally feasible
- no need for prospect addresses (most alumni don't have addresses on file)

### Later upgrade paths (Phase 7+)

- sell-side detection via prior-state owner diff (Phase 2 of monitoring)
- cross-matcher corroboration pipeline (SEC + political + nonprofit signals for common-name resolution)
- bulk vendor ingest for historical backfill
- entity resolution beyond direct ownership heuristics
- parcel / map UX

---

## ATTOM API — Confirmed Vendor

ATTOM is the confirmed primary vendor. API key tested and working as of March 9, 2026.

### Authentication

- Header: `APIKey: <key>`
- Base URL: `https://api.gateway.attomdata.com/propertyapi/v1.0.0`
- HTTPS only
- Max 100 records per response, paginated via `page=<int>&pageSize=<int>`

### Key endpoints

#### 1. Geography + date monitoring (core endpoint)

```
GET /property/detailmortgageowner?fips={countyFips}&startcalendardate={YYYY/MM/DD}&endcalendardate={YYYY/MM/DD}
```

Returns all property records updated within the date range for a county. Each record includes:

- **Owner data**: up to 4 owners per property (`owner1`-`owner4`), each with `fullname`, `lastname`, `firstnameandmi`
- **Owner metadata**: `corporateindicator` (Y/N), `ownerrelationshiptype` (JT=joint tenancy), `absenteeownerstatus` (A=absentee, O=owner-occupied)
- **Mailing address**: `mailingaddressoneline` — the owner's mailing address (distinct from property situs)
- **Property details**: situs address, property type, use code
- **Valuation**: assessed total, estimated value (AVM)
- **Mortgage**: amount, lender, date, type
- **Last sale**: date, amount, document number

**Important**: `calendardate` is ATTOM's data publish/refresh batch date, NOT the actual transaction date. A record with `startcalendardate=2026/03/01` means ATTOM's data was refreshed on or after March 1.

**Tested volumes by county (9-day window, March 1-9 2026):**

| County | FIPS | Records |
|---|---|---:|
| DC | 11001 | 164 |
| Manhattan (NY) | 36061 | 259 |
| Harris (TX) | 48201 | 1,764 |
| San Diego (CA) | 06073 | 1,961 |
| Miami-Dade (FL) | 12086 | 3,072 |
| Maricopa (AZ) | 04013 | 3,728 |
| Los Angeles (CA) | 06037 | 10,000+ (capped) |

#### 2. Per-property expanded history

```
GET /saleshistory/expandedhistory?address1={street}&address2={city+state+zip}
```

Returns full transaction history with `buyerName` and `sellerName` for each sale. Use for deep-dive on specific properties after a monitoring match.

#### 3. Owner lookup by geography

```
GET /property/detailowner?postalcode={zip}
```

Returns current owner data for all properties in a ZIP. Useful for supplementary screening.

### What ATTOM does NOT support

- **No name-based search**: cannot query "find all properties owned by John Smith." All queries require geography (FIPS, postalcode), address, or property ID.
- **No real-time transaction feed**: data refreshes in batches (the `calendardate`), not real-time.
- **No buyer/seller names in geography scans**: the monitoring endpoint gives current owner names, not buyer/seller from the transaction itself. To get buyer/seller, you need the per-property `/saleshistory/expandedhistory` endpoint (address-based, not geography-based).

### Buy vs sell detection model

The monitoring endpoint returns **current** owner data, not transaction parties. This has direct implications:

**Buy-side detection (primary, MVP)**:
- Alumni appears as current owner on a property that wasn't in our prior-state cache → new purchase detected.
- This works naturally: scan returns owner names, we match against alumni index, new matches = buy alerts.

**Sell-side detection (requires prior-state diff)**:
- Alumni was the owner in a previous scan, but the current scan shows a different owner → alumni sold.
- This requires maintaining a prior-state cache keyed by ATTOM property ID, and diffing current owner against cached owner on each scan.
- Sell-side detection is a Phase 2 capability, not MVP. MVP only detects buy-side (new owner = alumni).

**Why NOT use `/saleshistory/expandedhistory` for sell detection**:
- That endpoint is per-property (requires address input), not geography-based.
- Calling it for every property in every county scan is an N+1 explosion (~50K-100K extra calls/day).
- The prior-state diff approach is free (local comparison, no extra API calls).

**MVP scope**: buy-side alerts only. Sell-side alerts deferred to Phase 2 via prior-state diff.

### API volume estimate for nationwide daily monitoring

Monitoring all ~3,100 US counties daily:

- Small counties (< 100 records/day): ~2,500 counties → ~2,500 calls/day
- Medium counties (100-500 records/day): ~400 counties → ~1,000 calls/day (with pagination)
- Large counties (500+ records/day): ~200 counties → ~1,500 calls/day (with pagination)
- **Total: ~2,500-3,500 API calls/day → ~75,000-100,000 calls/month**

Cost: quote-based pricing from ATTOM sales team (to be negotiated).

### Matching strategy (no prospect addresses needed)

Most alumni in a 1-2M prospect list do NOT have home addresses on file. The matching strategy:

1. **Scan by county**: query ATTOM for all records updated today in each county
2. **Parse owner names**: extract individual names from owner fields
3. **Match against alumni index**: use @pm/core name matching (exact, nickname, suffix, initial variants)
4. **Corroborate with mailing address**: ATTOM returns owner mailing city/state — compare against prospect's known city/state if available
5. **Common-name handling (MVP — standalone, no cross-matcher required)**:
   - **Name-rarity scoring**: compute rarity from the prospect index itself — if only 1 prospect has last name "Zywicki", an owner-name match is high confidence; if 47 prospects share "Smith" + "John", it's low confidence without corroboration
   - **Mailing address corroboration**: ATTOM returns owner mailing city/state — if it matches the prospect's known city/state, upgrade confidence even for common names
   - **Remaining common-name matches**: route to `review` quality tier; gift officer decides
   - Cross-matcher corroboration is a Phase 7 precision improvement that further resolves common-name ambiguity, but MVP must work without it

### Cross-matcher corroboration (Phase 7 — suite moat)

Real estate matching alone has a common-name problem at scale. The suite will eventually solve this:

- **Political matcher**: FEC data has employer + occupation for donors → confirms identity
- **SEC matcher**: EDGAR filings have company affiliations → confirms identity
- **Nonprofit matcher**: 990 data has board memberships → confirms identity
- A "John Smith" who owns property in Houston AND donated to political campaigns from Houston AND is an officer at a Houston company = high confidence match

This is a later-phase upgrade. The MVP must produce useful results without it.

---

## Primary User Workflow

### Monitoring workflow (ongoing)

```text
research ops team
  -> loads alumni/prospect index (1-2M names)
  -> runs daily monitoring scan
  -> receives alert CSV with new property matches
  -> gift officers review alerts and flag high-value prospects
  -> uses signals in briefs, qualification, and capacity review
```

### Screening workflow (one-time)

```text
gift officer / research ops team
  -> provides prospect CSV (with addresses where available)
  -> runs screening matcher
  -> receives client.csv and review.csv
  -> validates ambiguous rows
  -> uses accepted signals in briefs, qualification, and capacity review
```

### Primary deliverables

- `client.csv` — accepted matches with evidence
- `review.csv` — ambiguous matches needing human review
- `manifest.json` — run metadata (counties scanned, API calls, cache hits)
- `stats.json` — match statistics by quality band, signal type, corroboration rate

---

## MVP Scope

### Required input (for prospect index)

- prospect name (first + last minimum)

### Helpful input (improves match quality)

- city / state (for mailing address corroboration)
- aliases / former names
- spouse / partner name
- employer (for cross-matcher corroboration)

### Not required

- home address (unlike traditional screening — monitoring scans by geography, not by prospect address)

### MVP signals

Ship:

- current property ownership
- assessed and estimated value if available
- owner mailing vs situs relationship
- owner-occupied / absentee heuristic
- recent sale date and amount
- mortgage amount and lender if available
- multi-property portfolio count
- trust / LLC ownership flag

Secondary, clearly labeled as directional:

- estimated 5-year giving capacity from real-estate holdings

Defer:

- foreclosure / distress as default output
- permit / renovation data
- title-chain workflows
- MLS enrichment
- beneficial-owner resolution beyond simple heuristics

---

## Phase Plan

### Phase 0 — Decision Lock ✅ COMPLETE

Locked:

1. ✅ Primary vendor: ATTOM (API key validated, endpoints tested)
2. ✅ Budget fallback: Realie.ai + PropMix
3. ✅ Architecture: monitoring-first (geography+date scan → local name match)
4. ✅ ICP: colleges with 1-2M alumni
5. Canonical output schema — defined below
6. Pilot prospect sample — TBD (need a real alumni list)

---

### Phase 1 — Vendor Validation ✅ COMPLETE

ATTOM selected. API tested on March 9, 2026:

- ✅ Owner-name availability: full names for up to 4 owners per property
- ✅ Trust / entity coverage: `corporateindicator`, owner relationship types
- ✅ Mortgage coverage: amount, lender, date, type
- ✅ Transaction history: via `/saleshistory/expandedhistory` (per-property)
- ✅ Geography+date query: `/property/detailmortgageowner` with FIPS + calendardate
- ✅ Owner mailing addresses: `mailingaddressoneline` for corroboration
- ✅ Response consistency: tested across 7 counties with predictable volumes
- Rate limits: TBD (need to confirm with ATTOM sales)
- Cost: quote-based, need to negotiate for ~75K-100K calls/month
- Cache/redistribution rights: need legal review

---

### Phase 2 — App Skeleton

Create a new package mirroring the operational style of `apps/political`.

### Target structure

```text
apps/real-estate/
├── MASTER-PLAN.md
├── RESEARCH.md
├── improvements.md
├── package.json
├── tsconfig.json
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   ├── run.ts          # one-time screening run
│   │   ├── monitor.ts      # daily monitoring run
│   │   ├── fetch.ts
│   │   ├── inspect.ts
│   │   └── validate.ts
│   ├── core/
│   │   ├── RealEstateMatcher.ts
│   │   ├── MonitoringEngine.ts   # scan counties → match against index
│   │   ├── run-manifest.ts
│   │   └── types.ts
│   ├── fetchers/
│   │   ├── attom.ts              # ATTOM API client
│   │   ├── cache-store.ts
│   │   └── county-fixture-loader.ts
│   ├── parsers/
│   │   ├── owner-name-parser.ts
│   │   ├── address-normalizer.ts
│   │   ├── source-normalizers.ts   # ATTOM response → PropertyRecord
│   │   └── assessor-csv-parser.ts
│   ├── lib/
│   │   ├── abbreviation-expander.ts
│   │   ├── owner-entity-classifier.ts
│   │   ├── multi-owner-splitter.ts
│   │   ├── trust-name-resolver.ts
│   │   ├── address-matcher.ts
│   │   ├── match-features.ts
│   │   ├── confidence-scorer.ts
│   │   ├── review-router.ts
│   │   ├── capacity-formula.ts
│   │   └── change-classifier.ts
│   └── io/
│       └── csv-export.ts
└── tests/
    ├── fixtures/
    ├── owner-name-parser.test.ts
    ├── multi-owner-splitter.test.ts
    ├── trust-name-resolver.test.ts
    ├── address-matcher.test.ts
    ├── confidence-scorer.test.ts
    ├── capacity-formula.test.ts
    ├── source-normalizers.test.ts
    ├── change-classifier.test.ts
    ├── monitoring-engine.test.ts
    ├── cache-store.test.ts
    └── matcher.integration.test.ts
```

### CLI commands

- `monitor` — run daily monitoring scan (primary command)
- `run` — one-time screening run against prospect CSV with addresses
- `fetch` — fetch ATTOM data for specific counties/addresses
- `inspect` — inspect cached ATTOM responses
- `validate` — validate prospect CSV format

### Exit criteria

- package compiles
- CLI boots
- config can load
- tests can run

---

### Phase 3 — Canonical Data Model

Normalize every source into one internal schema before matching.

### Core types

```ts
export interface PropertyRecord {
  source: "attom" | "county_fixture";
  sourcePropertyId: string;
  parcelId?: string;
  countyFips?: string;
  county?: string;

  situsAddress: string;
  situsCity?: string;
  situsState?: string;
  situsZip?: string;

  ownerRaw: string;
  ownerRaw2?: string;
  ownerType: OwnerType;
  parsedOwners: ParsedOwner[];

  ownerMailingAddress?: string;
  ownerMailingCity?: string;
  ownerMailingState?: string;
  ownerMailingZip?: string;

  propertyType?: string;
  useCode?: string;

  assessedLand?: number;
  assessedImprovement?: number;
  assessedTotal?: number;
  estimatedValue?: number;

  lastSaleDate?: string;
  lastSalePrice?: number;
  isArmsLength?: boolean;
  mortgageAmount?: number;
  mortgageLender?: string;

  isOwnerOccupied?: boolean;
  isAbsenteeOwner?: boolean;
  transactionHistory?: PropertyTransaction[];
  raw?: unknown;
}

export type OwnerType =
  | "individual"
  | "joint"
  | "trust"
  | "llc"
  | "corporation"
  | "estate"
  | "unknown";

export interface ParsedOwner {
  raw: string;
  normalized: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  role?: "trustee" | "manager" | "co_owner";
  extractedFrom: "direct" | "co_owner" | "trust_name" | "trustee_field";
}

export interface PropertyTransaction {
  date?: string;
  type?: string;
  amount?: number;
  parties?: string[];
  documentNumber?: string;
  isArmsLength?: boolean;
}

export interface PropertySignal {
  tier: 1 | 2 | 3;
  signal: string;
  detail: string;
  action: string;
}

export interface CapacityEstimate {
  fiveYearCapacity: number;
  primaryResidenceValue: number;
  additionalPropertyValue: number;
  totalPropertyValue: number;
  totalMortgage: number;
  equityRatio: number;
  mortgageBonus: boolean;
  propertyCount: number;
}

export interface AddressMatchResult {
  status: "exact" | "strong" | "partial" | "zip_only" | "city_state" | "mismatch";
  confidence: number;
  matchedAgainst: "situs" | "mailing" | "both" | "none";
}

export interface MatchFeatures {
  nameExact: boolean;
  nameNickname: boolean;
  nameSuffixStripped: boolean;
  nameMiddleDropped: boolean;
  nameInitialVariant: boolean;
  nameTrustExtracted: boolean;
  nameCoOwner: boolean;
  nameFuzzyHigh: boolean;
  nameFuzzyMedium: boolean;
  nameLastOnly: boolean;
  addressStatus: AddressMatchResult["status"];
  stateMatch: boolean;
  isCommonName: boolean;
  portfolioCorroborationCount: number;
}

export interface MatchScoreResult {
  combinedScore: number;
  quality: "high" | "medium" | "low" | "review";
}

export interface PropertyMatch {
  prospectId: string;
  prospectName: string;
  property: PropertyRecord;
  matchedOwner: ParsedOwner;
  nameScore: number;
  addressScore: number;
  combinedScore: number;
  quality: "high" | "medium" | "low" | "review";
  matchReasons: string[];
  signals: PropertySignal[];
  estimatedCapacity5yr?: number;
}
```

### Rule

Vendor-specific payloads must not leak into scoring or export logic.

### Notes

- `situsCity`, `situsState`, and `situsZip` remain optional because vendor payloads are inconsistent; when they are absent, the address layer should parse and decompose `situsAddress`.
- `parseOwnerName()` should return an empty array for pure LLC / corporation records rather than emitting partially structured entity pseudo-owners.
- Use `quality` consistently for the categorical tier and `combinedScore` for the numeric score.

### Exit criteria

- canonical types finalized
- one vendor normalizer implemented

---

### Phase 4 — Matching Core

This is the main product engine. Two modes share the same scoring/routing pipeline.

### Reuse from `@pm/core`

- `loadProspects()`
- `buildProspectIndex()` — builds the name lookup index from 1-2M alumni
- `parsePersonName()`
- `generateNameVariants()` — nickname, suffix, initial variants
- `NICKNAME_LOOKUP` — 53 nickname groups
- `StateStore`

### New modules

1. `abbreviation-expander.ts`
2. `owner-entity-classifier.ts`
3. `multi-owner-splitter.ts`
4. `trust-name-resolver.ts`
5. `owner-name-parser.ts`
6. `address-normalizer.ts`
7. `address-matcher.ts`
8. `match-features.ts`
9. `confidence-scorer.ts`
10. `review-router.ts`
11. `capacity-formula.ts`
12. `change-classifier.ts` — classifies what changed vs prior state (owner_change, refinance, assessment_update, no_change)
13. `MonitoringEngine.ts` — orchestrates the daily scan loop

### Monitoring flow (primary)

#### Stage 1 — Build prospect index (once, then refresh)

- load 1-2M alumni/prospect records
- normalize names, build variants
- build in-memory name index for fast lookup

#### Stage 2 — Scan counties

- for each monitored county FIPS code:
  - query ATTOM `/property/detailmortgageowner?fips={fips}&startcalendardate={lastRun}&endcalendardate={today}`
  - paginate through all results (100/page), cache each page individually
  - track pagination state for resumability

#### Stage 3 — Property normalization

- convert ATTOM payload to canonical `PropertyRecord`
- derive absentee / owner-occupied from `absenteeownerstatus`
- map `ownerrelationshiptype` (JT=joint tenancy, etc.)

#### Stage 3.5 — Change classification (calendardate ≠ event)

`calendardate` is ATTOM's batch refresh date, NOT the actual transaction date. A record appearing in a scan could be:

- a genuine new purchase (owner name changed)
- a mortgage refinance (mortgage fields changed, owner same)
- an assessment update (assessed value changed, nothing else)
- a data correction or periodic refresh (no meaningful change)

Without change classification, we would alert on every refreshed record — flooding gift officers with non-events.

**Change classifier rules**:

1. **First-time seen**: property ID not in prior-state cache → classify as `new_to_cache` (not necessarily a new purchase — could be first scan of this county)
2. **Owner changed**: property ID exists in cache, but current owner name ≠ cached owner name → classify as `owner_change` (strong buy-side signal)
3. **Sale fields changed**: same owner, but `lastSaleDate` or `lastSalePrice` changed → classify as `sale_update`
4. **Mortgage changed**: same owner, but mortgage amount/lender changed → classify as `refinance`
5. **Assessment only**: same owner, only assessed/estimated value changed → classify as `assessment_update` (suppress from alerts)
6. **No meaningful change**: same owner, same sale, same mortgage, same assessment → classify as `no_change` (suppress)

**MVP alert triggers**: only `owner_change` and `new_to_cache` (with the understanding that `new_to_cache` on first scan of a county is not actionable — it just seeds the cache).

**Prior-state cache**: keyed by ATTOM property ID (`identifier.attomId`), stores: owner names, last sale date/price, mortgage amount, assessed total. Updated after each scan.

#### Stage 4 — Owner parsing

- classify entity type using `corporateindicator` + name patterns
- expand abbreviations (TTEE, TR, ETUX, etc.)
- split multi-owner strings (up to 4 owners per property)
- parse owner names (ATTOM provides `fullname`, `lastname`, `firstnameandmi`)
- resolve trust-derived person candidates

#### Stage 5 — Name matching

- for each parsed owner name, look up in the prospect index
- match types: exact, nickname, suffix-stripped, middle-dropped, initial-variant, fuzzy
- on match: pull prospect record for corroboration

#### Stage 6 — Corroboration scoring

Score based on (MVP — all standalone, no cross-matcher dependency):

- name match strength (exact > nickname > fuzzy)
- name rarity in the prospect index (rare name = higher confidence)
- owner mailing address city/state vs prospect's known city/state
- portfolio corroboration (same prospect matches multiple properties)
- common-name penalty (applied when both first and last name are high-frequency in the index)
- change type from Stage 3.5 (`owner_change` > `new_to_cache` for scoring purposes)

#### Stage 7 — Review routing

- `high` — strong name + corroborated location
- `medium` — strong name, no location data to confirm
- `low` — weaker name match with some corroboration
- `review` — common name, no corroboration

### Screening flow (supplementary)

Same pipeline from Stage 3 onward, but Stage 2 is replaced by:
- query ATTOM by prospect address (for prospects with known addresses)

### Exit criteria

- monitoring run works end to end on a test set of counties
- accepted matches are explainable
- daily monitoring completes within API budget

---

### Phase 5 — Output Design

### `client.csv`

- Prospect ID
- Prospect Name
- Match Quality
- Combined Score
- Match Reason
- Owner Name on Record
- Ownership Type
- Property Address
- Property City
- Property State
- Owner Mailing Address
- Owner-Occupied Flag
- Property Type
- Assessed Value
- Estimated Value
- Last Sale Date
- Last Sale Amount
- Mortgage Amount
- Lender
- Property Count for Prospect
- Signal
- Action
- Source Vendor
- Source Property ID / APN

### `review.csv`

Everything in `client.csv` plus:

- parser notes
- conflicting evidence
- why quality was capped

### `manifest.json`

- run timestamp
- source vendor
- prospect count
- fetch count
- cache hit rate
- accepted count
- review count
- thresholds
- version / commit SHA if available

### `stats.json`

- prospects with any match
- accepted by quality band
- accepted by signal type
- address-assisted match rate
- average candidates per prospect

---

### Phase 6 — Pilot and Validation

### Test sets

Build three sets:

1. known-match set
2. common-name stress set
3. trust / LLC set

### Required tests

- unit tests for parser modules
- address matcher tests
- source normalizer tests
- scorer tests
- CSV export tests
- integration test with mocked vendor responses

### Pilot workflow

1. run on 100-250 prospects
2. manually review accepted and review rows
3. measure precision and review burden
4. adjust thresholds and routing

### Exit criteria

- pilot demonstrates value
- no major vendor or licensing blocker
- review load is acceptable

---

### Phase 7 — Scale

Only after pilot success:

- optimize county scan scheduling (prioritize high-volume counties, batch small counties)
- add historical backfill for counties where monitoring started late
- add cross-matcher corroboration pipeline (consume SEC/political/nonprofit match data)
- consider persistent local property store for longitudinal tracking
- negotiate ATTOM volume pricing for production scale

---

## Detailed Engineering Build Order

This is the implementation order the engineer should follow.

### Step 0 — Package skeleton

Create:

- `package.json`
- `tsconfig.json`
- root workspace scripts
- `src/cli/index.ts`

Recommended package dependencies:

```json
{
  "dependencies": {
    "@pm/core": "workspace:*",
    "@zerodep/address-parse": "^2.x",
    "cmpstr": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^22.x"
  }
}
```

### Step 1 — Types

File:

- `src/core/types.ts`

Implement canonical source, owner, match, signal, and capacity types.

### Step 2 — Owner parsing foundation

Files:

- `src/lib/abbreviation-expander.ts`
- `src/lib/owner-entity-classifier.ts`
- `src/lib/multi-owner-splitter.ts`
- `src/lib/trust-name-resolver.ts`
- `src/parsers/owner-name-parser.ts`

This is the hardest novel logic.

### Step 3 — Address normalization and comparison

Files:

- `src/parsers/address-normalizer.ts`
- `src/lib/address-matcher.ts`

### Step 4 — Source normalization (ATTOM)

Files:

- `src/fetchers/attom.ts` — ATTOM API client (auth, pagination, rate limiting)
- `src/parsers/source-normalizers.ts` — ATTOM response → canonical PropertyRecord
- `src/fetchers/cache-store.ts`

`source-normalizers.ts` maps ATTOM's response shape to canonical `PropertyRecord`s:

- `owner.owner1.fullname` / `lastname` / `firstnameandmi` → `parsedOwners`
- `owner.corporateindicator` → `ownerType` hint
- `owner.absenteeownerstatus` (A/O) → `isAbsenteeOwner` / `isOwnerOccupied`
- `owner.mailingaddressoneline` → `ownerMailingAddress` (parse into city/state/zip)
- `address.*` → situs address fields
- `assessment.assessed.*` → assessed values
- `avm.amount.value` → `estimatedValue`
- `sale.*` → last sale data
- `mortgage.amount` / `lender` / `date` → mortgage fields
- preserve the original payload under `raw`
- coerce string numerics and dates into normalized types
- derive `isArmsLength` when deed type or sale amount suggests arm's-length

### Step 5 — Scoring and routing

Files:

- `src/lib/match-features.ts`
- `src/lib/confidence-scorer.ts`
- `src/lib/review-router.ts`
- `src/lib/capacity-formula.ts`

Tests for Steps 2-5 should be written alongside those modules, not deferred until the end. Step 9 is the consolidation checkpoint for the full fixture set and integration coverage.

### Step 6 — Core matcher + monitoring engine

Files:

- `src/core/RealEstateMatcher.ts` — one-time screening matcher
- `src/core/MonitoringEngine.ts` — daily monitoring orchestrator

`RealEstateMatcher.ts` responsibilities:

- load prospects
- build prospect index
- call fetcher (address-based)
- normalize records
- score matches
- aggregate by prospect
- produce run result

`MonitoringEngine.ts` responsibilities:

- load prospect index (1-2M names)
- iterate through county FIPS codes
- query ATTOM for records updated since last run (with page-level caching and resume)
- classify changes vs prior-state cache
- filter to actionable changes (suppress no_change, assessment_update)
- normalize and parse owner names on actionable records
- match against prospect index
- score and route matches (name rarity + mailing address corroboration)
- update prior-state cache and county watermarks
- produce alert artifacts

### Step 7 — Export

Files:

- `src/io/csv-export.ts`
- `src/core/run-manifest.ts`

### Step 8 — CLI

Files:

- `src/cli/monitor.ts` — **primary command**: daily monitoring scan
- `src/cli/run.ts` — one-time screening run
- `src/cli/fetch.ts` — manual ATTOM fetch for specific counties/addresses
- `src/cli/inspect.ts` — inspect cached responses and prior-state
- `src/cli/validate.ts` — validate prospect CSV format

`monitor.ts` is the most important CLI command. It wires together the MonitoringEngine, cache-store, change-classifier, and export pipeline.

### Step 9 — Tests and fixtures

Files:

- `tests/owner-name-parser.test.ts`
- `tests/multi-owner-splitter.test.ts`
- `tests/trust-name-resolver.test.ts`
- `tests/address-matcher.test.ts`
- `tests/confidence-scorer.test.ts`
- `tests/capacity-formula.test.ts`
- `tests/source-normalizers.test.ts`
- `tests/change-classifier.test.ts` — tests for all 6 change types (owner_change, new_to_cache, sale_update, refinance, assessment_update, no_change)
- `tests/monitoring-engine.test.ts` — integration test: mocked ATTOM pages → change classification → name matching → alert output
- `tests/cache-store.test.ts` — page-level caching, partial scan resume, watermark tracking
- `tests/matcher.integration.test.ts`

These tests should not be written only at the end. Unit tests for each module should be written alongside the step that introduces that module, then consolidated in Step 9.

---

## County Bulk Data: Correct Role

County bulk data is valuable, but its role must stay narrow in MVP.

### Use county data for

- building parser fixtures
- validating multi-owner and trust parsing
- stress-testing common-name logic
- regression tests
- optional later county import support

### Do not use county data as

- the default runtime ingestion path
- the definition of the canonical source model
- the gating proof of product-market usefulness

### Example fixture sources

- DC CAMA
- NYC PLUTO
- Cook County

### Engineering implication

Keep county parser code isolated behind:

- `county-fixture-loader.ts`
- `assessor-csv-parser.ts`

It should support tests and optional later ingestion, not dictate the MVP architecture.

---

## Function-Level Guidance

These are the critical function shapes to implement first.

### Abbreviation expander

```ts
export const ABBREVIATIONS: Record<string, string>;
export function expandAbbreviations(raw: string): { cleaned: string; found: string[] };
```

Minimum dictionary:

- `TTEE` -> `TRUSTEE`
- `TR` -> `TRUSTEE`
- `TRS` -> `TRUSTEES`
- `TRST` -> `TRUST`
- `JTRS` -> `JOINT_TENANTS_ROS`
- `ETUX` -> `AND_WIFE`
- `ETVIR` -> `AND_HUSBAND`
- `ETAL` -> `AND_OTHERS`
- `DECD` -> `DECEASED`
- `EST` -> `ESTATE`
- `FBO` -> `FOR_BENEFIT_OF`
- `AKA` -> `ALSO_KNOWN_AS`
- `DBA` -> `DOING_BUSINESS_AS`

### Owner entity classifier

```ts
export function classifyOwnerEntity(raw: string): OwnerType;
```

Rules:

- `TRUST`, `TRST`, `REVOCABLE`, `IRREVOCABLE`, `FAMILY TRUST` -> `trust`
- `LLC`, `L.L.C.` -> `llc`
- `INC`, `CORP`, `CORPORATION`, `LP`, `LTD` -> `corporation`
- `ESTATE OF`, `EST OF`, `DECD` -> `estate`
- `&`, `AND`, `ETUX`, `ETVIR` -> `joint` unless clearly entity-like
- otherwise -> `individual`

### Multi-owner splitter

```ts
export function splitMultiOwner(raw: string, ownerType: OwnerType): string[];
```

Rules:

1. do not split entities
2. split on space-delimited `&` or `AND`
3. propagate surname when second owner omits it

### Trust resolver

```ts
export function extractFromTrustName(raw: string): ParsedOwner[];
```

Support patterns like:

- `SMITH JOHN A TTEE`
- `JOHN A SMITH REVOCABLE TRUST`
- `THE SMITH FAMILY TRUST`

### Owner parser

```ts
export function parseOwnerName(raw: string): ParsedOwner[];
```

Pipeline:

1. normalize case and spacing
2. strip care-of
3. classify owner entity
4. resolve trust names if needed
5. split co-owners
6. parse LAST-FIRST owner strings
7. return parsed owners

### Address matcher

```ts
export function compareAddresses(
  prospectAddress: string | undefined,
  propertyAddresses: { situs?: string; mailing?: string }
): AddressMatchResult;
```

Use component matching, not raw string comparison.

If structured situs fields are absent, parse `situsAddress` first and compare components against the prospect address and owner mailing address.

### Source normalizers

```ts
export function normalizeAttomProperty(payload: AttomPropertyResponse): PropertyRecord;
```

Responsibilities:

- map ATTOM owner fields (`owner1`-`owner4` with `fullname`, `lastname`, `firstnameandmi`, `corporateindicator`, `ownerrelationshiptype`, `absenteeownerstatus`) into canonical owner fields
- map `mailingaddressoneline` → parse into city/state/zip for corroboration
- map assessment, AVM, sale, and mortgage fields into canonical fields
- parse ATTOM-specific date formats and string numerics
- preserve source IDs (`identifier.attomId`) and the original payload
- avoid inventing data for missing structured fields

### Change classifier

```ts
export type ChangeType =
  | "owner_change"      // owner name differs from prior state — strong buy signal
  | "new_to_cache"      // property ID not seen before — first scan or new record
  | "sale_update"       // same owner, but lastSaleDate/Price changed
  | "refinance"         // same owner, mortgage amount/lender changed
  | "assessment_update" // same owner, only assessed/estimated value changed
  | "no_change";        // no meaningful field differences

export interface PriorStateRecord {
  attomPropertyId: string;
  ownerNames: string[];       // owner1-4 fullname values
  lastSaleDate?: string;
  lastSalePrice?: number;
  mortgageAmount?: number;
  assessedTotal?: number;
  lastSeen: string;           // ISO date of last scan that included this record
}

export function classifyChange(
  current: PropertyRecord,
  prior: PriorStateRecord | undefined
): ChangeType;
```

Rules (evaluated in order, first match wins):

1. `prior === undefined` → `new_to_cache`
2. any current owner name ≠ any prior owner name → `owner_change`
3. current `lastSaleDate` ≠ prior `lastSaleDate` OR current `lastSalePrice` ≠ prior `lastSalePrice` → `sale_update`
4. current `mortgageAmount` ≠ prior `mortgageAmount` → `refinance`
5. current `assessedTotal` ≠ prior `assessedTotal` → `assessment_update`
6. else → `no_change`

MVP alert triggers: `owner_change` and `new_to_cache` only (with the caveat that `new_to_cache` on the very first scan of a county seeds the cache but should not generate alerts — use a `firstScanForCounty` flag).

### Confidence scorer

```ts
export function scoreMatch(features: MatchFeatures): MatchScoreResult;
```

Scoring weights:

| Feature | Weight |
|---|---:|
| `nameExact` | 50 |
| `nameNickname` | 40 |
| `nameSuffixStripped` | 45 |
| `nameMiddleDropped` | 42 |
| `nameInitialVariant` | 43 |
| `nameTrustExtracted` | 35 |
| `nameCoOwner` | 30 |
| `nameFuzzyHigh` | 30 |
| `nameFuzzyMedium` | 20 |
| `nameLastOnly` | 15 |
| `addressStatus === "exact"` | 45 |
| `addressStatus === "strong"` | 35 |
| `addressStatus === "partial"` | 20 |
| `addressStatus === "zip_only"` | 10 |
| `addressStatus === "city_state"` | 5 |
| `stateMatch === false` | -20 |
| `isCommonName === true` | -10 |

Portfolio corroboration rule:

- add a modest bonus when the same prospect matches multiple properties with consistent owner-mailing evidence

Common-name detection strategy (standalone — no cross-matcher dependency):

- **name-rarity scoring from prospect index**: compute frequency of each first name and last name in the actual prospect set. If only 1 prospect has last name "Zywicki", a match is high-signal. If 47 prospects share "Smith" + "John", apply penalty.
- supplement with a hardcoded list of high-frequency US surnames (Smith, Johnson, Williams, etc.) as a fallback for small prospect sets
- apply the penalty when both the normalized first and last name are overly common
- common-name matches with mailing address corroboration can still reach `medium` quality; without corroboration they land in `review`

Map `combinedScore` to `quality`:

- `high`
- `medium`
- `low`
- `review`

Thresholds:

- `>= 80` -> `high`
- `60-79` -> `medium`
- `40-59` -> `low`
- `< 40` -> `review`

See [RESEARCH.md](/Users/swajanjain/Documents/Projects/sec-prospect-matcher/apps/real-estate/RESEARCH.md) section 8.3 for the original weight rationale.

### Match features

```ts
export function buildMatchFeatures(args: {
  prospect: ProspectRecord;
  property: PropertyRecord;
  matchedOwner: ParsedOwner;
  addressMatch: AddressMatchResult;
  isCommonName: boolean;
  portfolioCorroborationCount: number;
}): MatchFeatures;
```

This module should isolate feature extraction from score calculation so the scorer stays deterministic and easy to tune.

### Capacity formula

```ts
export function estimateGivingCapacity(
  properties: Array<{
    value: number;
    isOwnerOccupied: boolean;
    mortgageAmount?: number;
  }>
): CapacityEstimate;
```

Rules:

1. identify primary residence as the highest-value owner-occupied property
2. treat all remaining properties as additional properties
3. apply tiered multipliers:
   - primary: `< $500K` -> `5%`, `$500K-$999,999` -> `7.5%`, `$1M+` -> `10%`
   - additional: `< $500K` -> `7.5%`, `$500K-$999,999` -> `10%`, `$1M+` -> `15%`
4. mortgage bonus: if total mortgages are `<= 50%` of total property value, add `5%` to the final capacity estimate
5. return the full `CapacityEstimate` structure, not just the final number

High-cost-of-living adjustment:

- explicitly defer metro-based discounting to a later phase
- MVP should output raw directional capacity without BWF-style geographic discount tiers

---

## Testing Strategy

### Fixture strategy

Use two fixture classes:

1. **mocked vendor responses**
   - for end-to-end runtime path
2. **county owner-string samples**
   - for parser realism, scorer fixtures, and regression

Development/test path:

```text
county bulk samples
  -> parser fixtures
  -> scorer fixtures
  -> integration fixtures
  -> false-positive regression tests
```

Use county-derived fixture sets not only to test parsing correctness but also to test scoring calibration:

- known true positives
- known false positives
- common-name stress cases
- trust / LLC ambiguity cases

### Minimum assertions

Tests should be added alongside the parsing, matching, scoring, and normalization modules as they are written, not saved for the final integration step.

- parser extracts direct individuals correctly
- parser does not hallucinate people from LLC strings
- trust names produce lower-quality but still useful candidates
- address match improves quality appropriately
- common names are penalized
- scorer tiers land in the expected quality bucket
- exported rows contain evidence fields

---

## Vendor Strategy

### Confirmed primary: ATTOM

- API key: active (stored in `.env` as `ATTOM_API_KEY`)
- Tested endpoints: `/property/detailmortgageowner`, `/property/detailowner`, `/saleshistory/expandedhistory`
- Data quality: owner names are full and structured, mortgage and valuation data present
- Geography+date monitoring: confirmed working via FIPS + calendardate
- Pricing: quote-based — need to contact ATTOM sales for ~75K-100K calls/month volume

### Budget fallback

- Realie.ai + PropMix (not yet tested)

### Optional later enrichments

- Census ACS API — ZIP-level median income for HCOL adjustment (see `improvements.md`)
- BLS Occupational Outlook — salary by occupation for capacity corroboration (see `improvements.md`)
- Geocodio or Census geocoder
- OpenCorporates
- Regrid for parcel geometry

### Outstanding vendor tasks

1. Contact ATTOM sales for volume pricing quote (~75K-100K calls/month)
2. Confirm caching and redistribution rights
3. Confirm rate limits at production volume
4. Review contract for compliance with FCRA and privacy requirements

---

## Config and Secrets

### Environment variables

```text
ATTOM_API_KEY=...          # ATTOM Data API key (required)
GEOCODIO_API_KEY=...       # optional, for future geocoding enrichment
```

### Config fields

- monitored county FIPS codes (or "all")
- scan frequency (daily default)
- last-run date per county
- fetch page size (default 100, ATTOM max)
- cache directory
- scoring thresholds
- review thresholds
- output directory
- prospect index source path

---

## Caching and State

Caching is not optional. ATTOM calls cost money and have rate limits.

### Required behavior

- **Page-level caching**: cache each ATTOM response page individually, not just county+date
- **Resumable pagination**: if a scan fails mid-pagination (e.g., page 15 of 38), resume from the last successful page without re-fetching pages 1-14
- **Record-level dedup**: key by ATTOM property ID (`identifier.attomId`) to handle records that appear in overlapping date ranges
- **Watermark tracking**: track last-run date per county with scan-completion status (not just "started")
- **Prior-state store**: maintain property-level cache for change classification (see Stage 3.5)
- Preserve manifests and stats for each monitoring run
- Support resumable runs through `StateStore`
- Separate raw cache from normalized outputs

### Cache key model

```text
Raw API responses:  {fips}/{startDate}_{endDate}/page-{n}.json
Scan manifest:      {fips}/{startDate}_{endDate}/scan-manifest.json
                    → { totalPages: 38, completedPages: [1..38], status: "complete"|"partial" }
Prior-state:        prior-state/{attomPropertyId}.json
                    → { ownerNames, lastSaleDate, lastSalePrice, mortgageAmount, assessedTotal, lastSeen }
County watermark:   county-state/watermarks.json
                    → { "11001": { lastCompleted: "2026-03-09", lastStarted: "2026-03-10", status: "complete" } }
```

### Retry and idempotence rules

- A county scan is only marked `complete` when ALL pages have been fetched and cached
- A `partial` scan can be resumed: read scan-manifest, fetch only missing pages
- If a full re-run is triggered for a date range that has a `complete` scan, skip it entirely
- Prior-state records are updated only after the full scan completes (not per-page) to maintain consistency

### Suggested layout

```text
state/real-estate/
  cache/
    attom/
      {fips}/
        {startDate}_{endDate}/
          page-1.json
          page-2.json
          ...
          scan-manifest.json
  prior-state/
    {attomPropertyId}.json
  county-state/
    watermarks.json
  runs/
    YYYY-MM-DD_HHMMSS/
      manifest.json
      stats.json
      client.csv
      review.csv
```

---

## Metrics

Track from the first pilot:

- counties scanned per run
- property records processed per run
- ATTOM API calls made (track against budget)
- cache hit rate
- owner names parsed
- names matched against prospect index
- accepted matches (by quality band)
- review matches
- common-name flags
- mailing-address corroboration rate
- cross-matcher corroboration rate (when available)
- cost per matched prospect
- cost per county scanned

---

## Legal and Compliance

Needs explicit review before customer-facing use.

### Required workstream

1. vendor licensing and redistribution
2. privacy-law implications
3. FCRA positioning and wording
4. suppression / protected-address edge cases
5. customer-facing language for directional capacity outputs

### Product rule

Never present real-estate-derived capacity as factual wealth. It is a directional analytic based on public-record property data.

---

## Risks

### Data risks

- `calendardate` is ATTOM's batch refresh date, not actual transaction date — mitigated by change-classifier (Stage 3.5) that diffs against prior state to identify real changes vs data refreshes
- incomplete mortgage coverage in some counties
- incomplete disclosed sale prices (non-disclosure states)
- county inconsistency hidden by vendor normalization
- ATTOM caps responses at 100/page — mitigated by page-level caching with resumable pagination

### Matching risks

- **Common-name collisions**: with 1-2M prospects and name-only matching, false positives on "John Smith" etc. are inevitable without corroboration
- Family members with same names (parent/child)
- Entity-only ownership (corporate indicator = Y) — no individual name to match
- Weak trust-name clues
- Mailing address may not match prospect's known address (e.g., P.O. box, business address)

### Product risks

- ATTOM pricing at 75K-100K calls/month may be prohibitive
- Review burden too high for common-name matches without cross-matcher corroboration
- Users over-trust derived capacity numbers
- Rate limits may prevent completing daily scan within 24 hours

### Mitigations

- visible evidence in every row
- review routing by default, especially for common names
- standalone common-name handling via name-rarity scoring + mailing address corroboration (MVP works without cross-matcher)
- cross-matcher corroboration as Phase 7 precision improvement
- pilot before scale (start with a few counties, not all 3,100)
- aggressive caching — never re-fetch same county+date range
- cost tracking from day 1
- prioritize counties by prospect density (scan counties where alumni actually live first)

---

## Immediate Next Steps

Phases 0 and 1 are complete. Execute these next:

1. ~~create vendor-eval.md~~ ✅ ATTOM confirmed
2. ~~test ATTOM API~~ ✅ endpoints validated, volumes measured
3. contact ATTOM sales for volume pricing (~75K-100K calls/month)
4. scaffold `apps/real-estate` (Phase 2 — package.json, tsconfig, CLI skeleton)
5. implement ATTOM fetcher with geography+date query + pagination
6. implement source normalizer (ATTOM response → PropertyRecord)
7. implement owner name parser pipeline
8. build MonitoringEngine: scan counties → parse owners → match against prospect index
9. pilot on 5-10 counties with a real alumni list
10. measure precision, review volume, and API cost before scaling

The critical path is: **ATTOM fetcher → source normalizer → owner parser → name matching against prospect index → MonitoringEngine orchestrator**.

If execution follows this plan, the team avoids the two main failure modes:

- building the wrong architecture too early
- staying so high-level that coding never starts
