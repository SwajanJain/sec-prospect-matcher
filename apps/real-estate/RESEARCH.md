# Real Estate Matcher — Research

> Research completed March 2026. Sources cited inline.
>
> Goal: evaluate how to build a `real-estate matcher` product for the same nonprofit advancement / prospect research ICP as the other apps in this repo.

---

## Executive Summary

The real-estate matcher is viable, but only if we treat it as a **public-record ownership and property-intelligence product**, not as a listings product.

The core thesis is strong for the ICP:

- Real estate is already the **single most important publicly accessible wealth indicator** used in prospect research. Individuals who own real estate valued at $2M+ are **17× more likely to give philanthropically** than the average person (DonorSearch, iWave).
- The raw signals are public, explainable, and usually easier to defend than opaque "wealth scores"
- Unlike one-time screenings, a matcher can surface **new purchases, sales, mortgage events, ownership changes, portfolio expansion, absentee ownership, and high-value holdings** as ongoing signals
- Real estate typically represents about **15% of a high-net-worth individual's total portfolio** (Capgemini World Wealth Report), which means researchers can reverse-engineer a total wealth estimate from visible real estate

The hard part is not "is there data?" The hard part is:

1. U.S. real-estate data is fragmented across 3,143 county assessors and recorders
2. Owner names are messy and often held in trusts / LLCs
3. Parcel, assessor, and recorder records refresh on different timelines
4. The best nationwide datasets are mostly commercial, not free
5. The wealthiest prospects (highest value targets) are the most likely to hold property through trusts/LLCs, making them the hardest to match by name

My recommendation:

- **Best MVP path:** use a nationwide public-record vendor for assessor + recorder data, with ATTOM as the strongest single-vendor starting point
- **Best budget MVP:** Realie.ai ($50/month) for property/owner data + PropMix PubRec ($79/month) for deed history
- **Best spatial/parcel path:** use Regrid if parcel geometry, map UX, and normalized parcel search are important
- **Best document-deep / title-chain path:** evaluate First American DataTree for later phases if document search and title-chain workflows become differentiators
- **Do not start with county-by-county scraping** unless the goal is a narrow geo pilot
- **Do not start with MLS/listings data**; it is the wrong primary dataset for ownership-based prospect intelligence

The best initial product is not "show every property fact." It is:

- who owns what
- what it is probably worth
- whether that ownership changed recently
- whether there is supporting mortgage / deed / portfolio evidence
- how confident we are that the owner is the prospect
- what does this mean for their estimated giving capacity

---

## 1. What Problem This App Should Solve

For this ICP, real-estate data is useful because it answers questions gift officers and prospect researchers already care about:

- Does this prospect appear to own high-value residential or commercial property?
- Do they own multiple properties?
- Did they recently buy or sell a property?
- Is the property owner-occupied, absentee, or part of a broader portfolio?
- Is there evidence of a trust, LLC, or family-office-like ownership structure?
- Has the prospect refinanced, taken on a large mortgage, or paid one off?
- Is there a second-home / vacation-home pattern?
- Is there a property footprint that suggests materially higher capacity than the CRM currently reflects?

This is a better fit for the ICP than generic consumer real-estate search because the user does not need every field. They need **actionable prospect signals** with enough evidence to trust the match.

---

## 2. Why Real Estate Matters to Prospect Research

### 2.1 How existing tools use real estate data

Every major prospect research tool treats real estate as a primary input:

**iWave (now Kindsight)**
- Data source: **CoreLogic** (156M+ property records in the US)
- Shows in profiles: property summaries with ownership data, current values, mortgage details, purchase/sale/mortgage history, and properties paid off "free and clear"
- Capacity ratings include real estate as a core component alongside 100+ other scores

**WealthEngine (Altrata)**
- Data sources: **CoreLogic** for real estate, **Neustar/TransUnion** for contact validation
- Seven-component "Wealth Signal" score: P2G, Net Worth, Income, **Real Estate**, Estimated Giving Capacity, Donations, Connections
- Capacity assumption: **2% of estimated net worth per year** to charity

**DonorSearch**
- Uses real estate as a capacity marker secondary to philanthropic history
- Identifies individuals based on giving to other organizations, flags major gift history

**Windfall**
- Focuses on **household-level net worth** (minimum $1M threshold)
- Refreshes database **weekly** using machine learning
- 25+ attributes including multi-property ownership, mortgage insights, recent moves, liquidity events

**Blackbaud ResearchPoint**
- Most configurable — allows organizations to build custom capacity formulas
- Six asset categories: Real Estate, Business Ownership, Securities, Income, Other Assets, Affiliations
- Can discount real estate values for high-cost metro areas (NYC, DC, LA)

### 2.2 The industry-standard capacity formula

The most widely cited formula (used by iWave) converts property values to **5-year giving capacity** using tiered percentages:

| Property Value Range | Primary Residence Multiplier | Additional Property Multiplier |
|---|---|---|
| Under $500,000 | 5% | 7.5% |
| $500,000 – $999,999 | 7.5% | 10% |
| $1,000,000+ | 10% | 15% |

**Mortgage bonus:** If total mortgages are ≤50% of total real estate value, add 5% to capacity.

**Worked example from iWave:**
- Primary residence: $950,000 (Palo Alto) × 7.5% = $71,250
- Additional property: $700,000 (Lake Tahoe cottage) × 10% = $70,000
- **5-year real estate capacity: $141,250**

**Net-worth reverse calculation:** Real estate ≈ 15% of total portfolio. So $30M in property → estimated net worth of ~$200M.

**High-cost-of-living adjustment (BWF methodology):**
Sophisticated teams use a three-tiered geographic adjustment:
- Tier 1 (San Francisco, NYC): highest discount on real estate values
- Tier 2 (Seattle, etc.): moderate discount
- Tier 3 (lower-cost areas): standard formula

Key insight from Helen Brown Group: "a $1 million home means very different things" in Manhattan, NY vs. Manhattan, KS.

### 2.3 What a gift officer actually wants to see

A complete prospect research profile includes these real estate fields:

**Property Summary:**
- Number of properties owned
- Total estimated real estate value
- Estimated 5-year giving capacity from real estate
- Property addresses (primary residence + additional)

**Per-Property Details:**
- Current assessed/market value
- Original purchase price and date
- Most recent sale price and date (if sold)
- Mortgage status: outstanding balance, lender, mortgage release (if paid off)
- Property type (single-family, condo, commercial, land)
- Square footage, lot size
- Owner name as recorded (individual, joint, trust, LLC)

**Derived Insights:**
- Equity position (property value minus mortgage)
- Absentee owner flag (investment/rental property indicator)
- Trust/LLC ownership flag (estate planning sophistication)
- Geographic pattern (vacation home, investment portfolio)

**What makes a match "actionable" vs. noise:**

1. **It changes the conversation.** A gift officer discovering a prospect owns a $3M mortgage-free second home in Aspen can confidently move them from the annual fund pool to a major gift pipeline. That is actionable. Knowing someone owns a $250K home in a median-cost area does not change strategy — that is noise.
2. **It indicates timing.** Recent purchases signal liquidity. Recent sales signal a liquidity event. Mortgage payoffs signal increased disposable income. These are triggers for outreach.
3. **It layers with other signals.** The best prospects show capacity (real estate/wealth), affinity (connection to mission), and propensity (history of giving). A $5M home + no philanthropic history is lower priority than a $1.5M home + $50K to similar organizations.

---

## 3. What U.S. Real-Estate Data Actually Exists

At a high level, the data comes from two local government functions:

### 3.1 Assessor / tax-roll data

This is the parcel and tax side.

Typical fields:

- parcel ID / APN
- situs address (physical property address)
- owner name(s) — typically 1-4 owner fields
- mailing address (where tax bills go — often differs from situs)
- land value, improvement value, total assessed value
- tax amount, tax year, tax rate area
- land use / property type / use code
- building characteristics (year built, sqft, bedrooms, bathrooms, stories, construction type)
- exemptions (homestead, veteran, agricultural)

This is the best source for:

- current ownership snapshot
- mailing address vs property address (owner-occupied vs absentee)
- valuation proxies
- portfolio rollups
- residential vs commercial vs vacant land classification

### 3.2 Recorder / deed / mortgage data

This is the transaction side.

Typical fields:

- grantor(s) / seller name(s)
- grantee(s) / buyer name(s)
- document type (warranty deed, quitclaim, trust transfer, etc.)
- recording date
- sale amount / consideration
- mortgage amount, lender
- vesting / ownership rights
- document number, book/page

This is the best source for:

- recent acquisitions and dispositions
- mortgage / refi activity
- trust and LLC naming clues
- ownership history
- transaction recency

**Key deed types and what they mean:**

| Deed Type | What It Means | Arms-Length? |
|---|---|---|
| **Grant Deed** | Standard sale (common in CA) | Usually yes |
| **Warranty Deed** | Full warranties, clear title | Usually yes |
| **Quitclaim Deed** | Transfers whatever interest grantor has, no warranties | Usually no (internal transfer) |
| **Trustee's Deed** | Trustee selling property (often foreclosure) | Context-dependent |
| **Tax Deed** | Sold for delinquent taxes | No |
| **Deed in Lieu** | Borrower transfers to lender to avoid foreclosure | No |

**Identifying arms-length vs. non-arms-length sales:**

This is critical for prospect matching — you need to distinguish real sales from internal transfers:

```
Disqualify if:
  - Quitclaim, tax deed, sheriff's deed
  - Sale price ≤ $100
  - Grantor surname == grantee surname (family transfer)
  - Both grantor and grantee contain "TRUST"
  - Document type contains "FORECLOSURE"
```

### 3.3 Parcel geometry / cadastre

This is the map layer:

- parcel polygon, centroid, boundary
- spatial joins to flood zones, census tracts, ZIP codes, school districts
- useful for map UX, portfolio visualization, de-duplicating parcel records

### 3.4 What listings / MLS data is

MLS data is **not** the same thing as public-record ownership data. It shows active listings, asking prices, listing photos, and listing status. But it is weak for this thesis because:

- it does not tell you the full owned portfolio
- it only covers listed inventory
- licensing is governed by MLS permissions and vendor contracts
- it is more relevant to agent/portal products than advancement research

MLS should be treated as optional enrichment, not the foundation.

---

## 4. Source Landscape: All Options Evaluated

### 4.1 Commercial APIs — Tier 1 (Enterprise/Comprehensive)

#### ATTOM Data Solutions (includes former RealtyTrac and Estated)

**The strongest single-vendor option for a first version.**

- **URL:** https://www.attomdata.com/solutions/property-data-api/
- **Data:** Property characteristics, ownership (owner names, mailing addresses), transaction history (deeds, sales), mortgage records, tax assessments, AVMs, foreclosure data, building permits
- **API:** REST API (JSON/XML), bulk data delivery, cloud, match & append
- **Pricing:** Starts at ~$95/month; 30-day free trial; custom enterprise pricing. Plans range from 1,000 to 1,000,000 calls/month. Only successful (HTTP 200) calls count against quota
- **Coverage:** 158M+ US properties, ~99% population coverage, nationwide
- **Owner names:** YES — dedicated `/property/detailowner` and `/property/detailmortgageowner` endpoints
- **Transaction history:** YES — 10 years via `/saleshistory/detail`
- **Assessed/market values:** YES — assessment, appraised, and AVM values
- **Mortgage/lien data:** YES — via `/property/detailmortgage`
- **Update frequency:** Daily updates for some datasets
- **Key endpoints:** `/property/detailowner`, `/property/detailmortgageowner`, `/saleshistory/detail`, `/property/basicprofile`
- **Limitations:** Enterprise-oriented pricing; older Estated API being deprecated in 2026 and migrated to ATTOM infrastructure
- **Verdict:** Most comprehensive source. Expensive but covers every data point needed.

#### CoreLogic (now Cotality)

- **URL:** https://developer.corelogic.com/
- **Data:** 200+ data sources. Property details, ownership, finance history, involuntary liens, transaction records, AVMs
- **Pricing:** Per-call: $0.005 (Address Type Ahead), $1.30 (Subject Property Detail), $2.30 (Finance History), $11.50 (Involuntary Lien). Enterprise contracts required
- **Coverage:** Nationwide — the largest underlying property database (most other providers license from CoreLogic)
- **Owner names:** YES
- **Limitations:** Enterprise-only; no self-serve signup; no free tier; approval process required
- **Verdict:** "Gold standard" data source but priced for large enterprises. Most other providers source from CoreLogic underneath.

#### First American DataTree

- **URL:** https://dna.firstam.com/api
- **Data:** Property ownership, recorded deed images, AVMs, tax assessments, lien reports, chain of title, mortgage records. 7 billion recorded land document images
- **API:** JSON-based REST API, bulk data licensing, web portal (DataTree.com)
- **Owner names:** YES — including full chain of title
- **Limitations:** No self-serve pricing; enterprise-focused
- **Verdict:** Excellent for deed/lien depth. Best for phase 2 or enterprise variant, not MVP.

#### Black Knight / ICE Mortgage Technology

- **URL:** https://mortgagetech.ice.com/products/property-data/residential
- **Data:** 150M+ US parcels. Tax assessor data, sales/mortgage deed records, foreclosure data, borrower event monitoring
- **API:** REST API, bulk, batch, FTP, XML
- **Owner names:** YES
- **Limitations:** Primarily serves mortgage/lending industry; enterprise contracts only
- **Verdict:** Impractical for startups.

### 4.2 Commercial APIs — Tier 2 (Mid-Market/Developer-Friendly)

#### Realie.ai — BEST VALUE FOR STARTUP

- **URL:** https://www.realie.ai/ | Docs: https://docs.realie.ai/
- **Data:** Property data with parcel geometry, tax assessments, ownership info. AI-powered aggregation from county sources
- **Pricing:**
  - Free: 25 requests/month ($0.15/overage)
  - Tier 1: $50/mo, 1,250 requests ($0.05/overage)
  - Tier 2: $150/mo, 6,000 requests ($0.03/overage)
  - Tier 3: $350/mo, 30,000 requests ($0.01/overage)
- **Coverage:** All 50 states, 180M+ parcels
- **Owner names:** YES (sourced from county records)
- **Verdict:** Cheapest nationwide coverage with owner names. Directly scrapes counties using AI, cutting out intermediary licensing costs. **Strong candidate for MVP.**

#### PropMix PubRec — BEST TRANSPARENT PRICING

- **URL:** https://pubrec.propmix.io/
- **Data:** 300 property attributes, deed history (20+ years), open mortgages (up to 4 liens), demographics
- **Pricing (transparent, per-call):**
  - **Property Data:** Free (50/mo) | Starter $79/mo (1K calls, $0.08/call) | Basic $495/mo (16.5K calls, $0.03/call) | Pro $2K/mo (100K calls, $0.02/call)
  - **Deed History:** Free (50/mo) | Starter $129/mo ($0.12/call) | Basic $745/mo ($0.045/call) | Pro $3K/mo ($0.03/call)
  - **Mortgages:** Same pricing as Deed History
- **Coverage:** 151M+ properties, 3,100+ counties nationwide
- **Owner names:** YES — ownership type, transferer/transferee details in deeds
- **Verdict:** Strong candidate. Transparent pricing, self-serve, includes owner names + deeds + mortgages. Starter tier ($79+$129/mo) is accessible.

#### BatchData

- **URL:** https://batchdata.io/
- **Data:** 700-1,000+ data points per property including ownership, tax assessments, sales history, skip tracing
- **Pricing:** Starts at $0.01/call; high-volume contracts can exceed $100K/year
- **Coverage:** 155M+ properties, 99.8% US coverage
- **Owner names:** YES
- **Verdict:** Good data depth but pricing escalates steeply. Better for batch operations.

#### RentCast

- **URL:** https://www.rentcast.io/api
- **Data:** Property records, owner details, home value estimates, rent estimates, comparable properties
- **Pricing:** Free: 50 calls/month; paid tiers scale up
- **Coverage:** 140M+ property records
- **Owner names:** YES
- **Verdict:** Good free tier for testing but rental-oriented. Supplementary source.

#### Smarty (formerly SmartyStreets)

- **URL:** https://www.smarty.com/products/us-property-data
- **Data:** 350+ property data points, ownership, parcel boundaries, tax details
- **API:** US Address Enrichment API — you feed in addresses and get property data back
- **Pricing:** 42-day free trial (1,000 lookups, no credit card); per-lookup pricing
- **Owner names:** YES — current owners, past owners, tenants, contact info
- **Verdict:** Interesting "address enrichment" approach. Good for append/enrich workflows.

#### HouseCanary

- **URL:** https://www.housecanary.com/
- **Data:** AVMs, 36-month forecasts, 75+ data points at property/census/ZIP/MSA levels
- **Pricing:** From $19/month; per-call $0.30-$6.00
- **Owner names:** Not prominently featured
- **Verdict:** Strong on valuations but not optimized for owner-name-based matching.

### 4.3 Commercial APIs — Tier 3 (Specialized/Niche)

| Provider | Focus | Owner Names | API | Verdict |
|---|---|---|---|---|
| **Reonomy** (Altus Group) | Commercial properties (54M+) | YES | Enterprise only | Commercial-only; not residential |
| **PropertyShark** (Yardi) | Property reports | YES | **No API** | Cannot use programmatically |
| **PropertyRadar** | 250+ criteria, contact info | YES | REST API | **License prohibits building products** — disqualified |
| **ProspectNow** (Buildout) | Ownership + contact data | YES | REST API, S3, SFTP | Pricing not published; enterprise |
| **Propwire** | 157M+ properties, skip tracing | YES | **No API** | Manual only; cannot integrate |
| **Datafiniti** | 122M+ single-family | UNCERTAIN | REST API, bulk | Owner names may not be available |
| **Precisely** | Property via Data Graph API | YES | REST API | Enterprise pricing |

### 4.4 Parcel/Boundary Specialist

#### Regrid (Loveland Technologies)

- **URL:** https://regrid.com/
- **Data:** Parcel boundaries with owner names, mailing addresses, deeded owner info, building footprints, zoning. Multiple owner names per parcel
- **API:** REST API (OpenAPI spec), tile server, bulk downloads (Shapefile, CSV)
- **Pricing:**
  - API sandbox: Free for 30 days
  - Per-county purchase via Data Store (variable pricing)
  - Nationwide bulk: starts at $80K/year
  - **Free for nonprofits/academics** via Data With Purpose program
- **Coverage:** Nationwide US + Canada, 157M+ parcels, 3,229 counties
- **Owner names:** YES — multiple owner names, mailing addresses, deeded owner info
- **Key owner fields:** `owner`, `unmodified_owner`, `ownfrst`, `ownlast`, `owner2/3/4`, `previous_owner`, `owntype`, `careof`, `mailadd`
- **Verdict:** Best parcel boundary source with owner names. Per-county model works for targeted screening. **Free for nonprofits** is potentially relevant for the ICP.

### 4.5 Free / Government / Open Data Sources

#### County Assessor Websites (3,100+ counties)

- **Data:** Owner names, mailing addresses, assessed values, property characteristics, tax amounts
- **Pricing:** FREE
- **Owner names:** YES — primary public record data
- **Portal for finding URLs:** https://publicrecords.netronline.com/ (NETR Online)
- **Limitation:** No unified API; each county is different; scraping often prohibited by TOS; enormous engineering effort to aggregate
- **Verdict:** Canonical free source but impractical to aggregate at national scale.

#### Counties with Good Open Data (Known Free Bulk Downloads)

| County/Jurisdiction | URL | Format | Owner Names | Notes |
|---|---|---|---|---|
| **Cook County, IL** | datacatalog.cookcountyil.gov | CSV, API | Some datasets | Excellent — values, sales, characteristics |
| **NYC (PLUTO)** | data.cityofnewyork.us | CSV, Shapefile, GeoJSON | YES | 80+ fields, 870K properties. Outstanding. |
| **Washington, DC** | opendata.dc.gov | CSV, API, Shapefile | YES (OWNERNAME, OWNNAME2) | CAMA data, 105K residential, weekly updates |
| **LA County, CA** | data.lacounty.gov | CSV | YES | Secured and unsecured rolls |
| **King County, WA** | info.kingcounty.gov | CSV | **NO** — removed per state law | Good characteristics data |
| **Wake County, NC** | wake.gov | Excel, Access, CSV | YES | Full data with qualified sales file |
| **Snohomish County, WA** | snohomishcountywa.gov | CSV, Shapefile | YES | Updated 3×/week |
| **Maricopa County, AZ** | data-maricopa.opendata.arcgis.com | Shapefile | Free boundaries only | Detailed attributes require purchase |

#### Statewide Free Datasets

| State | Notes |
|---|---|
| Minnesota | 59 opt-in counties, GAC standard schema, FileGDB/GeoPackage |
| Montana | Cadastral parcels via MSDI framework |
| New York State | Property assessment rolls submitted to state tax department |
| Connecticut | Statewide CAMA data |

Only about 10 US states have a complete, freely available, digital statewide parcel layer.

#### Federal Sources (Aggregate Only)

| Source | Useful For | Owner Names |
|---|---|---|
| US Census ACS API | Median home values, ownership rates by geography | NO — aggregate only |
| FHFA House Price Index | Area-level appreciation context | NO |
| FEMA NFHL | Flood risk / hazard overlays | NO |
| Data.gov | Federal property, some state datasets | NO |
| OpenAddresses | 500M+ geocoded addresses | NO — addresses only |

These are enrichment layers, not matching sources.

### 4.6 Summary: Which Sources Include Owner Names?

| Source | Owner Names | Values | Transactions | Mortgages | Pricing |
|---|:---:|:---:|:---:|:---:|---|
| ATTOM | ✅ | ✅ | ✅ (10yr) | ✅ | ~$95+/mo |
| CoreLogic | ✅ | ✅ | ✅ | ✅ | Enterprise |
| First American | ✅ | ✅ | ✅ | ✅ | Enterprise |
| Realie.ai | ✅ | ✅ | ✅ | Unclear | $50+/mo |
| PropMix PubRec | ✅ | ✅ | ✅ (20yr) | ✅ | $79+/mo |
| BatchData | ✅ | ✅ | ✅ | ✅ | $0.01/call |
| Regrid | ✅ | Partial | Partial | ❌ | Per-county or $80K/yr |
| RentCast | ✅ | ✅ | ✅ | Unclear | Free 50/mo |
| Smarty | ✅ | ✅ | Unclear | Unclear | Per-lookup |
| County Assessors | ✅ | ✅ | Partial | ❌ | Free |
| Census/ACS | ❌ | Aggregate | ❌ | ❌ | Free |

---

## 5. Owner Name Matching — The Core Technical Challenge

Real-estate matching is harder than SEC and different from political. County assessor records have **no national standard** for name formatting. Each of the 3,143 US counties has its own system.

### 5.1 How owner names are stored in property records

**Individual owners:**
```
SMITH JOHN A                    # LAST FIRST MIDDLE (most common — no comma!)
SMITH, JOHN A                   # With comma (some counties)
SMITH JOHN ALLEN                # Full middle name
SMITH J A                       # Initials only
JOHN A SMITH                    # FIRST MIDDLE LAST (less common)
```

**Joint/spousal ownership:**
```
SMITH JOHN & JANE               # Ampersand separator
SMITH JOHN AND JANE             # Word separator
SMITH JOHN A & SMITH JANE B     # Full names repeated
SMITH JOHN & JANE, HUSBAND AND WIFE
SMITH JOHN A, JANE B SMITH, AS JOINT TENANTS
```

**Trust ownership:**
```
SMITH FAMILY TRUST
JOHN SMITH REVOCABLE TRUST
J SMITH REVOCABLE TRUST
THE JOHN AND JANE SMITH FAMILY TRUST
SMITH TRUST DATED 01/15/2003
SMITH JOHN A, TRUSTEE           # Trustee name even when trust owns property
123 MAIN STREET TRUST           # Property-named trust — privacy technique
```

**LLC/Corporate ownership:**
```
SMITH HOLDINGS LLC
SJ PROPERTIES LLC
SMITH JOHN A, MANAGER           # LLC manager on operating agreement
```

**Latin legal abbreviations:**
```
SMITH JOHN A ETUX               # "Et ux" = and wife (unnamed)
SMITH JANE A ETVIR              # "Et vir" = and husband
SMITH JOHN A ETAL               # "Et al" = and others
SMITH JOHN A JTRS               # Joint tenants with right of survivorship
SMITH JOHN A TTEE               # Trustee
SMITH JOHN A TR                 # Trustee (abbreviated)
SMITH JOHN A % WELLS FARGO      # Care-of (%) indicator
```

### 5.2 Abbreviation dictionary

From Berkeley Advanced Media Institute, Wisconsin DOR, US Title Records:

```typescript
const REAL_ESTATE_ABBREVIATIONS: Record<string, string> = {
  // Ownership type
  "TTEE":  "TRUSTEE",
  "TR":    "TRUSTEE",
  "TRS":   "TRUSTEES",
  "TRST":  "TRUST",
  "JTRS":  "JOINT_TENANTS_ROS",
  "JT":    "JOINT_TENANT",
  "TEN":   "TENANT",
  "TC":    "TENANTS_IN_COMMON",

  // Relational
  "ETUX":   "AND_WIFE",
  "ET UX":  "AND_WIFE",
  "ETVIR":  "AND_HUSBAND",
  "ET VIR": "AND_HUSBAND",
  "ETAL":   "AND_OTHERS",
  "ET AL":  "AND_OTHERS",

  // Entity
  "LLC":  "LIMITED_LIABILITY_COMPANY",
  "LP":   "LIMITED_PARTNERSHIP",
  "INC":  "INCORPORATED",
  "CORP": "CORPORATION",
  "ASSN": "ASSOCIATION",
  "DTD":  "DATED",
  "FBO":  "FOR_BENEFIT_OF",
  "AKA":  "ALSO_KNOWN_AS",
  "DBA":  "DOING_BUSINESS_AS",
  "SUCC": "SUCCESSOR",
  "SURV": "SURVIVOR",
  "DECD": "DECEASED",
  "EST":  "ESTATE",
  "PERS REP": "PERSONAL_REPRESENTATIVE",
};
```

### 5.3 How common is trust/LLC ownership?

Trust and LLC ownership is **very common** among high-net-worth individuals — precisely the population prospect researchers care about. The wealthier the individual, the more likely properties are held in trusts or LLCs for asset protection, estate planning, and privacy. This creates a paradox: **the most valuable prospects are the hardest to match by name.**

Approaches to pierce the veil:
- **Deed transfer documents:** Even trust-held properties must name a trustee as legal signatory (e.g., "John Smith, Trustee")
- **Secretary of State filings:** LLCs must list a registered agent or managing member
- **Mailing address:** Tax bills go to a physical person — the mailing address often reveals the individual behind an entity
- **Entity resolution services:** ATTOM uses ML-based entity resolution to connect corporate-owned properties to individuals

### 5.4 Owner name parsing architecture

The parser should be a pipeline of stages, not a single regex:

```
Raw owner string
  → Uppercase normalize
  → Entity type classifier (individual vs trust vs LLC vs estate)
  → Multi-owner splitter (on "&", "AND")
  → Per-owner parser (last-first-middle extraction)
  → Abbreviation expansion
  → PersonNameParts output per individual
```

**Stage 1 — Entity Type Classification:**

Detect whether the string is a trust, LLC, estate, or individual(s). Key signals:
- Contains "TRUST", "TRST", "LIVING TRUST", "FAMILY TRUST", "REVOCABLE" → trust
- Contains "LLC", "LP", "INC", "CORP" → entity
- Contains "ESTATE OF", "EST OF", "DECD" → estate
- Otherwise → individual(s)

**Stage 2 — Trust Name to Individual Resolution:**

Trust names almost always embed the grantor's surname. Patterns (ordered by specificity):

```typescript
const TRUST_NAME_PATTERNS = [
  // "JOHN A SMITH REVOCABLE LIVING TRUST DTD 01/01/2020"
  /^(.+?)\s+(?:REVOCABLE|IRREVOCABLE|LIVING|FAMILY)\s+TRUST/i,
  // "THE SMITH FAMILY TRUST"
  /^THE\s+(\w+)\s+FAMILY\s+TRUST/i,
  // "SMITH FAMILY TRUST"
  /^(\w+)\s+FAMILY\s+TRUST/i,
  // "SMITH J A TTEE" or "SMITH J A TR"
  /^(.+?)\s+(?:TTEE|TR|TRS|TRUSTEE|TRUSTEES)\s*$/i,
];
```

**Stage 3 — Multi-Owner Splitting:**

The ampersand "&" is the primary multi-owner delimiter. But cannot blindly split on "&" because it appears in entity names ("SMITH & JONES LLC"). Rules:
1. If classified as an entity (LLC, Corp), do not split
2. Split on `" & "` (space-ampersand-space)
3. The second owner often shares the last name of the first: `SMITH JOHN A & MARY B` means "JOHN A SMITH" and "MARY B SMITH" — propagate the last name

**Stage 4 — Last-Name-First Parsing:**

Assessor records almost universally use LAST FIRST MIDDLE format (**no comma**). This is different from FEC data which has commas. Heuristics:
- If only 2 tokens: `SMITH JOHN` → last=SMITH, first=JOHN
- If 3 tokens and third is single char: `SMITH JOHN A` → last=SMITH, first=JOHN, middle=A
- If 3+ tokens: use first token as last name (correct ~95% of the time for assessor data)
- Hyphenated last names: `SMITH-JONES JOHN` → last=SMITH-JONES, first=JOHN

### 5.5 What @pm/core provides and what's missing

**Reusable from @pm/core:**
- `parsePersonName()` — handles "First Last" and "Last, First" formats. Works for prospect-side parsing.
- `generateNameVariants()` — nickname expansion, suffix stripping, middle-dropping. Directly applicable.
- `buildProspectIndex()` — builds the Map<string, IndexedProspect[]> lookup. Core of matching engine.
- `NICKNAME_LOOKUP` (53 groups) — essential for matching "WILLIAM" in assessor data against "Bill" in prospect list.
- `loadProspects()` — CSV loading with flexible column aliases. Reusable directly.
- `StateStore` — resumable processing with PID-based locking.

**New code needed (not in @pm/core today):**
1. **`parseOwnerName()`** — new function for LAST-FIRST (no comma) assessor format
2. **`classifyOwnerEntity()`** — determine if string is individual/trust/LLC/estate
3. **`splitMultiOwner()`** — split "&" delimited co-owners with last-name propagation
4. **`extractTrustIndividual()`** — extract person name from trust strings
5. **`expandAbbreviations()`** — TTEE, ETAL, ETUX dictionary expansion
6. **Address normalization and comparison functions** — entirely new domain
7. **New VariantType values** — e.g., `"trust_extracted"`, `"co_owner"`, `"address_match"`

---

## 6. Address-Based Matching

### 6.1 Why address matching matters

Name matching alone produces ambiguity for common names ("JOHN SMITH" in assessor data matches dozens of prospects). Address is the strongest disambiguation signal — if a prospect's home address matches a property's situs address or owner mailing address, confidence jumps to near-certain.

### 6.2 Address normalization pipeline

```
Raw address string
  → Parse into components (number, street, unit, city, state, zip)
  → Normalize street types (Street → ST, Avenue → AVE, Drive → DR)
  → Normalize directionals (North → N, Southwest → SW)
  → Strip unit/apt designators for comparison
  → Standardize ZIP to ZIP+4 if possible
  → Generate comparison key: "{number} {street_normalized} {zip5}"
```

### 6.3 Library options for address parsing

For our setup (Mac M1, 8GB RAM, TypeScript/Node.js):

| Library | Recommendation | Notes |
|---|---|---|
| **@zerodep/address-parse** | **Best pick** | Zero dependencies, TypeScript types, US/Canadian, PO Boxes, rural routes. No native compilation. |
| **vladdress** | Good alternative | TypeScript-native rewrite of addresser, US & Canada |
| **addresser** | Fallback | Normalizes state names/abbreviations, validates city-state. 7 years old but stable. |
| **node-postal (libpostal)** | Most powerful but heavy | 98.9% accuracy, 60+ languages, but requires C library compilation, 750MB model download, needs `--disable-sse2` on M1. **Overkill for US-only.** |

**Recommendation:** Start with `@zerodep/address-parse` (zero deps, TypeScript). Escalate to libpostal only if accuracy issues arise.

### 6.4 Geocoding / USPS validation APIs

| Service | Free Tier | Cost | Best For |
|---|---|---|---|
| **US Census Geocoder** | Unlimited, free | $0 | Batch geocoding, no API key |
| **Geocodio** | 2,500/day free | $1/1,000 lookups | Best free tier + quality. Returns Census data. |
| **Smarty (SmartyStreets)** | 250/month free | Paid tiers | USPS CASS-certified. JS SDK on npm. |
| **Nominatim (OSM)** | Free (1 req/sec) | $0 (self-host for bulk) | Fallback geocoder |
| **Google Geocoding** | $200/mo credit | $5/1,000 | Highest accuracy, expensive at scale |

**Recommended tiered strategy:**
1. First pass: `@zerodep/address-parse` for component extraction (local, no API)
2. For validation: Geocodio free tier (2,500/day)
3. For USPS standardization on high-confidence matches: Smarty free tier (250/month)

### 6.5 Address comparison strategy

Rather than exact string matching, compare normalized components:

```typescript
interface AddressMatchResult {
  status: "exact" | "strong" | "partial" | "zip_only" | "mismatch";
  confidence: number; // 0-100
  matchedComponents: string[];
}

// Exact: all components match after normalization
// Strong: street number + street name + ZIP match (unit may differ)
// Partial: ZIP + street name match but number differs
// ZIP-only: same ZIP code only
// Mismatch: nothing matches
```

---

## 7. County Assessor Data Schemas — Real Examples

### 7.1 NYC PLUTO Dataset (Best Open Data Example)

870,000+ properties, 80+ attributes. Available as CSV, GeoJSON, Shapefile.

| Field | Description |
|---|---|
| Borough, Block, Lot | Tax lot identifier (BBL) |
| OwnerName | Property owner |
| LotArea | Lot area in sqft |
| BldgArea | Total building floor area |
| ComArea, ResArea, OfficeArea, RetailArea | Area by use type |
| NumBldgs, NumFloors | Building counts |
| UnitsRes, UnitsTotal | Residential and total units |
| YearBuilt, YearAlter1, YearAlter2 | Construction/alteration years |
| AssessLand, AssessTot | Assessed values |
| ExemptTot | Total exempt value |
| BldgClass | Building class code |
| ZoneDist1-4 | Zoning districts |

### 7.2 Washington DC CAMA (Best-Documented CAMA Dataset)

105,932 records, updated weekly.

| Field | Type | Description |
|---|---|---|
| SSL | String | Square-Suffix-Lot identifier |
| BATHRM, HF_BATHRM | Integer | Bathrooms, half-baths |
| BEDRM, ROOMS | Integer | Bedrooms, total rooms |
| KITCHENS, FIREPLACES | Integer | |
| STORIES | Integer | Number of stories |
| GBA, LIVING | Integer | Gross building area, livable sqft |
| LANDAREA | Integer | Land area sqft |
| AYB, EYB | Year | Actual year built, effective year built |
| YR_RMDL | Year | Year remodeled |
| SALEDATE | Date | Most recent sale date |
| PRICE | Currency | Most recent sale price |
| QUALIFIED | Code | Arms-length sale indicator |
| **OWNERNAME** | String | **Owner name** |
| **OWNNAME2** | String | **Second owner** |
| PREMISEADD | String | Property address |
| USECODE | Code | Property use code |
| STYLE_D, STRUCT_D | String | Architectural style, structure type |
| GRADE_D, CNDTN_D | String | Construction grade, condition |

### 7.3 Cook County, IL (Assessor GitHub — Most Transparent)

The Cook County Assessor's Office publishes their entire data architecture on GitHub (https://github.com/ccao-data).

**Assessed Values** (dataset `uzyt-m557`):
- `pin` — 14-digit Parcel Index Number (must be zero-padded!)
- `tax_year`
- `class` — property class code
- `mailed_land/bldg/tot` — initial assessed values
- `certified_land/bldg/tot` — post-appeal values
- `board_land/bldg/tot` — Board of Review final values

**Parcel Sales** (dataset `wvhk-k5uv`): arms-length sales used for modeling.

### 7.4 Canonical schema recommendation

Use Regrid's schema as a reference model. It covers 150+ fields tested against data from 3,229 counties. Their Enhanced Ownership Schema adds parsed name components (first/middle/last/suffix) for up to 4 owners.

A per-county JSON column mapping config (same pattern as `@pm/core`'s `prospect-loader.ts` column aliases) would map source fields to the canonical schema:

```json
{
  "county": "cook_county_il",
  "fips": "17031",
  "source_format": "csv",
  "field_map": {
    "pin": "parcel_id",
    "property_address": "situs_address",
    "property_city": "situs_city",
    "mailed_tot": "assessed_total",
    "mailed_land": "assessed_land",
    "mailed_bldg": "assessed_improvement",
    "class": "use_code"
  }
}
```

---

## 8. Matching Architecture

### 8.1 Minimum viable matching inputs

If the prospect CSV only has `name + company`, matching quality will be materially weaker than political.

For real-estate, the preferred inputs are:

- prospect name
- aliases / alternate names
- home address or mailing address
- city
- state
- spouse / partner name if available
- known entity names or foundation / family office names if available

If we only have `name + city + state`, we can still build a matcher, but review load will be higher.

### 8.2 Candidate-generation strategy

**Stage 1 — Owner-name blocking:**

Use normalized owner strings to generate candidates:
- exact first + last
- suffix stripped
- middle dropped
- nickname variants
- co-owner split handling

**Stage 2 — Trust / entity parsing:**

Look for patterns: `REVOCABLE TRUST`, `FAMILY TRUST`, `LIVING TRUST`, `TRUSTEE`, `[LAST NAME] LLC`, `[LAST NAME] HOLDINGS`. These produce lower-confidence candidates unless corroborated.

**Stage 3 — Address corroboration:**

Compare:
- prospect known address vs owner mailing address
- prospect city/state vs situs city/state
- prospect city/state vs owner mailing city/state

If prospect address equals owner mailing address, confidence jumps sharply.

**Stage 4 — Portfolio corroboration:**

If one prospect matches multiple properties with consistent owner-mailing evidence, confidence should rise. Same owner name + same mailing address + multiple parcels in same metro = strong signal.

### 8.3 Proposed scoring model

```typescript
const SCORING_WEIGHTS = {
  // Name matching
  name_exact:           50,  // "john smith" == "john smith"
  name_nickname:        40,  // "william" matched via "bill"
  name_suffix_stripped: 45,  // "john smith jr" → "john smith"
  name_middle_dropped:  42,  // "john andrew smith" → "john smith"
  name_initial_variant: 43,  // "john a smith" matches "john andrew smith"
  name_trust_extracted: 35,  // Name extracted from trust name
  name_co_owner:        30,  // Second owner after "&" split
  name_fuzzy_high:      30,  // Jaro-Winkler >= 0.92
  name_fuzzy_medium:    20,  // Jaro-Winkler 0.85-0.92
  name_last_only:       15,  // Only last name matched

  // Address matching
  address_exact:        45,  // Full address match
  address_strong:       35,  // Number + street + ZIP match
  address_zip_street:   20,  // ZIP + street name (no number)
  address_city_state:   10,  // Same city/state only

  // Penalties
  state_mismatch:      -20,  // Prospect in NY, property in CA
  common_name_penalty: -10,  // "JOHN SMITH" gets penalized
};

// Confidence tiers
// >= 80: HIGH    (auto-include in output)
// 60-79: MEDIUM  (include, flag for review)
// 40-59: LOW     (include only if secondary signals confirm)
// < 40:  REVIEW  (include in separate review file)
```

### 8.4 Common false-positive patterns

- Common names like `John Smith`, `David Lee`, `Maria Garcia`
- Parent/child with the same name
- Trust names containing only surname
- LLCs named after streets, neighborhoods, or abstract words
- Owner records with initials only
- Stale assessor owner snapshot after a recent deed

This means the app needs a `client.csv` vs `review.csv` pattern similar to the political matcher.

### 8.5 String similarity for fuzzy name comparison

| Library | Best For | Notes |
|---|---|---|
| **cmpstr** | **Best all-around** | TypeScript, dependency-free, Jaro-Winkler + Dice-Sorensen + Levenshtein + q-Gram. Redesigned 2025 for batch. |
| **jaro-winkler-typescript** | Minimal | Single algorithm, TypeScript native |
| **fuzzball** | Deduplication | Has `dedupe()` convenience function |

**Jaro-Winkler is the best algorithm for person names** — it weights prefix matches heavily, which is ideal because names sharing a prefix (WILL/WILLIAM, ROB/ROBERT) are more likely to be the same person.

### 8.6 Entity resolution approaches (tiered)

**Tier 1: Rule-Based with Confidence Scoring (recommended start)**

This is what our existing SEC and political matchers already do. A series of deterministic rules produce a weighted confidence score. Best starting point because:
- Pattern already established in the monorepo
- Prospect research analysts need explainable results
- PM requirement: "NEVER miss a real match" — rules give explicit control over recall
- 10-in-100 FP tolerance means we can be aggressive and post-filter

**Tier 2: Probabilistic (Fellegi-Sunter Model)**

[Splink](https://github.com/moj-analytical-services/splink) is the leading open-source implementation. Can link a million records on a laptop in ~1 minute. Uses DuckDB as backend (no Spark needed). **Python-only** — would need subprocess call or port the Bayesian weight math to TypeScript.

**Tier 3: Machine Learning (dedupe.io style)**

[Dedupe](https://github.com/dedupeio/dedupe) uses active learning — presents ambiguous pairs for human labeling, trains a classifier. Also **Python-only**.

**Recommendation:** Start with Tier 1 (rule-based) and design the scoring as a pluggable strategy:

```typescript
interface MatchScorer {
  score(prospect: ProspectRecord, property: PropertyRecord): PropertyMatchScore;
}

class RuleBasedScorer implements MatchScorer { ... }  // Start here
class ProbabilisticScorer implements MatchScorer { ... }  // Upgrade later
```

---

## 9. Processing Pipeline

### 9.1 Full pipeline flow

```
Phase 1: INGEST
  Prospect CSV → loadProspects() (from @pm/core)
  Property data → assessor-csv parser OR API fetcher

Phase 2: INDEX
  Prospects → buildProspectIndex() (from @pm/core, extended)
  Properties → parseOwnerName() → classifyEntity() → splitMultiOwner()
             → For each individual: normalize to PersonNameParts

Phase 3: MATCH (name)
  For each property owner name:
    1. Exact lookup in prospect index (O(1) via Map)
    2. Name variant generation → lookup each variant
    3. If trust: extract individual name → repeat steps 1-2
    4. Fuzzy match via Jaro-Winkler for near-misses (only if no exact/variant hit)

Phase 4: MATCH (address, secondary)
  For matches from Phase 3 with confidence < threshold:
    Compare prospect address → property situs/mailing address
    Boost confidence if address matches

  For prospects with addresses but NO name match:
    Direct address lookup (high-confidence regardless of name)

Phase 5: SCORE
  Combine name score + address score + city/state match
  Apply capacity formula (5-year giving estimate from property values)
  Apply confidence tiers: high / medium / low / review

Phase 6: EXPORT
  client.csv, review.csv, manifest, stats
  (Same pattern as SEC/political matchers)
```

### 9.2 Performance considerations for M1 8GB RAM

- 10,000 prospects with ~50 variants each = ~500K index entries = ~50MB in memory (fine)
- Stream property records from CSV/API, don't buffer all in memory
- Process in county-sized chunks (typically 100K-500K parcels per county)
- Use @pm/core's StateStore for resumability

---

## 10. What Information We Can Show the ICP

The ICP does not need an appraiser's workbench. They need prospect research signals.

### 10.1 Core outputs

**A. Property portfolio summary** (per matched prospect):
- Number of owned properties
- Total assessed value + total estimated value (if AVM available)
- States / metros represented
- Residential vs commercial mix
- **Estimated 5-year giving capacity from real estate** (using industry formula)

**B. Notable holdings** (per property):
- Address, property type
- Owner name on record
- Assessed value, estimated value
- Last sale date and amount
- Mortgage amount and lender (if available)
- Owner-occupied vs absentee flag
- Mailing address relationship

**C. Recent activity alerts:**
- Purchased a $4.2M property last month
- Sold a long-held asset
- Refinanced with a large mortgage
- Transferred property into a trust/LLC

**D. Ownership pattern signals:**
- Absentee owner
- Second-home/vacation-home footprint
- Trust-owned property
- Multiple-property portfolio
- Holdings concentrated in high-value ZIPs

**E. Review evidence** (every match must show):
- Record owner string
- Matched prospect name
- Confidence score + match reason
- Evidence fields used
- Vendor/property ID/APN

### 10.2 Signals that should be treated carefully

**Distress / foreclosure:** Data exists and can be sourced, but it is sensitive. Only surface for operations/review workflows, not default gift-officer output.

**Debt-heavy signals:** Large mortgages can mean leverage, not wealth. Show as context, don't convert to simplistic wealth scores.

### 10.3 Suggested CSV output columns

- Prospect ID
- Prospect Name
- Match Confidence
- Match Quality (high / medium / low / review)
- Owner Name on Record
- Ownership Type (individual / trust / LLC / joint)
- Property Address, City, State
- Property Type
- Owner Mailing Address
- Owner-Occupied Flag
- Assessed Value
- Estimated Value
- Last Sale Date
- Last Sale Amount
- Mortgage Amount
- Lender
- Estimated 5-Year Giving Capacity (from real estate)
- Signal Tier (1/2/3)
- Signal (High-Value Primary Residence / Recent Purchase / Second Home / Multi-Property Portfolio / Commercial Holding / Trust-Owned Asset / Recent Refinance)
- Action (Review for capacity recalibration / Add to pre-meeting briefing / Route to prospect research / Monitor for future activity)
- Match Reason
- Source Property ID / APN

---

## 11. Privacy and Compliance

### 11.1 Is real estate ownership data truly public record?

**Yes, overwhelmingly.** Recording of real estate documents exists for one legal purpose: "to give notice to the rest of the world of the rights granted in a conveyance." County Registers of Deeds are public offices.

**Exceptions:**
- **Law enforcement / protected professions:** Some states (FL, TX, others) exempt certain individuals (peace officers, judges, child protective services employees) from having home addresses publicly searchable. Texas Tax Code Section 25.025 allows these individuals to keep addresses confidential.
- **Social Security Numbers:** Must never be exposed. TX Attorney General issued a 2007 opinion making it a violation to display SSNs from real estate records.
- **Trust/LLC privacy:** Using trusts or LLCs to hold property is a **legal privacy technique**, not a restriction on the public record itself.

### 11.2 FCRA implications for donor screening

**Key test:** The FCRA applies when information is "used or expected to be used" to determine eligibility for credit, insurance, employment, or other specified purposes.

**For nonprofit donor screening:**
- Donor screening is **not** a permissible purpose listed in the FCRA
- If real estate data is used solely to estimate philanthropic capacity — **not** to determine eligibility for credit, insurance, or employment — it likely falls **outside FCRA scope**
- The FTC has warned: "Just saying you're not a consumer reporting agency isn't enough." The actual use determines FCRA applicability
- Major tools (WealthEngine, iWave, DonorSearch) operate in this space and structure their services to fall outside FCRA scope

**Practical guidance:**
- Using raw public records directly for fundraising purposes is generally outside FCRA scope
- State privacy laws (CCPA, CDPA) may impose separate requirements around data collection and consumer rights

### 11.3 Apra ethics guidelines

The Association of Professional Researchers for Advancement (Apra) provides the industry framework:

1. Support the individual's fundamental right to privacy
2. Ethical collection and use of information
3. Follow all applicable laws governing collection, use, and dissemination
4. Clear policies and procedures for data handling
5. Transparency — provide privacy policy, allow opt-out
6. Due diligence on donor stewardship
7. Balance privacy rights with organizational needs

**Best practices for our product:**
- Be transparent about data sources and how they are used
- Allow individuals to request what data is held about them
- Do not store more data than needed
- Make clear that capacity estimates are directional, not definitive
- Train users that real estate data reveals capacity, not intent

---

## 12. Architecture Recommendation

### 12.1 Recommended app structure

```
apps/real-estate/
├── src/
│   ├── cli/                          # CLI commands
│   │   ├── index.ts                  # Entry point (restate CLI)
│   │   ├── run.ts                    # Main matching command
│   │   ├── fetch.ts                  # Data download commands
│   │   └── inspect.ts                # Debug/inspect matches
│   ├── core/
│   │   ├── RealEstateMatcher.ts      # Main matching engine
│   │   ├── types.ts                  # Re-exports @pm/core types + RE-specific
│   │   └── confidence-scorer.ts      # Scoring logic
│   ├── parsers/
│   │   ├── owner-name-parser.ts      # LAST FIRST format, trust, multi-owner
│   │   ├── address-parser.ts         # Address normalization wrapper
│   │   └── assessor-csv.ts           # County assessor CSV format handling
│   ├── fetchers/
│   │   ├── attom.ts                  # ATTOM Data API
│   │   ├── realie.ts                 # Realie.ai API
│   │   ├── county-bulk.ts            # Direct county download handler
│   │   └── geocodio.ts              # Address geocoding
│   ├── lib/
│   │   ├── address-matcher.ts        # Address comparison logic
│   │   ├── owner-entity-classifier.ts # Trust/LLC/individual detection
│   │   ├── abbreviation-expander.ts  # TTEE, ETUX, etc.
│   │   ├── multi-owner-splitter.ts   # "&" / "AND" splitting
│   │   └── capacity-formula.ts       # Industry-standard giving capacity calc
│   └── io/
│       └── csv-export.ts             # Client-ready CSV output
├── tests/
├── package.json
└── tsconfig.json
```

### 12.2 Recommended tech stack

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

| Purpose | Library | Why |
|---|---|---|
| Name parsing (prospect side) | `@pm/core` parsePersonName() | Already built, tested |
| Name variants + nicknames | `@pm/core` generateNameVariants() | 53 nickname groups |
| Prospect indexing | `@pm/core` buildProspectIndex() | Map-based O(1) lookup |
| Name parsing (assessor side) | New `owner-name-parser.ts` | LAST FIRST, trusts, abbreviations |
| Address parsing | `@zerodep/address-parse` | Zero deps, TypeScript, no native compilation on M1 |
| String similarity | `cmpstr` | TypeScript, Jaro-Winkler, dependency-free |
| Prospect CSV loading | `@pm/core` loadProspects() | Flexible column aliases |
| State management | `@pm/core` StateStore | PID-locked, resumable |
| Giving capacity calc | New `capacity-formula.ts` | Industry-standard tiered formula |

**What NOT to use:**
- **libpostal/node-postal**: C library, 750MB model download, M1 issues. Overkill for US-only.
- **Splink/dedupe**: Python-only. Consider only if you outgrow rule-based scoring.
- **Google Geocoding**: Expensive at scale ($5/1,000). Use Geocodio first.

---

## 13. External Dependencies

### 13.1 Required

**A. Primary property data source** (pick one):
- ATTOM (best single vendor) — ~$95+/month
- Realie.ai + PropMix (best budget option) — ~$130+/month
- BatchData — ~$0.01/call
- Regrid + recorder source

Without this, nationwide scale is too slow.

**B. Address normalization / geocoding:**
- Free baseline: US Census Geocoder
- Production: Smarty or Geocodio

**C. Storage / state management:**
- StateStore pattern from @pm/core

### 13.2 Strongly recommended

**D. Entity resolution:**
- OpenCorporates for LLC/business lookup and officer context
- State Secretary of State sources in key jurisdictions

**E. Federal enrichment layers:**
- Census ACS for neighborhood housing/income context
- FHFA HPI for area-level appreciation
- FEMA NFHL for hazard context

### 13.3 Optional later

**F. Maps / tiles:** Regrid tiles, Mapbox, Esri
**G. Permit / renovation feeds:** Can become separate product surface
**H. Listings / MLS:** Only as optional enrichment

---

## 14. Pricing Comparison for MVP

### Budget MVP (~$130/month)

| Component | Provider | Cost |
|---|---|---|
| Property + owner data | Realie.ai Tier 1 | $50/mo (1,250 requests) |
| Deed history | PropMix PubRec Starter | $79/mo (1,000 calls) |
| Geocoding | Geocodio | Free (2,500/day) |
| Address parsing | @zerodep/address-parse | Free (npm package) |
| **Total** | | **~$129/month** |

### Production MVP (~$650/month)

| Component | Provider | Cost |
|---|---|---|
| Property + owner data | Realie.ai Tier 2 | $150/mo (6,000 requests) |
| Deed + mortgage history | PropMix PubRec Basic | $495/mo (16,500 calls) |
| Geocoding | Geocodio | Free (2,500/day) |
| **Total** | | **~$645/month** |

### Comprehensive single-vendor ($500+/month)

| Component | Provider | Cost |
|---|---|---|
| All-in-one | ATTOM | ~$500-1,000+/mo (quote-based) |
| Geocoding | Included in ATTOM | — |
| **Total** | | **~$500-1,000+/month** |

### Free/scrappy testing approach

| Component | Provider | Cost |
|---|---|---|
| Property testing | Realie.ai free tier | Free (25/month) |
| Deed testing | PropMix free tier | Free (50/month) |
| Property testing | RentCast free tier | Free (50/month) |
| Geocoding | Census Geocoder | Free (unlimited) |
| County bulk data | DC/NYC/Cook County portals | Free |
| **Total** | | **$0** |

---

## 15. Risks and Caveats

### Data risks

- County lag and stale owner snapshots (18-25% of assessor records may not match the most recently recorded deed)
- Assessor and recorder disagreeing temporarily
- Incomplete sale price disclosure in some states or document types
- Trust / LLC opacity — wealthiest prospects are hardest to match

### Matching risks

- Common names (SMITH, JOHNSON, WILLIAMS, BROWN, JONES = top 5)
- Family members sharing names (parent/child)
- Entity-only ownership with no name overlap
- Stale mailing addresses

### Product risks

- If the user only gives us names, review volume rises
- If we over-index on distress signals, the product can feel off-mission for advancement
- If we choose a parcel-only vendor, transaction richness may disappoint

### Commercial risks

- Vendor contracts and pricing
- Redistribution restrictions
- County-source licensing nuance if we ingest directly

---

## 16. Bottom Line

The best version of the real-estate matcher is:

- a **nationwide public-record matcher**
- centered on **ownership, value, portfolio, and transaction signals**
- with **estimated giving capacity** using industry-standard formulas
- with **reviewable evidence** (not a black box)
- using a **vendor-first architecture** for MVP

If we build it this way, it complements the other apps cleanly:

- SEC matcher: liquidity / insider / corporate-event signals
- Political matcher: giving / values / influence signals
- Nonprofit matcher: philanthropic footprint / board signals
- Real-estate matcher: **hard-asset / ownership / portfolio / capacity signals**

That is a coherent suite for the same ICP.

---

## Sources

### Primary data vendors

- [ATTOM Assessor Data](https://www.attomdata.com/data/property-data/assessor-data/)
- [ATTOM Recorder Data](https://www.attomdata.com/data/transactions-mortgage-data/recorder-data/)
- [ATTOM Property API docs](https://api.developer.attomdata.com/dlpv2docs)
- [ATTOM Property Data API FAQ](https://www.attomdata.com/solutions/property-data-api/faqs/)
- [Regrid Support Center](https://support.regrid.com/)
- [Regrid Parcel API docs](https://support.regrid.com/api/using-the-parcel-api)
- [Regrid Enterprise](https://regrid.com/enterprise)
- [Regrid Enhanced Ownership Schema](https://support.regrid.com/parcel-data/enhanced-ownership-schema)
- [Regrid Data With Purpose (Nonprofits)](https://regrid.com/purpose)
- [First American DataTree](https://www.firstam.com/mortgagesolutions/solutions/data-analytics/datatree.html)
- [CoreLogic Developer Portal](https://developer.corelogic.com/)
- [BatchData Property Search](https://batchdata.io/property-search)
- [PropMix PubRec](https://pubrec.propmix.io/)
- [PropMix PubRec Pricing](https://pubrec.propmix.io/pricingplan.php)
- [Realie.ai](https://www.realie.ai/)
- [Realie.ai API Pricing](https://docs.realie.ai/api-reference/pricing)
- [RentCast API](https://www.rentcast.io/api)
- [Smarty US Property Data](https://www.smarty.com/products/us-property-data)
- [HouseCanary Pricing](https://www.housecanary.com/pricing)
- [ICE Mortgage Technology](https://mortgagetech.ice.com/products/property-data/residential)

### County / open data sources

- [NYC PLUTO Dataset](https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks)
- [NYC PLUTO Data Dictionary](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/pluto_datadictionary.pdf)
- [DC CAMA Residential Dataset](https://opendata.dc.gov/datasets/DCGIS::computer-assisted-mass-appraisal-residential/about)
- [Cook County Open Data](https://datacatalog.cookcountyil.gov/)
- [Cook County Assessor GitHub](https://github.com/ccao-data)
- [King County Assessor Data Download](https://info.kingcounty.gov/assessor/datadownload/default.aspx)
- [LA County Assessor Parcel Data](https://data.lacounty.gov/datasets/lacounty::assessor-parcel-data-rolls-2021-present/about)
- [Wake County Real Estate Data](https://www.wake.gov/departments-government/tax-administration/data-files-statistics-and-reports/real-estate-property-data-files)
- [Minnesota Statewide Parcels](https://gisdata.mn.gov/dataset/plan-parcels-open)
- [NYC ACRIS](https://www.nyc.gov/site/finance/property/acris.page)
- [NETR Online (County Assessor Portal)](https://publicrecords.netronline.com/)
- [OpenAddresses](https://openaddresses.io/)

### Federal / government sources

- [US Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)
- [Census ACS API](https://www.census.gov/programs-surveys/acs/data/data-via-api.html)
- [FHFA House Price Index](https://www.fhfa.gov/reports/house-price-index)
- [FEMA NFHL](https://www.fema.gov/fr/node/501308)
- [Data.gov Real Estate](https://catalog.data.gov/dataset/?tags=real-estate)

### Prospect research / competitive

- [iWave: Real Estate in Prospect Research](https://kindsight.io/resources/blog/real-estate-the-value-of-curb-appeal-in-prospect-research/)
- [iWave Capacity Calculation](https://support.iwave.com/s/article/iWave-Capacity-Calculation)
- [iWave CoreLogic Real Estate Data](https://kindsight.io/features/iwave-data/iwave-real-estate-data/)
- [Helen Brown Group: Capacity Ratings](https://www.helenbrowngroup.com/the-artful-science-of-capacity-ratings/)
- [Helen Brown Group: Why Wealth Screenings Rely on Real Estate](https://www.helenbrowngroup.com/why-wealth-screenings-and-prospect-researchers-are-so-reliant-on-real-estate/)
- [BWF: Capacity in High Cost-of-Living Areas](https://www.bwf.com/prospects-high-living-areas/)
- [Blackbaud ResearchPoint: Capacity Formula](https://webfiles-sc1.blackbaud.com/files/support/helpfiles/researchpoint/rphelp/content/mgwealthcapaddscr.html)
- [WealthEngine: Real Estate Data](https://wealthengine.com/articles/how-to-supercharge-screening-with-real-estate-data)
- [WealthEngine: Wealth Signal](https://wealthengine.com/articles/wealth-signal)
- [DonorSearch: Prospect Research Guide](https://www.donorsearch.net/prospect-research-ultimate-guide/)
- [Jennifer Filla: Capacity Rating Insights](https://www.jenniferfilla.com/top-5-capacity-rating-insights-for-research-professionals/)
- [Windfall: Wealth Screening](https://www.windfall.com/platform/wealth-screening)
- [AFP: Wealth Screening vs Prospect Research](https://afpglobal.org/wealth-screening-vs-prospect-research-know-difference)
- [Apra: Statement of Ethics](https://www.aprahome.org/Resources/Statement-of-Ethics)

### Technical / name parsing

- [Berkeley AMI: Real Estate Records Glossary](https://multimedia.journalism.berkeley.edu/tutorials/real-estate-records-glossary/)
- [Wisconsin DOR: Property Tax Abbreviations](https://www.revenue.wi.gov/Pages/OnlineServices/hcabbrev.aspx)
- [US Title Records: Deed Abbreviations](https://www.ustitlerecords.com/abbreviation-descriptions/)
- [LegalZoom: How to Name a Trust](https://www.legalzoom.com/articles/how-to-choose-a-name-for-your-trust)
- [Siegel Law: How Do You Name a Trust](https://siegellawgroup.com/faqs/how-do-you-name-a-trust/)
- [RESO Data Dictionary](https://www.reso.org/data-dictionary/)
- [MISMO Reference Model](https://www.mismo.org/standards-resources/residential-specifications/reference-model)
- [Splink (Probabilistic Record Linkage)](https://github.com/moj-analytical-services/splink)
- [Dedupe.io (Active Learning Entity Resolution)](https://github.com/dedupeio/dedupe)

### Libraries / tools

- [CmpStr (String Similarity)](https://github.com/komed3/cmpstr)
- [@zerodep/address-parse](https://www.npmjs.com/package/@zerodep/address-parse)
- [Geocodio Pricing](https://www.geocod.io/pricing/)
- [Smarty JavaScript SDK](https://www.npmjs.com/package/smartystreets-javascript-sdk)
- [OpenCorporates API](https://api.opencorporates.com/v0.3/documentation/API-Reference)

### Legal / compliance

- [FTC: Background Screening and FCRA](https://www.ftc.gov/business-guidance/blog/2013/01/background-screening-reports-fcra-just-saying-youre-not-consumer-reporting-agency-isnt-enough)
- [Apra: Prospect Development Best Practices](https://www.aprahome.org/Resources/Prospect-Development-Best-Practices)

### Standards

- [San Diego County: Document Types and Definitions](https://www.sdarcc.gov/content/arcc/home/divisions/recorder-clerk/recording/document-types-and-definitions.html)
