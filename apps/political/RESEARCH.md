# Political Funding Prospect Matcher — Comprehensive Research

Match prospects against US political contribution data to surface capacity and affinity signals for gift officers.

---

## How US Political Donations Work (Plain English)

In the US, when anyone donates money to a politician or political group, the government records it publicly if the donation exceeds $200. This creates a massive public database containing:

- **Who** gave money (full name, employer, job title, city/state)
- **How much** they gave
- **Who they gave it to** (which politician, PAC, or party)
- **When** they gave it

**Why this matters for prospect research:** If someone is giving $50,000+ to political causes, they are wealthy and willing to give money away. That's exactly the signal a gift officer needs. Political donations are simultaneously a wealth signal (capacity) and a values signal (affinity).

**How this compares to the SEC matcher:**

| Tool | Question it answers | Signal type |
|------|-------------------|-------------|
| SEC Matcher | "Did they just get liquid money?" | Timing — they have cash RIGHT NOW |
| Political Matcher | "Are they a habitual high-capacity donor?" | Capacity + intent — they REGULARLY give |

The two tools are complementary. A prospect who just sold $5M in stock (SEC) AND has a track record of $100K+ in political giving (FEC) is a top-priority call.

---

## Legal Status: Can We Use This Data?

**The law (52 U.S.C. § 30111(a)(4)) says you CANNOT:**
- Sell a raw list of donor names/addresses as a mailing list
- Use the names/addresses to solicit political contributions

**You CAN:**
- Use it for research and analysis
- Build tools that surface giving patterns and insights
- Use it for prospect research (our use case)
- Tell a gift officer "John Smith gave $3,500 to Biden's campaign" — this is sharing publicly available information

**Industry precedent:** DonorSearch (~$4,200/yr), iWave/Kindsight (~$3,745/yr), and WealthEngine (~$5,000+/yr) all use FEC data in their commercial prospect research products. iWave explicitly notes FEC Act compliance — they provide political giving data as "context" alongside their screening.

**Bottom line:** Our use case (prospect research for nonprofits) is standard industry practice. The gift officer approaches the prospect about a charitable gift, not a political donation. If building a commercial product, a brief attorney consultation is advisable.

---

## Data Sources — Ranked by Value

### Tier 1: FEC Individual Contributions (Federal)

**The crown jewel. This is our primary data source.**

The Federal Election Commission (FEC) tracks every political donation over $200 to any federal candidate, PAC, or party committee.

#### Access Methods

| Method | URL | Rate Limit | Best For |
|--------|-----|------------|----------|
| **Bulk download** | S3 bucket (see URLs below) | None | Primary processing — stream 60M+ records locally |
| **OpenFEC API** | `https://api.open.fec.gov/v1/schedules/schedule_a/` | Free key: 1,000/hr; Elevated: 7,200/hr | Incremental updates, verification lookups |
| **E-filing RSS** | `https://efilingapps.fec.gov/rss` | None | Near-real-time new filing alerts (raw data) |

**API key:** Free instant signup at `https://api.data.gov/signup/`. DEMO_KEY works but is heavily rate-limited (~30-40/hr).

#### Bulk Download URLs

```
# S3 bucket (direct, fastest for large files):
https://cg-519a459a-0ea3-42c2-b7bc-fa1143481f74.s3-us-gov-west-1.amazonaws.com/bulk-downloads/{YEAR}/indiv{YY}.zip

# FEC website (redirects to S3):
https://www.fec.gov/files/bulk-downloads/{YEAR}/indiv{YY}.zip

# Header file (separate download, comma-delimited):
https://www.fec.gov/files/bulk-downloads/data_dictionaries/indiv_header_file.csv

# AWS CLI (no credentials needed):
aws --region us-gov-west-1 s3 cp --recursive \
  s3://cg-519a459a-0ea3-42c2-b7bc-fa1143481f74/bulk-downloads/2024/ \
  --no-sign-request ./local_dir/
```

#### File Format

| Property | Value |
|----------|-------|
| Filename inside ZIP | `itcont.txt` |
| Delimiter | Pipe (`\|`) |
| Has header row | **NO** — headers are in a separate CSV file |
| Encoding | ASCII / UTF-8 |
| Line terminator | `\n` |
| Quoting | None |

**GOTCHA:** The header file is comma-delimited but the data file is pipe-delimited. Different delimiters.

#### 21 Columns Per Record (Complete Schema)

| # | Field | Type | Max Len | Description |
|---|-------|------|---------|-------------|
| 1 | CMTE_ID | VARCHAR | 9 | Committee receiving the contribution (FK to cm.txt) |
| 2 | AMNDT_IND | VARCHAR | 1 | N=New, A=Amendment, T=Termination |
| 3 | RPT_TP | VARCHAR | 3 | Report type code (12G, 12P, 30G, Q1, Q2, Q3, YE) |
| 4 | TRANSACTION_PGI | VARCHAR | 5 | P=Primary, G=General, O=Other, C=Convention, R=Runoff, S=Special |
| 5 | IMAGE_NUM | VARCHAR | 18 | Document scanning ID |
| 6 | TRANSACTION_TP | VARCHAR | 3 | Transaction type code |
| 7 | ENTITY_TP | VARCHAR | 3 | IND=Individual, COM=Committee, ORG=Organization, CAN=Candidate |
| 8 | NAME | VARCHAR | 200 | Contributor name: "LAST, FIRST MIDDLE" for individuals |
| 9 | CITY | VARCHAR | 30 | Contributor city |
| 10 | STATE | VARCHAR | 2 | Contributor state abbreviation |
| 11 | ZIP_CODE | VARCHAR | 9 | Contributor ZIP (5 or 9 digits, no dash) |
| 12 | EMPLOYER | VARCHAR | 38 | Contributor employer (free-text, highly variable) |
| 13 | OCCUPATION | VARCHAR | 38 | Contributor occupation (free-text) |
| 14 | TRANSACTION_DT | DATE | 8 | Date in MMDDYYYY format (not ISO!) |
| 15 | TRANSACTION_AMT | NUMBER | 14,2 | Dollar amount (negative = refund) |
| 16 | OTHER_ID | VARCHAR | 9 | FEC ID for committee donors (null for individuals) |
| 17 | TRAN_ID | VARCHAR | 32 | Unique transaction ID per filing |
| 18 | FILE_NUM | NUMBER | 22 | Unique filing/report number |
| 19 | MEMO_CD | VARCHAR | 1 | 'X' = memo item (DO NOT count in totals) |
| 20 | MEMO_TEXT | VARCHAR | 100 | Transaction description |
| 21 | SUB_ID | NUMBER | 19 | Unique FEC database record ID (primary key) |

#### NAME Field Format (Real Examples)

```
"SMITH, JOHN"                → Standard format
"SMITH, JOHN A."             → With middle initial
"SMITH, JOHN ALEXANDER"      → With full middle name
"SMITH, JOHN A JR"           → With suffix (no comma before suffix)
"SMITH, JOHN A. JR."         → With periods
"O'BRIEN, MARY"              → Apostrophe in name
"DE LA CRUZ, MARIA"          → Multi-word last name
"SMITH-JONES, JENNIFER"      → Hyphenated last name
"MC DONALD, JAMES"           → Spaced prefix
"ACTBLUE"                    → Organization (no comma = not individual)
```

All names are typically ALL CAPS.

#### EMPLOYER Field Quality Issues

The EMPLOYER field is free-text with zero validation. Real examples of messiness:

```
Same company, many spellings:     Non-informative values:
  "GOOGLE"                          "SELF-EMPLOYED" / "SELF EMPLOYED" / "SELF"
  "GOOGLE INC"                      "RETIRED" / "RETIRE" / "RETIREE"
  "GOOGLE INC."                     "NOT EMPLOYED" / "NONE" / "N/A"
  "GOOGLE LLC"                      "HOMEMAKER" / "HOME MAKER"
  "GOOGLE, INC."                    "INFORMATION REQUESTED"
  "ALPHABET INC"                    "INFORMATION REQUESTED PER BEST EFFORTS"
  "ALPHABET"                        "STUDENT"
```

#### Volume Per Election Cycle

| Cycle | Records | Compressed | Uncompressed |
|-------|---------|------------|-------------|
| 2016 | ~12.6M | ~500MB | ~2.5GB |
| 2020 | ~25-30M | ~1-2GB | ~5-6GB |
| 2024 | ~20-30M | ~1-2GB | ~4-6GB |
| 2026 (current, partial) | Growing | Growing | Growing |
| **3 cycles total** | **~60-90M** | | **~12-18GB** |

#### Data Freshness

| Data stream | Update frequency | Latency | Coverage |
|-------------|-----------------|---------|----------|
| **Bulk files (S3)** | Every Sunday | ~7 days max | Full history by cycle |
| **Processed API** (`/schedule_a/`) | Days to weeks after filing | Varies | Full history (1978+) |
| **E-filing RSS** | Every 15 minutes | Minutes | Last ~7 days of filings only |

**Critical understanding:** Contributions are NOT reported in real-time. A donation made on January 15 might not be filed until March 15 (quarterly deadline). The e-filing endpoint shows recently FILED reports, not recently MADE contributions.

**Practical implication for our tool:** When someone donates to a politician in the US, that donation doesn't appear in FEC data immediately. The political committee files a report once per quarter (every 3 months). So a donation made today might not show up in FEC data until 2-3 months later. If we ask the API "give me donations from the last 7 days," we'll get almost nothing — because nothing from the last 7 days has been reported yet. That's why our daily fetch uses a **90-day window** instead of 7 days — to capture the most recent quarterly filing cycle.

#### API Search Capabilities

The OpenFEC Schedule A endpoint supports these filters:

| Parameter | What it does |
|-----------|-------------|
| `contributor_name` | Full-text search (PostgreSQL tsvector — fuzzy, not exact match!) |
| `contributor_employer` | Employer filter |
| `contributor_city` | City filter (multi-value) |
| `contributor_state` | State filter (multi-value) |
| `contributor_zip` | ZIP filter |
| `contributor_type` | "individual" or "committee" |
| `is_individual` | Boolean filter |
| `committee_id` | Filter by receiving committee |
| `min_date` / `max_date` | Date range (on contribution_receipt_date) |
| `min_amount` / `max_amount` | Amount range |
| `two_year_transaction_period` | Election cycle (e.g., 2024, 2026) |
| `per_page` | Max 100 results per page |

**IMPORTANT:** `contributor_name` uses PostgreSQL tsvector full-text search. Searching "SMITH JOHN" matches anyone with both words — including "JOHNSON, SMITH" or "SMITHSON, JOHN." Results are noisy and need client-side filtering.

**Pagination:** Keyset pagination ONLY (no page numbers). Use `last_index` + `last_contribution_receipt_date` from the response's `pagination.last_indexes` object.

#### API Response Fields

Each Schedule A record from the API includes these fields (richer than bulk files):

**Contributor identity:** `contributor_name`, `contributor_first_name`, `contributor_last_name`, `contributor_middle_name`, `contributor_prefix`, `contributor_suffix`, `contributor_id`

**Location:** `contributor_city`, `contributor_state`, `contributor_zip`, `contributor_street_1`, `contributor_street_2`

**Employment:** `contributor_employer`, `contributor_occupation`

**Contribution:** `contribution_receipt_amount`, `contribution_receipt_date`, `contributor_aggregate_ytd`, `receipt_type`, `memo_code`, `memo_text`, `is_individual`

**Committee (nested object):** `committee_id`, `committee.name`, `committee.committee_type`, `committee.party`, `committee.designation`

**Candidate (when linked):** `candidate_id`, `candidate_name`, `candidate_office`, `candidate_office_state`

**Metadata:** `filing_form`, `file_number`, `sub_id`, `amendment_indicator`, `two_year_transaction_period`

#### Critical Gotchas

1. **Memo items (MEMO_CD = 'X'):** Informational only — DO NOT count in totals. Common scenario: ActBlue earmarked contribution appears as both the original receipt (memo) and forwarded amount. Counting both = double-counting.

2. **Negative amounts:** `TRANSACTION_AMT` can be negative (refunds/redesignations). Must handle in aggregation.

3. **Amendments:** When a filing is amended (AMNDT_IND = 'A'), both old and new may appear. De-duplicate by preferring highest FILE_NUM for a given TRAN_ID.

4. **$200 threshold:** Only contributions of $200+ cumulative per cycle to the same committee are itemized. Smaller donors are invisible.

5. **No unique person ID:** FEC has no equivalent of SEC's CIK number. Matching relies entirely on name + employer + location.

---

### Tier 2: FEC Committee & Candidate Data

**Context layer — who is the money going TO?**

Every contribution goes to a committee (CMTE_ID). These small lookup files tell you what that committee is and which candidate it supports.

#### Three Lookup Files

| File | Records | Size | Download URL pattern |
|------|---------|------|---------------------|
| Committee Master (`cm{YY}.txt`) | ~20-25K | <5MB | `https://www.fec.gov/files/bulk-downloads/{YEAR}/cm{YY}.zip` |
| Candidate Master (`cn{YY}.txt`) | ~10-15K | <3MB | `https://www.fec.gov/files/bulk-downloads/{YEAR}/cn{YY}.zip` |
| Candidate-Committee Linkage (`ccl{YY}.txt`) | ~10-15K | <2MB | `https://www.fec.gov/files/bulk-downloads/{YEAR}/ccl{YY}.zip` |

All three fit easily in memory. Pipe-delimited, no header row.

#### Committee Master (cm.txt) — 15 Columns

| # | Field | Description |
|---|-------|-------------|
| 1 | CMTE_ID | Committee ID (9-char, starts with "C") |
| 2 | CMTE_NM | Committee name |
| 3 | TRES_NM | Treasurer name |
| 4-8 | Address fields | Street, city, state, ZIP |
| 9 | CMTE_DSGN | Designation: A=Authorized, B=Lobbyist PAC, D=Leadership PAC, J=Joint fundraiser, P=Principal campaign, U=Unauthorized |
| 10 | CMTE_TP | Committee type (see full list below) |
| 11 | CMTE_PTY_AFFILIATION | Party code (DEM, REP, LIB, etc.) |
| 12 | CMTE_FILING_FREQ | Filing frequency |
| 13 | ORG_TP | Organization type: C=Corp, L=Labor, M=Membership, T=Trade, V=Coop, W=Corp w/o stock |
| 14 | CONNECTED_ORG_NM | Connected organization name |
| 15 | CAND_ID | Linked candidate ID (only for H/S/P type committees) |

#### Committee Type Codes (Complete)

| Code | Type | What it means |
|------|------|---------------|
| **H** | House | House candidate campaign committee |
| **S** | Senate | Senate candidate campaign committee |
| **P** | Presidential | Presidential candidate campaign committee |
| **N** | PAC - Nonqualified | New/small PAC (hasn't met multicandidate threshold) |
| **Q** | PAC - Qualified | Multicandidate PAC (received from 50+ people, given to 5+ candidates) |
| **O** | Super PAC | Independent expenditure-only; unlimited donations, no candidate coordination |
| **V** | Hybrid PAC - Nonqualified | Has both regular and IE-only accounts |
| **W** | Hybrid PAC - Qualified | Has both regular and IE-only accounts (qualified) |
| **X** | Party - Nonqualified | Party committee (hasn't met multicandidate threshold) |
| **Y** | Party - Qualified | Party committee (met multicandidate threshold) |
| **Z** | National Party Nonfederal | National party soft-money/non-federal account |
| **C** | Communication Cost | Internal communication costs |
| **D** | Delegate Committee | Convention delegate committee |
| **E** | Electioneering Communication | Broadcast ads near elections |
| **I** | Independent Expenditor | Person/group making independent expenditures |
| **U** | Single Candidate IE | IE committee for/against a single candidate |

**For our tool:** H, S, P (candidate committees) always have a linked CAND_ID. N, Q, O, V, W (PACs) and X, Y, Z (party committees) generally don't link to a specific candidate.

#### Candidate Master (cn.txt) — 15 Columns

| # | Field | Description |
|---|-------|-------------|
| 1 | CAND_ID | Candidate ID (starts with H/S/P for House/Senate/President) |
| 2 | CAND_NAME | "LAST, FIRST MIDDLE SUFFIX" |
| 3 | CAND_PTY_AFFILIATION | Party code |
| 4 | CAND_ELECTION_YR | Election year |
| 5 | CAND_OFFICE_ST | State ("US" for president) |
| 6 | CAND_OFFICE | H=House, S=Senate, P=President |
| 7 | CAND_OFFICE_DISTRICT | District ("00" for at-large/Senate/President) |
| 8 | CAND_ICI | C=Challenger, I=Incumbent, O=Open seat |
| 9 | CAND_STATUS | C=Current, F=Future, N=Not yet, P=Prior |
| 10 | CAND_PCC | Principal campaign committee ID (links back to cm.txt) |
| 11-15 | Address fields | Mailing address |

#### Candidate-Committee Linkage (ccl.txt) — 7 Columns

| # | Field | Description |
|---|-------|-------------|
| 1 | CAND_ID | Candidate ID |
| 2 | CAND_ELECTION_YR | Candidate election year |
| 3 | FEC_ELECTION_YR | FEC 2-year cycle |
| 4 | CMTE_ID | Committee ID |
| 5 | CMTE_TP | Committee type |
| 6 | CMTE_DSGN | Committee designation |
| 7 | LINKAGE_ID | Unique linkage record ID |

**Why ccl.txt matters:** cm.txt only links CAND_ID for principal campaign committees (type H/S/P, designation P). ccl.txt maps ALL committee-candidate relationships including authorized committees (A), joint fundraisers (J), etc.

#### CMTE_ID → Candidate Resolution Chain

```
itcont.txt (contributions)
  │ CMTE_ID (col 1)
  ▼
cm.txt (committees) ──CAND_ID (col 15)──→ cn.txt (candidates)
  ▲                                         ▲
  │                                         │
  └──── CMTE_ID (col 4) ── ccl.txt ── CAND_ID (col 1) ────┘
```

Three resolution methods:
1. **cm.txt CAND_ID** — Direct, but only for candidate committees (H/S/P)
2. **ccl.txt** — Most complete, covers all authorized committees
3. **API `candidate_ids` array** — Convenient for ad-hoc lookups

~40-50% of contributions go to candidate committees (direct linkage). The rest go to PACs (~30-40%), Super PACs (~5-10%), or party committees (~10-15%) which don't have direct candidate links.

#### Party Affiliation Codes (Major)

| Code | Party |
|------|-------|
| DEM | Democratic Party |
| REP | Republican Party |
| LIB | Libertarian Party |
| GRE | Green Party |
| CON | Constitution Party |
| IND | Independent |
| NNE | None stated |
| NPA | No Party Affiliation |
| OTH | Other |
| UNK | Unknown |

Plus 40+ smaller/historical party codes (AIP, CRV, DFL, PAF, REF, SOC, WFP, etc.). For our tool, bucket everything into DEM / REP / OTHER.

---

### Tier 3: State-Level Contributions

Federal FEC data only covers donations to federal candidates (President, Senate, House). Many wealthy donors also give heavily at the state level — governor races, state legislature, ballot measures.

#### FollowTheMoney.org (Primary State Source)

| Detail | Info |
|--------|------|
| Operator | National Institute on Money in Politics (merged with OpenSecrets June 2021) |
| Coverage | **All 50 states**, state-level candidates since 2000 (some states back to 1989) |
| Records | ~52 million+ contribution records |
| Dollar value | Over $100 billion documented |
| Data types | Campaign contributions, party contributions, ballot measures, independent expenditures, lobbying |
| Freshness | Current through 2024 election year |
| API | Free after creating a myFollowTheMoney account |
| Rate limits | Not publicly documented |

**Two APIs:**
1. **Ask Anything API** — Tabular/CSV-friendly output. Primary API for querying contributions. Documentation: `https://www.followthemoney.org/assets/FollowTheMoney-API.pdf`
2. **Entity Details API** — Hierarchical data, mirrors website entity pages. Endpoint: `http://api.followthemoney.org/entity.php?eid=###&APIKey=XXX&mode=xml`

**Key capabilities:**
- Search by donor name
- Search by employer
- Filter by state, year, date range
- Entity IDs (unique identifiers linking a donor's entire history)
- Incremental updates via `d-ludte` (last-updated-date) parameter

**WARNING — Risks:**
- Site is in **maintenance mode** — bugs may exist, no new features
- Will be **sunsetted** eventually as data migrates fully to OpenSecrets
- API documentation is in a PDF that must be manually downloaded
- Long-term API stability is uncertain

#### The Accountability Project (Supplementary)

| Detail | Info |
|--------|------|
| URL | `https://publicaccountability.org/datasets/home/` |
| Coverage | ~20-25 states (partial — NOT all 50) |
| Federal data | 404M records (2007-2023) |
| Format | CSV downloads, no API |
| Cost | Free, no account needed |
| Status | Last updated ~Feb 2023 (possibly stale) |

States with confirmed coverage: Alabama, Alaska, Arizona, California, Colorado, Connecticut, DC, Florida, Georgia, Indiana, Iowa, Kansas, Maryland, Massachusetts, Michigan, New Hampshire, New York, North Dakota, Pennsylvania, South Carolina, Texas, Virginia, West Virginia.

**Limitations:** No API, inconsistent schemas across states, no unique donor IDs, no real-time updates.

#### Transparency USA (Premium Alternative)

- Most up-to-date state-level campaign finance data
- CSV, JSON, or API access
- **Paid service** (see `https://www.transparencyusa.org/data-sales`)
- Partnership with Ballotpedia
- Better than FollowTheMoney if budget allows

---

### Tier 4: Lobbying Disclosure (Senate LDA)

Lobbyists are a small but disproportionately high-value prospect universe. If your prospect is a registered lobbyist, they are wealthy, politically connected, and provably give money.

#### API Access

| Detail | Info |
|--------|------|
| Base URL | `https://lda.senate.gov/api/v1/` |
| Authentication | Optional — anonymous (15 req/min) or API key (120 req/min) |
| API key registration | `https://lda.senate.gov/api/register/` (free, Bearer token) |
| Documentation | `https://lda.senate.gov/api/redoc/v1/` (OpenAPI/ReDoc) |
| **MIGRATION WARNING** | Site moving to `LDA.gov` — `lda.senate.gov` unavailable after **06/30/2026** |

#### Endpoints

| Endpoint | What it gives you |
|----------|------------------|
| `/v1/filings/` | LD-1 registrations + LD-2 quarterly activity reports |
| `/v1/contributions/` | **LD-203 contribution reports** (the gold) |
| `/v1/registrants/` | Lobbying firms/organizations |
| `/v1/clients/` | Clients being lobbied for |
| `/v1/lobbyists/` | Individual lobbyist records |

#### Three Filing Types

| Filing | Content | Frequency | Data since |
|--------|---------|-----------|-----------|
| **LD-1** | Lobbying registration: who is lobbying whom, on what issues | When engagement begins | 1999 |
| **LD-2** | Quarterly activity: income, expenses, issues lobbied, lobbyists involved | Quarterly | 1999 |
| **LD-203** | Political contributions BY lobbyists ($200+ to federal candidates/PACs/parties) | Semiannual (Jan 30, Jul 30) | Mid-2008 |

#### LD-203 Query Parameters

- `registrant` — Filter by lobbying firm
- `registrant_lobbyist` — Filter by individual lobbyist name
- `report_year` — Filing year
- `contribution_date_from` / `contribution_date_to` — Date range
- `contribution_amount_min` / `contribution_amount_max` — Amount range
- `contribution_type` — FECA, Honorary, Presidential Library, or Event
- `contribution_contributor` — Who made the contribution
- `contribution_payee` — Who received the payment

#### Data Volume

- **~13,000 active registered lobbyists** (2024)
- **~2,435 registered lobbying firms** (2024)
- Total lobbying spending: **$4.5 billion** (2024)
- ~30,000-35,000 LD-203 filings per year (many are "no contributions" reports)

#### Matching Potential

- Names are **structured** (first/last with prefixes and suffixes)
- Every filing tied to a **registrant** (employer/firm) — cross-check possible
- Unique lobbyist IDs and filing UUIDs exist
- ~13K lobbyists is small enough to load entirely into memory
- **Limitation:** Lobbyist data only — not general political donors. Small universe but very high-value prospects.

#### Bulk Download

- **Discontinued December 31, 2020.** API is now the only current source.
- Historical XML archived on GitHub:
  - LD-1/LD-2 (1999-2020): `https://github.com/wgetsnaps/senate-lda-activity`
  - LD-203 (2008-2020): `https://github.com/wgetsnaps/senate-lda-contributions`

---

### Tier 5: IRS 527 Political Organizations

527 organizations are tax-exempt political groups organized under Section 527 of the Internal Revenue Code. They file with the IRS instead of (or alongside) the FEC.

**Why they matter:** 527s can accept **UNLIMITED contributions** (no $3,500 cap like FEC). A donor who maxes out federal limits might pour $500,000 into a 527. These are the ultra-high-capacity donors that FEC data understates.

#### What 527s Capture That FEC Misses

- **State/local political organizations** — FEC only covers federal elections
- **Unlimited contributions** — No contribution limits (vs $3,500/candidate federal cap)
- **Issue advocacy groups** — Ballot measures, judicial elections, policy advocacy
- **State party committees and legislative caucuses** filing with IRS

**No overlap with FEC:** Federal PACs and candidate committees file with the FEC and are explicitly excluded from IRS 527 filing. Different data, different donors.

#### Bulk Data Download

| Detail | Info |
|--------|------|
| Download URL | `https://forms.irs.gov/app/pod/dataDownload/dataDownload` |
| Data layout | `https://forms.irs.gov/app/pod/dataDownload/dataLayout` |
| Format | **Pipe-delimited ASCII** (same delimiter as FEC!) |
| Update frequency | **Every Sunday at 1:00 AM** |
| E-filing mandatory | Since January 2020 (comprehensive data post-2020) |
| API | **None** — bulk download only |
| Cost | Free |

#### Available Files

| File | Content |
|------|---------|
| `8871.txt` | Organization registrations (Form 8871): name, EIN, purpose, officers/directors |
| `8872.txt` | Filing header records (Form 8872) |
| **`skeda.txt`** | **Schedule A: Itemized contributions TO 527s** (the match target) |
| `skedb.txt` | Schedule B: Itemized expenditures |

Schedule A contribution records contain:
- Contributor's full name
- Contributor's mailing address + ZIP
- **Contributor's employer** (if individual)
- **Contributor's occupation** (if individual)
- Amount of each contribution
- Date of each contribution
- Aggregate contributions year-to-date

**Reporting threshold:** $200 in aggregate per calendar year (same as FEC).

#### Volume

- **~30,000-50,000+ registered 527 organizations** nationally
- Contribution records likely in the **low millions** (far smaller than FEC's 60-80M/cycle)
- File size is manageable — easily processable on 8GB RAM

#### Data Quality

- ~0.1% of records may be corrupted by special characters in freetext fields
- Pre-2020 data may be incomplete (e-filing was voluntary before 2020)
- IRS maintains a "Data Problems" page documenting known issues

#### Existing Open-Source Parsers

- **Ruby:** `https://github.com/dwillis/IRS527` — Downloads and parses full data file
- **R:** `https://github.com/Nonprofit-Open-Data-Collective/irs-527-political-action-committee-disclosures` — Produces 7 clean CSV datasets

#### Practical Value Assessment

**MODERATE VALUE, LOW EFFORT.** The data format is pipe-delimited (identical to FEC), the parsing infrastructure transfers directly, the file is much smaller than FEC data, and it surfaces donors invisible in FEC data (especially state-level mega-donors). Natural Phase 4 addition after FEC pipeline is working.

#### Form 990 — MOSTLY A DEAD END

- **Schedule B (donor names):** REDACTED from public copies for all but private foundations. Cannot be used for prospect matching.
- **Part VII (compensation):** Lists officers, directors, key employees with compensation amounts. Different signal type (wealth indicator, not giving behavior). Available via IRS XML downloads.
- **ProPublica Nonprofit Explorer API** (`https://projects.propublica.org/nonprofits/api/`): No API key required, but **cannot search by individual/donor name** — organization-level data only.

---

### Tier 6: Supplementary / Enrichment Sources

#### OpenSecrets Bulk Data

| Detail | Info |
|--------|------|
| URL | `https://www.opensecrets.org/open-data/bulk-data` |
| **API Status** | **DISCONTINUED as of April 15, 2025** |
| Bulk data | Still available for download |
| License | **Creative Commons BY-NC-SA (NonCommercial)** |
| Unique value | Industry/sector catcodes assigned to EVERY individual contribution |

**What OpenSecrets adds:** They are the ONLY organization that categorizes individual contributions by industry/sector (not just PAC contributions). Their catcode system maps employers to NAICS-like industry codes, enabling aggregation like "85% of this prospect's giving comes from tech industry donors."

**BLOCKER:** The NonCommercial license prohibits use in for-profit products. If your tool is commercial, you cannot use OpenSecrets data. For internal/educational use, the catcodes are uniquely valuable.

#### ProPublica Campaign Finance API

| Detail | Info |
|--------|------|
| URL | `https://projects.propublica.org/api-docs/campaign-finance/` |
| Status | Active |
| API key | Email `apihelp@propublica.org` |
| Rate limit | 5,000 requests/day |
| **Individual donor search** | **NO — committee/candidate-level only** |

**Not useful for donor matching.** Only provides summary-level data for candidates and committees. Cannot search by individual contributor name.

#### FEC E-Filing RSS Feed

| Detail | Info |
|--------|------|
| URL | `https://efilingapps.fec.gov/rss` |
| Coverage | Last 7 days of electronically filed reports |
| Format | RSS 2.0 — links to raw `.fec` files |
| Freshness | Minutes after filing |

Each RSS item links to a raw `.fec` file that must be parsed to extract Schedule A (individual contribution) lines. Useful for near-real-time monitoring but requires building a `.fec` file parser.

#### LittleSis

| Detail | Info |
|--------|------|
| URL | `https://littlesis.org/` |
| Database | 400,000+ people/organizations, 1.6M+ relationships |
| Focus | Power networks — board memberships, campaign contributions, government contracts |
| API | Public API available, bulk data downloadable as JSON |

Interesting for relationship/network enrichment (e.g., "Does this prospect sit on a board with someone at your client's institution?") but not useful for primary donor matching.

#### Dead Ends / Not Useful

| Source | Why it's a dead end |
|--------|-------------------|
| OpenSecrets API | Discontinued April 2025 |
| ProPublica Campaign Finance API | No individual donor search |
| ProPublica 527 Explorer | Web-only tool, no public API |
| Google Civic Information API | No campaign finance data at all |
| VoteSmart API | Summary candidate data only, no donor records |
| Ballotpedia | Committee-level data, paid API |
| MapLight | Not a data provider, transparency tools only |
| Sunlight Foundation / Influence Explorer | Shut down, data archived and stale |
| Form 990 Schedule B | Donor names redacted from public copies |
| AWS S3 Form 990 data | Discontinued Dec 2021 |

---

## Matching Challenges (vs SEC Tool)

| Challenge | SEC Tool | Political Tool |
|-----------|----------|---------------|
| **Name format** | XML tags: `<rptOwnerName>SMITH JOHN</rptOwnerName>` | Explicit field: `LAST, FIRST MIDDLE` |
| **Identity verification** | CIK numbers (unique IDs) | **No unique person ID** — name + employer + location only |
| **False positive risk** | Moderate (CIK helps) | **HIGH** — "John Smith" at "IBM" could be hundreds of people |
| **Company matching** | Issuer in structured XML | EMPLOYER is free-text and extremely messy |
| **Data volume** | ~6,700 filing files | **60-80M+ records per cycle** (must stream) |
| **Data structure** | Unstructured text with embedded XML/HTML | Structured pipe-delimited columns |
| **Matching approach** | Aho-Corasick (needed for free-text search) | Hash-map lookup (sufficient for structured fields) |

---

## Signal Classification

| Tier | Signal | Trigger | Gift Officer Action |
|------|--------|---------|-------------------|
| **1: High-Capacity** | Big political donor | $10K+ total in a cycle, OR maxed out ($3,500) to 3+ candidates | "Call now — proven high-capacity donor" |
| **2: Consistent** | Regular giver | Active in 2+ cycles, $2.5K-$10K total, 5+ recipients | "Build relationship — consistent giver" |
| **3: Emerging** | Casual donor | Any verified match below Tier 2 thresholds | "Monitor — emerging capacity" |

#### Special Flags (Cross-Cutting)

| Flag | Trigger | Signal |
|------|---------|--------|
| Max-Out Donor | Gave $3,500 to 3+ candidates | Regularly gives at maximum levels |
| Mega-Donor | Total giving > $100K | Ultra-high-capacity |
| Bipartisan | 30-70% split between parties | Issue-driven, not partisan |
| Issue-Aligned | 60%+ to committees matching keywords | Affinity signal for your org |
| Bundler | Appears in FEC bundler data | Connected fundraiser |
| Lapsed | Active in prior cycles but not current | Shifted priorities, re-engagement opportunity |

#### 2025-2026 Contribution Limits (Reference)

| From → To | Limit |
|-----------|-------|
| Individual → Candidate | $3,500 per election ($7,000 primary + general) |
| Individual → National Party | $44,300 per year |
| Individual → PAC | $5,000 per year |
| Individual → State/Local Party | $10,000 combined per year |
| Bundler disclosure threshold | $23,300+ |

Someone hitting these limits across multiple candidates is a clear high-capacity signal.

---

## Competitive Landscape

| Service | Price | Political Data | Approach |
|---------|-------|---------------|----------|
| DonorSearch | ~$4,200/yr | FEC data, 40+ sources | Wealth + philanthropic + political screening |
| iWave/Kindsight | ~$3,745/yr | Federal + state political giving | Data enrichment, FEC Act compliant |
| WealthEngine | ~$5,000+/yr | Political donations as a score | AI/ML predictive analytics |
| **Our tool** | Low cost | Deep FEC matching + aggregation | Focused political capacity matching for nonprofits |

These services treat political giving as one signal among many (bundled with real estate, stock holdings, philanthropic giving). Our tool provides deeper, more systematic matching against the full FEC dataset with name-variant matching and employer cross-check — specifically designed for our ICP.

---

## Implementation Phases

| Phase | Data Source | What It Adds |
|-------|-----------|-------------|
| **Phase 1 (MVP)** | FEC individual contributions (bulk) | Name + employer matching, capacity signals, tiered CSV |
| **Phase 2** | FEC committee + candidate master files | Resolve who money went to: candidate name, party, office |
| **Phase 3** | Multi-cycle aggregation + scoring | Longitudinal profiles across 2020/2022/2024 cycles |
| **Phase 4** | IRS 527 data + state-level (FollowTheMoney) | Unlimited-donation donors, state-level giving |
| **Phase 5** | Senate LDA lobbying disclosure | Lobbyist identification, LD-203 contributions |

---

## Key URLs (Verified March 2026)

| Resource | URL | Status |
|----------|-----|--------|
| FEC Bulk Downloads | `https://www.fec.gov/data/browse-data/?tab=bulk-data` | Active |
| FEC Bulk S3 Index | `https://cg-519a459a-0ea3-42c2-b7bc-fa1143481f74.s3-us-gov-west-1.amazonaws.com/bulk-downloads/index.html` | Active |
| FEC Individual Contributions Schema | `https://www.fec.gov/campaign-finance-data/contributions-individuals-file-description/` | Active |
| FEC Committee Master Schema | `https://www.fec.gov/campaign-finance-data/committee-master-file-description/` | Active |
| FEC Candidate Master Schema | `https://www.fec.gov/campaign-finance-data/candidate-master-file-description/` | Active |
| FEC CCL Schema | `https://www.fec.gov/campaign-finance-data/candidate-committee-linkage-file-description/` | Active |
| OpenFEC API | `https://api.open.fec.gov/developers/` | Active |
| API Key Signup | `https://api.data.gov/signup/` | Active |
| FEC E-Filing RSS | `https://efilingapps.fec.gov/rss` | Active |
| FEC Contribution Limits | `https://www.fec.gov/updates/contribution-limits-for-2025-2026/` | Active |
| FollowTheMoney | `https://www.followthemoney.org/our-data/apis` | Active (maintenance mode) |
| FollowTheMoney API Docs (PDF) | `https://www.followthemoney.org/assets/FollowTheMoney-API.pdf` | Active |
| Senate LDA API | `https://lda.senate.gov/api/` | Active (migrating to LDA.gov by June 2026) |
| Senate LDA ReDoc | `https://lda.senate.gov/api/redoc/v1/` | Active |
| IRS 527 Bulk Download | `https://forms.irs.gov/app/pod/dataDownload/dataDownload` | Active |
| IRS 527 Data Layout | `https://forms.irs.gov/app/pod/dataDownload/dataLayout` | Active |
| OpenSecrets Bulk Data | `https://www.opensecrets.org/open-data/bulk-data` | Active (NC license) |
| OpenSecrets API | `https://www.opensecrets.org/api` | **DEAD (April 2025)** |
| ProPublica Campaign Finance API | `https://projects.propublica.org/api-docs/campaign-finance/` | Active (no donor search) |
| ProPublica Nonprofit Explorer API | `https://projects.propublica.org/nonprofits/api/` | Active (org-level only) |
| ProPublica 527 Explorer | `https://projects.propublica.org/527-explorer/` | Active (web only, no API) |
| Accountability Project | `https://publicaccountability.org/datasets/home/` | Possibly stale |
| LittleSis | `https://littlesis.org/` | Active |
