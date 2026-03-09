# Political Funding Prospect Matcher — Engineering Plan

## Table of Contents

1. [Problem Definition](#1-problem-definition)
2. [Product Requirements (from PM)](#2-product-requirements-from-pm)
3. [Data Strategy: Recent Data, Not Historical](#3-data-strategy-recent-data-not-historical)
4. [Architecture Overview](#4-architecture-overview)
5. [Data Sources & Fetching](#5-data-sources--fetching)
6. [Matching Strategy](#6-matching-strategy)
7. [Enrichment: Committee & Candidate Resolution](#7-enrichment-committee--candidate-resolution)
8. [False Positive Handling](#8-false-positive-handling)
9. [Signal Classification & Actions](#9-signal-classification--actions)
10. [Output CSV Design](#10-output-csv-design)
11. [Future: Vercel Dashboard](#11-future-vercel-dashboard)
12. [Hardware Constraints](#12-hardware-constraints)
13. [Testing Strategy](#13-testing-strategy)
14. [File-by-File Implementation Spec](#14-file-by-file-implementation-spec)
15. [Run Playbook](#15-run-playbook)

---

## 1. Problem Definition

### What We're Building

A **daily CLI tool** that fetches the latest US political contribution data (last 7 days) and matches it against a prospect list to surface:

- **Every individual donation** a prospect made recently
- **Who they gave to** (candidate name, party, office)
- **How much** they gave
- **Partisan lean** (extrapolated from giving pattern)
- **Recommended action** for the gift officer

### Who Uses It

Gift officers and prospect research teams at nonprofits (schools like Phillips Academy). They receive a **structured, high-signal CSV** they can act on immediately — or pass directly to their clients.

### Product Trajectory

```
Phase 1 (NOW):   CLI tool → CSV output → test with 1-2 clients
Phase 2 (IF OK):  Vercel dashboard → good design, good UX, auto-updating
Phase 3 (SCALE):  Integrate into core product → all paying clients
```

### How This Differs from SEC Matcher

| Dimension | SEC Matcher | Political Matcher |
|-----------|------------|------------------|
| Question answered | "Did they just get liquid?" | "Did they just give political money? To whom?" |
| Time window | All available filings | **Last 7 days only** (recent activity) |
| Data sources | SEC EDGAR filings | FEC + State + 527 + Lobbying (4 sources) |
| Data structure | Unstructured .txt with XML/HTML | Structured API responses / pipe-delimited files |
| Matching approach | Aho-Corasick free-text search | Hash-map lookup on name + employer |
| Output granularity | 1 filing = 1 signal | **Every individual donation listed** |
| Run frequency | Periodic batch | **Daily** |

---

## 2. Product Requirements (from PM)

### Confirmed Decisions

| Question | Answer |
|----------|--------|
| Time window | **Last 7 days from today** — latest activity only, not historical |
| Data sources in MVP | **All four**: Federal (FEC) + State (FollowTheMoney) + 527 (IRS) + Lobbying (LDA) |
| Prospect list fields | **Name + Company only** (no city/state/ZIP) |
| Prospect volume | 10,000 to 100,000+ |
| False positive tolerance | Accept 10 wrong in 100 real — **never miss a real match** |
| Match without company? | **Yes** — name-only matching when company is missing |
| Employer mismatch? | **Include but flag it** — "FEC employer differs from prospect company" |
| Output granularity | **Every individual donation** (not just aggregated profiles) |
| Partisan lean | **Yes** — extrapolate from giving pattern |
| Candidate/PAC detail | **Yes, very important** — who the money went to |
| Gift officer actions | **Yes** — recommend what to do |
| Run frequency | **Once daily** (CLI) |
| Output format | **CSV** (structured, high-signal, client-ready) |
| Future UI | **Vercel dashboard** with good design/UX (if CLI succeeds) |
| Current clients | 1-2 test clients → integrate into core product if successful |

### Core Principle

> "Don't do fuzzy all-vs-all matching. Block cheaply, score precisely, and only send high-confidence matches to the client CSV."

---

## 3. Data Strategy: Recent Data, Not Historical

### The Fundamental Shift

The original plan was to download multi-GB bulk files and stream through 60M+ records. The PM's requirement changes everything:

**Old approach:** Download entire election cycles → stream all records → match → aggregate profiles
**New approach:** Fetch only recent data (last 7 days) from 4 APIs/sources → match → output individual donations

### How Each Source Gets "Last 7 Days" Data

| Source | Method | Freshness | What we get |
|--------|--------|-----------|-------------|
| **FEC (Federal)** | OpenFEC API with `min_date` filter | Days to weeks lag (see below) | Individual contributions to federal candidates/PACs |
| **State** | FollowTheMoney API with date filter | Varies by state | State-level contributions |
| **527 Orgs** | IRS bulk download (updates Sundays) | Weekly | Contributions to 527 political orgs |
| **Lobbying** | Senate LDA API with date filter | Semiannual filings | Lobbyist political contributions |

### Critical Reality: FEC Data Lag

**Contributions are NOT reported in real-time.** Here's how it actually works:

1. Prospect donates $3,500 to a candidate on March 1
2. The candidate's committee files a quarterly report on April 15 (due 20 days after quarter end)
3. FEC processes the filing over the next few days
4. The contribution appears in the API / bulk data around April 18-25
5. **Lag: 6-8 weeks from donation to data availability**

**What "last 7 days" actually means:** The last 7 days of data APPEARING in the system — not the last 7 days of donations being made. We fetch contributions that the FEC recently processed and made available, regardless of when the actual donation happened.

**For the OpenFEC API:** We use the `min_date` / `max_date` parameters on the `/schedules/schedule_a/` endpoint. But these filter on `contribution_receipt_date` (when the donation was made), NOT when it appeared in the system.

**Better approach for "what's new":** Use the bulk file approach — download the current cycle's `itcont.txt` weekly (updated Sundays), diff against the previous week's version, and process only new records (new SUB_IDs). This gives us exactly "what appeared since last run."

### Recommended Hybrid Strategy

```
WEEKLY (Sunday night):
  1. Download fresh itcont.txt for current cycle (indiv26.zip)
  2. Download fresh cm26.txt, cn26.txt, ccl26.txt
  3. Download fresh IRS 527 skeda.txt
  4. Diff against previous versions → extract new records only
  5. Store new records in local data/recent/ folder

DAILY (every morning):
  1. Load prospect list
  2. Load recent records (from Sunday's diff)
  3. Fetch FollowTheMoney API for recent state contributions
  4. Fetch LDA API for recent lobbyist contributions
  5. Match all against prospects
  6. Output CSV
```

This hybrid approach is more reliable than pure API fetching because:
- Bulk files are complete (API can miss records during processing)
- No rate limit concerns for the main FEC data
- 527 data has NO API (bulk only)
- Weekly download is ~2-6GB but we only process the diff (~few thousand new records)

### What We Saw In A Real 100-Row OpenFEC Sample

We fetched and inspected a real 100-row OpenFEC sample before writing the execution plan. Key takeaways:

- `contribution_receipt_date` can be null even on valid rows
- `load_date` is populated but cannot be used as a sort field in this endpoint
- `candidate_name` is often null because many receipts go to PACs/committees, not directly to candidate-linked committees
- employer variation is real even within a single employer:
  - `APPLIED MATERIALS, INC.`
  - `APPLIED MATERIALS, INC`
  - `APPLIED MATERIALS`
  - `APPLIED MATERIALS INC`
  - `APPLIED MATERIALS INC.`

Implication: confidence cannot rely on a single field, and recipient enrichment must treat the committee as the primary truth.

---

## 4. Architecture Overview

```
political-funding/
│
├── run-matcher.js                    # CLI entry point (daily run)
├── fetch-data.js                     # Data fetcher (weekly + daily)
│
├── PoliticalMatcher.js               # Core matching engine
│   ├── loadProspects(csvPath)
│   ├── loadCommittees(cmPath)
│   ├── loadCandidates(cnPath)
│   ├── matchContributions(records)
│   └── exportCsv(path)
│
├── lib/
│   ├── name-parser.js                # FEC "LAST, FIRST MIDDLE JR" → normalized
│   ├── name-index.js                 # Prospect name variants + hash index
│   ├── employer-matcher.js           # Prospect company ↔ FEC employer
│   ├── match-features.js             # Build scoring features per candidate pair
│   ├── confidence-scorer.js          # 0-100 confidence + quality label
│   ├── review-router.js              # accepted / review / rejected routing
│   ├── signal-classifier.js          # Tier + action assignment
│   └── partisan-lean.js              # Extrapolate partisan lean from giving
│
├── fetchers/
│   ├── fec-fetcher.js                # Download + diff FEC bulk data
│   ├── fec-api-fetcher.js            # OpenFEC API for incremental updates
│   ├── state-fetcher.js              # FollowTheMoney API
│   ├── irs527-fetcher.js             # IRS 527 bulk download + diff
│   └── lda-fetcher.js                # Senate LDA API
│
├── parsers/
│   ├── fec-individual-parser.js      # Parse itcont.txt (pipe-delimited)
│   ├── fec-committee-parser.js       # Parse cm.txt
│   ├── fec-candidate-parser.js       # Parse cn.txt
│   └── irs527-parser.js              # Parse skeda.txt
│
├── data/                             # Local data cache (gitignored)
│   ├── current/                      # Latest bulk files
│   ├── previous/                     # Previous week's bulk files (for diff)
│   └── recent/                       # Extracted new records
│
├── matches/                          # Output CSVs (gitignored)
│
├── RESEARCH.md
├── PLAN.md                           # This file
└── package.json
```

### Data Flow

```
                  ┌─────────────┐
                  │ Prospects   │
                  │ CSV         │ (Name + Company)
                  └──────┬──────┘
                         │
                         ▼
               ┌──────────────────────┐
               │ Build Blocking Index │
               │                      │
               │ normalized full name │
               │ + exact variants     │
               │ + nickname variants  │
               └──────┬───────────────┘
                      │
    ┌─────────────────┼──────────────────┐
    ▼                 ▼                  ▼
┌──────────┐   ┌──────────┐     ┌──────────────┐
│ Committee│   │ Candidate│     │  Linkage     │
│ Master   │   │ Master   │     │  File        │
│ cm.txt   │   │ cn.txt   │     │  ccl.txt     │
└────┬─────┘   └────┬─────┘     └──────┬───────┘
     └───────┬──────┴──────────────────┘
             ▼
   ┌────────────────────┐
   │ Enrichment Map     │  ← CMTE_ID → committee truth
   │                    │     + candidate context (optional)
   └────────┬───────────┘
            │
   ┌────────┴───────────────────────────────────────────────┐
   │                                                       │
   │ For each normalized contribution record:              │
   │  1. Parse contributor name                            │
   │  2. Exact-name block lookup (O(1))                    │
   │  3. Generate candidate prospect pairs only on hit     │
   │  4. Score candidate pairs:                            │
   │     - name agreement                                  │
   │     - employer evidence                               │
   │     - ambiguity/common-name penalty                   │
   │     - multi-row consistency                           │
   │  5. Assign match quality + confidence                 │
   │  6. Route to output bucket                            │
   │     - client CSV (high confidence)                    │
   │     - review CSV (ambiguous)                          │
   │     - reject stats only                               │
   │                                                       │
   └──────────────────┬────────────────────────────────────┘
                      │
                      ▼
           ┌──────────────────────────┐
           │ Outputs                  │
           │                          │
           │ client.csv   = accepted  │
           │ review.csv   = ambiguous │
           │ stats/report = rejected  │
           └──────────────────────────┘
```

### Why This Scales

For 100K prospects, the expensive mistake would be fuzzy all-vs-all matching. We do NOT do that.

- Build prospect name variants once
- Hash by normalized full name
- For each incoming row, look up a tiny candidate set
- Score only those candidate pairs

Complexity is roughly:

```
O(prospect_variants) + O(input_rows) + O(candidate_pairs_after_blocking)
```

not:

```
O(prospects × input_rows)
```

That architecture is scalable for:
- 100K prospects
- 10K-100K recent rows in seconds to low tens of seconds
- million-row backfills as stream/batch jobs

---

## 5. Data Sources & Fetching

### 5.1 FEC Federal Contributions (Primary)

**Two fetching strategies (both needed):**

#### Strategy A: Weekly Bulk Diff (Reliable, Complete)

```
Every Sunday night:
1. Download indiv26.zip from S3
2. Extract itcont.txt
3. Compare SUB_IDs against previous week's file
4. Extract new records → data/recent/fec-new.txt
5. Archive current → data/previous/
```

**Pros:** Complete data, no rate limits, catches everything
**Cons:** Weekly granularity (not truly daily), multi-GB download

#### Strategy B: Daily API Fetch (Fresher, Smaller)

```
Every morning:
1. Call OpenFEC /schedules/schedule_a/ with:
   - min_date = 7 days ago
   - is_individual = true
   - per_page = 100
   - Paginate through all results using keyset pagination
2. Store results in data/recent/fec-api-{date}.json
```

**API details:**
- Free key: 1,000 requests/hour (100K records/hour at 100/page)
- Elevated key: 7,200 requests/hour (email FEC to request)
- Key signup: `https://api.data.gov/signup/`
- Keyset pagination: use `last_index` + `last_contribution_receipt_date` from response

**Pros:** Fresher data (daily), smaller payloads
**Cons:** Rate limited, `min_date` filters on contribution date not filing date, full-text name search is fuzzy

**Recommendation:** Use Strategy A (weekly bulk diff) as the reliable baseline, supplemented by Strategy B (daily API) for mid-week freshness.

### 5.2 State Contributions (FollowTheMoney)

```
Every morning:
1. Call FollowTheMoney Ask Anything API
2. Filter by recent date (d-ludte parameter for last-updated)
3. Process results for each state
```

**API access:** Free account at followthemoney.org → API key in account settings
**Documentation:** PDF at https://www.followthemoney.org/assets/FollowTheMoney-API.pdf
**Coverage:** All 50 states, since 2000

**WARNING:** Site is in maintenance mode (merged with OpenSecrets). May be sunsetted. Build integration to be easily replaceable.

### 5.3 IRS 527 Organizations

```
Every Sunday (updates weekly at 1 AM):
1. Download skeda.txt from https://forms.irs.gov/app/pod/dataDownload/dataDownload
2. Diff against previous version
3. Extract new contribution records
```

**Format:** Pipe-delimited (same as FEC)
**Fields:** Contributor name, address, employer, occupation, amount, date
**No API** — bulk download only
**Key value:** Unlimited contributions. Captures mega-donors FEC data misses.

### 5.4 Senate LDA Lobbying Contributions

```
Every morning (or after semiannual filing deadlines):
1. Call https://lda.senate.gov/api/v1/contributions/
2. Filter by contribution_date_from = 7 days ago
3. Process LD-203 contribution records
```

**Auth:** Free API key from https://lda.senate.gov/api/register/
**Rate limit:** 120 requests/minute (authenticated)
**Frequency:** Semiannual filings (Jan 30, Jul 30) — new data bursts twice per year
**Universe:** ~13,000 active lobbyists (small but very high-value)
**MIGRATION:** Moving to LDA.gov by June 2026

---

## 6. Matching Strategy

### Core Approach: Exact-Name Blocking + Pair Scoring

FEC data is structured. We do not need Aho-Corasick, and we do not want expensive fuzzy matching across the full table.

The correct execution model is:

1. Normalize prospect names and build an in-memory blocking index
2. Normalize each incoming donor row
3. Look up exact-name candidates in O(1)
4. Score only those candidate pairs
5. Route each pair to accepted / review / reject

### Step-by-Step Per Record

```javascript
// 1. Parse the record's name
const parsed = parseFecName(record.NAME);
// "SMITH, JOHN A JR" → { firstName: "john", lastName: "smith", normalized: "john smith" }

// 2. Blocking lookup in prospect index (O(1))
const prospects = prospectIndex[parsed.normalized];
if (!prospects) continue;

// 3. Score each candidate pair
for (const prospect of prospects) {
  const features = buildMatchFeatures(prospect, record, historyForName);
  const confidence = scoreMatch(features); // 0-100
  const decision = routeMatch(features, confidence); // accepted | review | reject
  emit(decision, prospect, record, features, confidence);
}
```

### Confidence Is An Identity Score, Not A Signal Score

`match_confidence` answers one question only:

> "How likely is it that this donor row belongs to this prospect?"

It does NOT mean:
- how politically important the gift is
- how much the donor gave
- how interesting the row is to a gift officer

Those are separate signal fields.

### Name Variant Generation (Reused from SEC Matcher)

Each prospect generates ~10-15 name variants in the hash index:

```
Prospect: "William Smith III"
Variants indexed:
  "william smith"        (base, suffix stripped)
  "bill smith"           (nickname: William → Bill)
  "will smith"           (nickname: William → Will)
  "billy smith"          (nickname: William → Billy)
  "wm smith"             (abbreviation)
  "william smith iii"    (with suffix, for exact match)
```

Reuses directly from UnifiedMatcher.js:
- `NICKNAME_GROUPS` (93 groups: Bill↔William, Bob↔Robert, etc.)
- `NICKNAME_LOOKUP` (reverse map)
- `NAME_SUFFIXES_RE` (Jr, Sr, II, III, IV, MD, PhD, Esq)
- `_generateProspectNameVariants()` logic

### Match Features Used For Confidence

The score must be based on actual fields present in FEC data, not hand-wavy intuition.

#### A. Name Agreement

- exact normalized full-name match
- exact first+last match
- nickname match
- middle-name / middle-initial agreement
- suffix agreement / conflict

#### B. Employer Evidence

- exact employer-root match
- alias/containment match
- partial overlap (weak)
- non-informative employer (`RETIRED`, `SELF-EMPLOYED`, `INFORMATION REQUESTED`, blank)
- active employer conflict

#### C. Ambiguity / Common-Name Risk

- count of candidate prospects sharing the blocked name
- count of donor rows seen for the same normalized full name
- rare full names should score higher than common full names

#### D. Multi-Row Consistency

- repeated rows over time with the same name + same employer
- repeated rows with the same name but conflicting employers

### Employer Matching Rules

| Scenario | Action | Confidence | Output Note |
|----------|--------|------------|-------------|
| Prospect company matches FEC employer (root match) | Include | HIGH (90-98%) | "Employer confirmed: Google" |
| Prospect company matches FEC employer (containment) | Include | HIGH (85-95%) | "Employer confirmed: Google Inc → Google" |
| Prospect company matches FEC employer (first word only / weak token overlap) | Review | LOW-MEDIUM | "Weak employer overlap: Goldman → Goldman Sachs" |
| Prospect has company, FEC employer is different | Review or Reject | LOW | "Employer mismatch: prospect=Google, FEC=Microsoft" |
| Prospect has company, FEC employer is RETIRED/SELF-EMPLOYED/N/A | Review | MEDIUM | "FEC employer non-informative: RETIRED" |
| Prospect has NO company | Review | MEDIUM-LOW | "No prospect company to verify" |
| FEC has no employer field | Review | MEDIUM-LOW | "FEC employer missing" |

**Key principle:** do not export every name hit to the client CSV. Keep recall internally, but require confidence thresholds for client-visible output.

### Name-Only Matching (When Company is Missing)

When a prospect has no company in the CSV:
- Match on name only
- Apply a higher false-positive risk score
- Short names (≤3 chars first or last) get flagged as high-risk
- Common names ("John Smith", "Mary Johnson") get flagged
- Still include in output — mark as "Name-only match, no employer verification possible"

---

## 7. Enrichment: Committee & Candidate Resolution

Every FEC contribution goes to a committee (CMTE_ID). We resolve this to a human-readable recipient.

### Lookup Tables (Loaded into Memory)

```javascript
// Load once at startup:
committees  = loadCm('cm26.txt');   // Map<cmteId, { name, party, type, candId, ... }>
candidates  = loadCn('cn26.txt');   // Map<candId, { name, party, office, state, ... }>
linkages    = loadCcl('ccl26.txt'); // Map<cmteId, candId> (supplementary)

// Build enrichment map:
// For each committee → attach candidate info if available
enrichedCommittees = new Map();
for (const [cmteId, cmte] of committees) {
  const candId = cmte.candId || linkages.get(cmteId);
  const candidate = candId ? candidates.get(candId) : null;
  enrichedCommittees.set(cmteId, {
    committeeName: cmte.name,
    party: cmte.party || candidate?.party || 'UNK',
    candidateName: candidate?.name || null,
    candidateOffice: candidate?.office || null, // H/S/P
    candidateState: candidate?.state || null,
    committeeType: cmte.type, // H/S/P/N/Q/O/X/Y/Z
  });
}
```

### What Gets Added to Each Output Record

```
"$3,500 to C00703975"
  → "$3,500 to BIDEN FOR PRESIDENT (Joseph Biden, DEM, President)"

"$5,000 to C00000935"
  → "$5,000 to DNC SERVICES CORP (Democratic National Committee, DEM, Party)"

"$1,000 to C00764449"
  → "$1,000 to AMERICANS FOR PROSPERITY ACTION (Super PAC, REP-leaning)"
```

### Partisan Lean (Per Prospect)

When a prospect has multiple donations, extrapolate their lean:

```javascript
function computePartisanLean(donations) {
  let dem = 0, rep = 0;
  for (const d of donations) {
    const party = enrichedCommittees.get(d.cmteId)?.party;
    if (party === 'DEM') dem += d.amount;
    else if (party === 'REP') rep += d.amount;
  }
  const total = dem + rep;
  if (total === 0) return 'Unknown';
  const demPct = (dem / total) * 100;
  if (demPct >= 80) return 'Strong D';
  if (demPct >= 60) return 'Lean D';
  if (demPct >= 40) return 'Mixed';
  if (demPct >= 20) return 'Lean R';
  return 'Strong R';
}
```

---

## 8. False Positive Handling

### Philosophy: Keep Recall Internally, Keep Trust Externally

We do not silently discard plausible matches. But we also do not send every name hit to the client CSV.

Every candidate pair ends in one of three buckets:

- `Accepted` → client CSV
- `Review` → internal review CSV
- `Rejected` → stats/logs only

### Confidence Scoring

Confidence must be data-grounded and calibratable. We will not hard-code arbitrary numbers and pretend they are probabilities.

#### Two Output Columns

- `Match Confidence` → numeric `0-100`
- `Match Quality` → categorical label derived from the score and evidence

#### What Drives Match Confidence

| Feature Group | Examples | Effect |
|---------------|----------|--------|
| Name agreement | exact full name, nickname-only, middle initial agreement/conflict | strong positive or negative |
| Employer evidence | exact employer match, weak overlap, non-informative employer, active mismatch | strongest practical non-name evidence |
| Ambiguity | rare name vs common name, number of candidate prospects for same blocked name | large penalty on common names |
| Multi-row consistency | repeated same-employer rows across time | positive |
| Multi-row conflict | same name linked to multiple employers | negative |

#### Initial Rule-Based Score (Before Calibration)

Start with a deterministic score so the system is usable immediately:

| Rule | Score Impact |
|------|--------------|
| exact normalized full name | +45 |
| nickname-only first-name match | +20 |
| middle initial/full middle name agrees | +10 |
| middle name conflicts | -15 |
| suffix agrees | +5 |
| suffix conflicts | -10 |
| exact employer-root match | +35 |
| employer alias/containment match | +25 |
| weak employer overlap | +10 |
| employer non-informative or missing | -5 |
| active employer conflict | -35 |
| common name penalty (medium) | -10 |
| common name penalty (high) | -20 |
| repeated consistent rows | +5 to +15 |
| repeated conflicting rows | -10 to -25 |

Clamp final score to `0-100`.

#### Then Calibrate With Labeled Data

Before trusting the score operationally, build a labeled set from real prospects:

1. sample real prospects across rare/medium/common names
2. collect candidate donor rows from FEC
3. label each pair as `same person`, `not same person`, or `uncertain`
4. fit a simple model (logistic regression is enough)
5. map raw score → calibrated probability

The rule-based score gets us shipping. The labeled calibration makes `95%` actually mean something.

### Match Quality Labels

| Label | Condition | What it tells the reader |
|-------|-----------|--------------------------|
| **Verified** | Confidence ≥ 90 with strong employer support | High confidence — safe for client CSV |
| **Likely Match** | Confidence 75-89 | Good match, but still worth spot-checking on high-value rows |
| **Review Needed** | Confidence 40-74 | Plausible but ambiguous — review CSV only |
| **Low Confidence** | Confidence < 40 | Do not export to client CSV |

### Explicit Client/Review Split Rule

This is the primary routing rule for outputs:

- `Client CSV`:
  - `match_confidence >= 75`
  - and `guardrail_status = pass`
- `Review CSV`:
  - all other matched rows that are not pre-match skips
- `Rejected`:
  - non-person rows, memo rows, malformed rows, and other records skipped before scoring

This means a row with score `76` still does **not** go to the client CSV if a hard guardrail is triggered.

### Hard Guardrails For Client Visibility

These rules block client-visible output even if the numeric score is otherwise high:

1. Active employer conflict
   - Example: prospect company `Google`, FEC employer `Microsoft`
2. Extreme name ambiguity
   - Example: very common full name with many matching donor rows and no strong disambiguator
3. Nickname-only match without strong employer support
   - Example: prospect `Bill Smith`, FEC donor `WILLIAM SMITH`, employer blank

Guardrail result is an explicit field in the internal pipeline:

- `pass`
- `blocked_employer_conflict`
- `blocked_extreme_ambiguity`
- `blocked_weak_nickname_match`

### Hard Skip Rules (Don't Even Process)

These are the ONLY records we skip before matching:
1. NAME has no comma (organization, not individual)
2. NAME is empty or < 3 characters
3. MEMO_CD = 'X' (memo item, would double-count)
4. ENTITY_TP is present and is not 'IND' (committee-to-committee transfer)

Records can still be `rejected after scoring` even if they pass the pre-match filters.

---

## 9. Signal Classification & Actions

### For Individual Donations (Each Row)

| Amount | Gift Officer Action |
|--------|-------------------|
| $3,500 (max to candidate) | "Maxed out to [Candidate] — high-capacity donor, proven willingness to give at legal maximum" |
| $1,000 - $3,499 | "Significant political donation to [Candidate] — capacity signal" |
| $500 - $999 | "Moderate political donation — engaged donor" |
| $200 - $499 | "Political donation on record — emerging capacity" |

### For Aggregated Prospect Profiles (When Multiple Donations)

If the same prospect appears multiple times in the 7-day window:

| Tier | Trigger | Action |
|------|---------|--------|
| **Tier 1: High-Capacity** | $10K+ total in the window, OR maxed out to 3+ candidates | "High-capacity political donor. Multiple recent donations totaling $X. Call now." |
| **Tier 2: Active** | 2+ donations in the window, $1K-$10K total | "Actively giving politically. Recent donations to X recipients." |
| **Tier 3: Single Donation** | One donation in the window | "Recent political donation: $X to [Recipient]." |

### Special Flags

| Flag | Trigger | Note |
|------|---------|------|
| Max-Out Donor | Gave $3,500 to any candidate | "Gives at maximum legal level" |
| Lobbyist | Matched in LDA data | "Registered lobbyist — politically connected" |
| 527 Donor | Matched in IRS 527 data | "Gives to unlimited-donation political orgs" |
| State Donor | Matched in FollowTheMoney | "Also active in state-level politics" |
| Multi-Source | Matched in 2+ data sources | "Active across federal + state/527/lobbying" |

---

## 10. Output CSV Design

### Single CSV (Client-Ready)

Every row = one individual donation. One prospect may appear in multiple rows.

| # | Column | Source | Example |
|---|--------|--------|---------|
| 1 | Match Confidence | Matching | `95` |
| 2 | Match Quality | Matching | `Verified` / `Likely Match` / `Review Needed` / `Low Confidence` |
| 3 | Prospect Name | Prospect CSV | `John Smith` |
| 4 | Prospect Company | Prospect CSV | `Google` |
| 5 | Data Source | Fetcher | `FEC` / `State` / `527` / `Lobbying` |
| 6 | Donation Amount | Record | `$3,500.00` |
| 7 | Donation Date | Record | `2026-02-28` |
| 8 | Recipient | Enrichment | `Biden for President` |
| 9 | Recipient Type | Enrichment | `Presidential Campaign` / `PAC` / `Super PAC` / `Party` |
| 10 | Party | Enrichment | `DEM` / `REP` / `Other` |
| 11 | Candidate Name | Enrichment | `Joseph Biden` |
| 12 | Candidate Office | Enrichment | `President` / `Senate - CA` / `House - NY-14` |
| 13 | FEC Employer | Record | `GOOGLE INC` |
| 14 | FEC Occupation | Record | `SOFTWARE ENGINEER` |
| 15 | Employer Match | Matching | `Confirmed` / `Likely` / `Non-informative` / `Mismatch` / `Missing` |
| 16 | Donor City/State | Record | `Mountain View, CA` |
| 17 | Partisan Lean | Aggregation | `Lean D` (across all donations if multiple) |
| 18 | Signal Tier | Classification | `1` / `2` / `3` |
| 19 | Action | Classification | `"High-capacity: maxed out to Biden. Call now."` |
| 20 | Match Reason | Matching | `exact_name+exact_employer` / `exact_name+missing_employer` / `common_name+conflict` |
| 21 | Flags | Classification | `Max-Out Donor, Multi-Source` |

**Sort order:** Signal Tier ASC, then Match Confidence DESC, then Donation Amount DESC.

**Design principle:** A gift officer reads row by row. Each row is self-contained — they know exactly who gave what to whom, whether we're confident it's the right person, and what to do about it.

### Two CSV Outputs

- `political_matches_client_*.csv`
  - `Verified` and `Likely Match` only
  - implemented as: `match_confidence >= 75` and `guardrail_status = pass`
- `political_matches_review_*.csv`
  - `Review Needed` and `Low Confidence`
  - plus any rows blocked by hard guardrails despite scoring `>= 75`

This preserves recall without poisoning the client-facing file.

---

## 11. Future: Vercel Dashboard

If the CLI tool succeeds with 1-2 clients, we build a web dashboard on Vercel.

### Concept

- Daily auto-updating (CLI runs on a cron, pushes results to a database)
- Gift officers log in, see their prospect matches
- Good design, good UX — "they know what to do there"
- Filter by tier, sort by amount, search by prospect name
- Click a prospect → see all their recent donations in a clean card layout
- Export to CSV still available

### Tech Stack (Likely)

- **Frontend:** Next.js on Vercel
- **Database:** Vercel Postgres or Supabase
- **Auth:** Simple team-based login
- **Data pipeline:** CLI tool runs daily (cron/GitHub Actions) → writes to DB → dashboard reads

This is Phase 2. Not in scope for current CLI implementation.

---

## 12. Hardware Constraints

### Target Machine: Apple M1, 8GB RAM

| Resource | Budget | Notes |
|----------|--------|-------|
| Prospect index | ~20-50MB | 10K-100K prospects × ~10 variants each |
| Committee lookup | ~5MB | ~25K committees |
| Candidate lookup | ~3MB | ~15K candidates |
| Recent records (7 days) | ~10-100MB | Much smaller than full cycle — only new records |
| API responses | ~1-10MB | State + LDA data for 7 days |
| Output accumulation | ~10-50MB | Expected ~100-5,000 matches |
| **Total working memory** | **~50-200MB** | Well within 8GB |

**Key insight:** The "last 7 days" approach is dramatically lighter than bulk processing. We're working with thousands of recent records, not millions of historical ones. Everything fits comfortably in memory — no streaming required for recent data.

**Exception:** The weekly bulk diff (downloading full itcont.txt to extract new records) still needs streaming for the initial diff. But this runs once per week, not daily.

---

## 13. Testing Strategy

### Test Data

1. **Synthetic prospects:** Create 10-20 prospects with known FEC records (search fec.gov, pick real donors)
2. **Small FEC sample:** First 100K lines of itcont.txt for fast iteration
3. **Known matches:** Manually verify 5-10 matches end-to-end

### Test Cases

| Category | Test | Expected |
|----------|------|----------|
| Name parsing | "SMITH, JOHN A JR" | `{ firstName: "john", lastName: "smith" }` |
| Name parsing | "O'BRIEN, MARY KATE" | `{ firstName: "mary", lastName: "o'brien" }` |
| Name parsing | "DE LA CRUZ, MARIA" | `{ firstName: "maria", lastName: "de la cruz" }` |
| Name parsing | "" (empty) | null (skip) |
| Name parsing | "ACME CORPORATION" (no comma) | null (skip org) |
| Name matching | Prospect "Bill Smith", FEC "SMITH, WILLIAM" | Match via nickname |
| Name matching | Prospect "John Smith III", FEC "SMITH, JOHN III" | Match via suffix strip |
| Employer matching | Prospect "Google", FEC "GOOGLE INC." | Confirmed (root: "google") |
| Employer matching | Prospect "Google", FEC "RETIRED" | Likely Match (non-informative) |
| Employer matching | Prospect "Google", FEC "MICROSOFT" | Review Needed (mismatch — include but flag) |
| Employer matching | Prospect company is empty | Name Only match |
| Memo skip | MEMO_CD = 'X' | Record skipped |
| Negative amount | TRANSACTION_AMT = -500 | Included as refund/adjustment; handled correctly in totals |
| Enrichment | CMTE_ID = C00703975 | Resolves to "Biden for President, DEM, President" |
| Partisan lean | 3 donations: 2 DEM ($7K), 1 REP ($1K) | "Strong D" |
| Multi-source | Same prospect in FEC + FollowTheMoney | Both rows appear, flagged "Multi-Source" |

### Validation

1. Run against small FEC sample → manually inspect every match
2. Spot-check high-confidence matches against fec.gov website
3. Run against real prospect list → review Tier 1 matches with client
4. Compare match rate against expectations (with 10K prospects and 7 days of data, expect ~50-500 matches)

---

## 14. File-by-File Implementation Spec

### 14.1 `package.json`

```json
{
  "name": "political-funding-matcher",
  "version": "1.0.0",
  "description": "Match prospects against recent US political contribution data",
  "main": "run-matcher.js",
  "scripts": {
    "start": "node run-matcher.js",
    "fetch": "node fetch-data.js",
    "fetch-and-match": "node fetch-data.js && node run-matcher.js"
  },
  "dependencies": {
    "csv-parser": "^3.0.0",
    "csv-writer": "^1.6.0"
  }
}
```

No external dependencies for matching (no Aho-Corasick needed). Only csv-parser for reading prospect CSV and csv-writer for output.

### 14.2 `fetch-data.js` (~200-300 lines)

Data fetcher. Two modes:

```
node fetch-data.js --weekly     # Download bulk files, extract diffs
node fetch-data.js --daily      # Fetch from APIs (FEC, State, LDA)
```

Responsibilities:
- Download FEC bulk files (weekly) or call OpenFEC API (daily)
- Call FollowTheMoney API for state data
- Download IRS 527 skeda.txt (weekly)
- Call LDA API for lobbying contributions
- Write recent records to `data/recent/`

### 14.3 `run-matcher.js` (~100-150 lines)

CLI entry point:

```
node run-matcher.js --prospects=/path/to/prospects.csv
```

Orchestrates: load prospects → load lookups → load recent data → match → classify → export CSV.

### 14.4 `PoliticalMatcher.js` (~450-650 lines)

Core engine:

```
constructor()
loadProspects(csvPath) → count
loadCommittees(cmPath) → count
loadCandidates(cnPath) → count
buildEnrichmentMap()
buildNameAmbiguityStats(records)
matchContributions(records) → matches[]
classifyAndScore(matches) → enrichedMatches[]
exportCsv(path, matches)
printStats()
```

### 14.5 `lib/name-parser.js` (~80 lines)

### 14.6 `lib/match-features.js` (~120-180 lines)

Builds the feature object used for scoring:

```javascript
{
  exactFullName: true,
  nicknameOnly: false,
  middleMatch: true,
  suffixConflict: false,
  employerStatus: 'exact',
  nameFrequencyBucket: 'low',
  repeatedConsistentRows: 3,
  repeatedConflictingRows: 0
}
```

### 14.7 `lib/confidence-scorer.js` (~120-180 lines)

Converts features into:

```javascript
{
  matchConfidence: 93,
  matchQuality: 'Verified',
  matchReason: 'exact_name+exact_employer'
}
```

### 14.8 `lib/review-router.js` (~60-100 lines)

Routes rows to:

- accepted
- review
- rejected

```
parseFecName(rawName) → { firstName, lastName, middleName, normalized, raw } | null
```

### 14.6 `lib/name-index.js` (~200 lines)

Ports `_generateProspectNameVariants()`, `NICKNAME_GROUPS`, `NICKNAME_LOOKUP`, `NAME_SUFFIXES_RE` from UnifiedMatcher.js.

```
buildProspectIndex(prospects) → { prospectIndex, prospectById }
```

### 14.7 `lib/employer-matcher.js` (~120 lines)

```
matchEmployer(prospectCompany, fecEmployer) → { status, note, confidence }
```

Status: `"confirmed"` | `"likely"` | `"mismatch"` | `"no_data"`

### 14.8 `lib/signal-classifier.js` (~100 lines)

```
classifyDonation(amount, recipient) → { tier, action }
classifyProspectAggregate(donations) → { tier, action, flags, partisanLean }
```

### 14.9 `lib/partisan-lean.js` (~50 lines)

```
computePartisanLean(donations, enrichmentMap) → "Strong D" | "Lean D" | "Mixed" | "Lean R" | "Strong R" | "Unknown"
```

### 14.10 `fetchers/fec-fetcher.js` (~150 lines)

Weekly bulk download + diff logic.

### 14.11 `fetchers/fec-api-fetcher.js` (~100 lines)

Daily OpenFEC API fetch with keyset pagination.

### 14.12 `fetchers/state-fetcher.js` (~100 lines)

FollowTheMoney API integration.

### 14.13 `fetchers/irs527-fetcher.js` (~100 lines)

IRS 527 bulk download + diff.

### 14.14 `fetchers/lda-fetcher.js` (~100 lines)

Senate LDA API integration.

### 14.15 `parsers/fec-individual-parser.js` (~60 lines)

Parse itcont.txt pipe-delimited records.

### 14.16 `parsers/fec-committee-parser.js` (~50 lines)

Parse cm.txt → Map<cmteId, committee>.

### 14.17 `parsers/fec-candidate-parser.js` (~50 lines)

Parse cn.txt → Map<candId, candidate>.

### 14.18 `parsers/irs527-parser.js` (~60 lines)

Parse skeda.txt pipe-delimited records.

---

## 15. Run Playbook

### Step 0: Setup

```bash
cd political-funding
npm install

# Get FEC API key (free, instant):
# Visit https://api.data.gov/signup/
# Save key in .env file: FEC_API_KEY=your_key_here

# Get FollowTheMoney account (free):
# Visit https://www.followthemoney.org/ → create myFollowTheMoney account
# Save key in .env file: FTM_API_KEY=your_key_here

# Get LDA API key (free):
# Visit https://lda.senate.gov/api/register/
# Save key in .env file: LDA_API_KEY=your_key_here
```

### Step 1: Initial Data Fetch

```bash
# First run — download bulk files + fetch recent API data
node fetch-data.js --weekly    # Downloads FEC bulk + IRS 527
node fetch-data.js --daily     # Fetches FEC API + State + LDA
```

### Step 2: Run Matcher

```bash
node run-matcher.js --prospects=/path/to/prospects.csv
```

Output goes to `matches/political-matches-{date}.csv`.

### Step 3: Daily Routine

```bash
# Every morning:
node fetch-data.js --daily && node run-matcher.js --prospects=/path/to/prospects.csv

# Every Sunday night (cron or manual):
node fetch-data.js --weekly
```

### Step 4: Review Output

Open the CSV. Sorted by Signal Tier (highest first), then Confidence. Each row is one donation — self-contained, actionable.

---

## Summary: Why This Design

| Decision | Rationale |
|----------|-----------|
| Last 7 days, not historical | PM requirement: "latest political funding." Keeps data volume tiny and processing fast. |
| All 4 sources in MVP | PM requirement: federal + state + 527 + lobbying. More signal = more value for client. |
| Hash map, not Aho-Corasick | FEC data is structured (explicit NAME field). O(1) lookup per record. Simpler, faster. |
| Include all matches, flag mismatches | PM requirement: "never miss a match." Employer mismatches are flagged, not rejected. |
| Every donation as a row | PM requirement: "see every individual donation." Not just aggregated profiles. |
| Single client-ready CSV | PM requirement: "CSV goes directly to paying client." No debug CSV — the main CSV IS the product. |
| Weekly bulk + daily API hybrid | Reliability (bulk is complete) + freshness (API catches mid-week). Best of both. |
| Partisan lean extrapolation | PM approved. Computed from party affiliation of recipient committees. |
| Vercel dashboard (future) | PM's vision for Phase 2. Not in scope now, but architecture supports it. |
