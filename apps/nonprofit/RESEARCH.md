# Nonprofit Funding Matcher — Research

> Research completed March 2026. Sources cited inline.

---

## How Nonprofit Data Works (Plain-Language Explainer)

### Who files what?

**The nonprofit organization files with the IRS — not the individual donor.** This is the opposite of what most people expect.

Here's the chain of events:

1. John Smith donates $100K to the **Smith Family Foundation** (a private foundation)
2. The **foundation** files its annual Form 990-PF with the IRS (once per year, covering the full fiscal year)
3. That 990-PF includes John Smith's name on Schedule B as a $100K contributor
4. The IRS publishes the XML filing publicly, typically **12-18 months** after the fiscal year ended
5. We parse it, find "John Smith", match against the prospect list

**The donor never files anything.** The organization reports everything.

### Why can't we see all nonprofit donations?

Because **the law treats different types of nonprofits differently:**

| Organization Type | Example | Files Form | Donor Names Public? |
|---|---|---|---|
| **Regular charity** (501(c)(3)) | Red Cross, your local hospital | 990 | **NO** — charity redacts names before public release |
| **Private foundation** (501(c)(3)) | Gates Foundation, Smith Family Foundation | 990-PF | **YES** — Schedule B is public ($5,000+ donors) |
| **Political org** (527) | Super PACs, party committees | 990 + FEC | **YES** — fully public ($200+) |

So we can see who donates to **private foundations** and **political orgs**, but NOT to regular charities like universities, hospitals, or the Red Cross. This is a legal restriction, not a data gap we can solve.

The Supreme Court reinforced this in 2021 (*Americans for Prosperity v. Bonta*) — even states like California and New York that previously required donor disclosure were forced to stop.

### What about the 12-18 month data lag?

When we say "track the last 30 days," we mean: **new filings the IRS published this month**, not donations that happened this month.

Comparison with our political matcher:

| | Political Matcher | Nonprofit Matcher |
|---|---|---|
| Data source | FEC (federal elections commission) | IRS (990/990-PF filings) |
| Who files | Campaigns/PACs report donor names | Nonprofits/foundations report donor names |
| Update frequency | Weekly bulk + daily API | Monthly bulk XML |
| Data lag | 6-8 weeks (quarterly filings) | 12-18 months (annual filings + extensions + IRS processing) |
| "Last N days" means | FEC filings published in last 90 days | IRS filings published in last 30 days |

**Example timeline:**
- Smith Family Foundation's fiscal year ends **December 2024**
- Filing deadline: **May 15, 2025** (5 months after fiscal year end)
- Foundation files extension: pushed to **November 15, 2025**
- IRS processes and publishes: **February 2026**
- We parse it in our monthly run: **March 2026**
- Gift officer sees: *"Your prospect John Smith donated $100K to Smith Family Foundation (tax year 2024)"*

The donation happened in 2024. The intelligence reaches the gift officer in March 2026. **But this is the first time anyone is telling them.** That's the value — nobody else monitors new IRS filings and alerts on prospect matches.

### Why is this still valuable despite the lag?

1. **Gift officers plan years ahead** — a $100K foundation gift from 2024 is absolutely relevant for a 2026 cultivation strategy
2. **Board appointments are career-long** — if a prospect joined a foundation board, that's a durable signal
3. **Nobody else does real-time monitoring** — DonorSearch has 20 years of historical data but doesn't alert on new filings
4. **Cross-referencing is unique** — "This prospect gave $100K to a foundation AND $5,600 to political campaigns" (combining our two matchers)

---

## Executive Summary

**The core problem:** Unlike political donations (FEC makes every $200+ donor public by law), nonprofit donor identity is mostly private. IRS Schedule B lists major donors, but names are **redacted on public copies** for all 501(c)(3) public charities. The Supreme Court killed state-level disclosure requirements in 2021.

**What IS public:**
1. **Officers/directors/trustees** of every nonprofit (990 Part VII) — names, titles, compensation
2. **Donors to private foundations** (990-PF Schedule B) — names and amounts ($5,000+)
3. **Grants made by foundations** (990-PF Part XV, 990 Schedule I) — recipient, amount, purpose
4. **Executive compensation** (990 Schedule J) — detailed pay for top earners

**Product angle:** We can't build "who gave to which charity" (that data is private). But we CAN build **"prospect's philanthropic footprint"** — foundation board seats, foundation donations, grants their foundation made, nonprofit leadership roles, compensation. Combined with our political matcher, this is a uniquely cross-referenced signal.

---

## 1. What Signals Matter to Gift Officers?

| Signal | What It Tells You | Value |
|--------|-------------------|-------|
| Prospect runs a family foundation that gave $2M last year | Active philanthropist with verified capacity and intent | **Highest** — direct giving proof |
| Prospect donated $50K to a private foundation | Confirmed major donor (990-PF Schedule B is public) | **High** — verified giving |
| Prospect sits on 3 nonprofit boards (unpaid trustee) | Philanthropic engagement, community influence | **High** — affinity signal |
| Prospect is a $300K/yr nonprofit executive | Career in nonprofit world, capacity signal | **Medium** — capacity, not giving |
| Prospect gave $2,800 to a Senate campaign | Political engagement, disposable income for causes | **Medium** — cross-reference with political matcher |

**Key question answered:** Which of these can we find in public data?
- Family foundation giving: **YES** (990-PF Part XV)
- Donations to private foundations: **YES** (990-PF Schedule B — public for foundations)
- Board memberships: **YES** (990 Part VII)
- Executive compensation: **YES** (990 Part VII + Schedule J)
- Donations to regular charities: **NO** (Schedule B redacted)

---

## 2. Data Sources — Detailed Analysis

### Tier 1: IRS Form 990 Bulk XML (Primary — FREE, Public Domain)

**What it is:** Every tax-exempt organization files Form 990 (or 990-EZ, 990-PF) annually. Since the Taxpayer First Act (2019), **all filings must be electronic** (effective tax year 2020+). The IRS publishes these as XML files.

**Where to get it:**
- **IRS direct downloads:** `https://www.irs.gov/charities-non-profits/form-990-series-downloads`
  - Monthly updates, organized by year
  - Format: ZIP files containing individual XML filings
  - Example: `2025_TEOS_XML_01A.zip`, `2026_TEOS_XML_01A.zip`
  - Index CSVs available (e.g., `https://apps.irs.gov/pub/epostcard/990/xml/2026/index_2026.csv`)
- **GivingTuesday Data Lake:** `https://990data.givingtuesday.org/`
  - S3 bucket: `s3://gt990datalake-rawdata`
  - Free API at `https://990-infrastructure.gtdata.org` (300 requests per 5 minutes)
  - Partners: Aspen Institute, Charity Navigator, CitizenAudit, Urban Institute
- **Old AWS S3 bucket** (`s3://irs-form-990`): **DISCONTINUED** Dec 2021. Historical data still accessible but not updated.

**XML schema:** Each filing is a standalone XML doc with `Return` > `ReturnData` containing form-specific elements. Schemas change between tax years (field names can differ), which is a significant parsing challenge. IRS publishes official XSD schemas per year.

**What's in it (matchable fields):**

| Form Section | Data | Match Value |
|-------------|------|-------------|
| **990 Part VII** | Officers, directors, trustees, key employees — name, title, hours, compensation | **Core** — board/leadership matching |
| **990 Schedule J** | Detailed compensation for top earners ($150K+) — base, bonus, deferred, benefits | Enrichment |
| **990 Schedule I** | Grants made to domestic orgs ($5,000+) — recipient name, EIN, amount, purpose | Foundation grant tracking |
| **990 Schedule L** | Transactions with interested persons — loans, grants, business deals | Conflict/relationship signals |
| **990 Schedule R** | Related organizations — names, EINs, transaction details | Network mapping |
| **990-PF Part VII** | Foundation officers/directors with compensation | **Core** — foundation leadership |
| **990-PF Schedule B** | **DONORS to private foundations** ($5,000+) — names, addresses, amounts | **Highest value** — only public donor data |
| **990-PF Part XV** | Grants/contributions PAID by foundation — recipient, amount, purpose | **Core** — foundation giving patterns |

**Volume:**
- ~1.5-1.8M registered tax-exempt organizations in the US
- ~125,000-150,000 private foundations (filing 990-PF)
- E-file mandate means ~100% XML coverage going forward

**Freshness:**
- Filing deadline: 15th day of 5th month after fiscal year end (May 15 for calendar-year filers)
- 6-month automatic extension available (pushes to November 15)
- **Typical lag: 12-18 months** from fiscal year end to public availability
- IRS bulk downloads updated monthly

**Legal:** IRS data is public domain. No restrictions on commercial use. "Content created or maintained by federal employees in the course of their duties is not subject to copyright."

**Parsing tools:**
- [IRSx (990-xml-reader)](https://github.com/jsfenfen/990-xml-reader) — Python library normalizing across schema versions. Maintenance unclear since AWS S3 deprecation.
- [Nonprofit Open Data Collective](https://github.com/Nonprofit-Open-Data-Collective) — Pre-parsed compensation database from Part VII + Schedule J. **Most relevant free starting point for person-name matching.**
- IRS master concordance file maps XML element names across schema versions

### Tier 2: IRS Exempt Organizations Business Master File (FREE)

**What it is:** Registry of ALL recognized exempt organizations. Not financials from returns — just the registry.

**Where:** `https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf`

**Format:** CSV, divided by state/region. Updated monthly (2nd Monday).

**Contains:** EIN, org name, address, NTEE code (activity classification), subsection code (501(c)(3)/(4)/etc.), asset amount, income amount, ruling date, foundation type, accounting period.

**Use case:** Enrichment lookup. When we match a prospect to a 990 filing, use BMF to get the org's classification, size, and status.

### Tier 3: Candid APIs (PAID — Best Enrichment Source)

**What it is:** Candid (GuideStar + Foundation Center merger, 2019) is the most comprehensive nonprofit data aggregator. Launched "Candid Search" January 2026 merging both datasets: 1.9M organizations, 3M annual grant transactions, $180B in annual grant dollars.

**APIs** (at `developer.candid.org`):

| API | Purpose | Person Search? |
|-----|---------|---------------|
| Essentials | Nonprofit search (name, EIN, keyword, location) | No |
| Premier v3 | Deep org profiles: financials, **people (officers/directors/key employees)**, DEI data | **Yes — by name, title, role, salary range** |
| Charity Check | 501(c)(3) status validation | No |
| **Grants API** | Search grants, funders, recipients. Updated daily. | No (org-level) |
| News API | Real-time social sector news | No |

**Grants API data sources:** Compiled from "35+ diverse sources" including direct foundation reporting, IRS 990/990-PF, foundation websites, public records.

**Pricing:** Not publicly listed. Grants API "starting at $6,000/yr." Premier API likely $5,000-25,000+/yr depending on volume. Each API requires separate key. Contact required.

**Commercial use:** Yes, via API license agreement at `candid.org/terms-of-service/api-license-agreement/`.

**Verdict:** Best data quality but expensive. Consider for enrichment (not primary matching). We could parse 990 XML ourselves for free and only use Candid's Grants API for foundation grant data we can't easily get from raw filings.

### Tier 4: ProPublica Nonprofit Explorer API (FREE but Non-Commercial)

**Base URL:** `https://projects.propublica.org/nonprofits/api/v2/`

**Endpoints:**
- `GET /search.json?q={query}` — Search orgs by name (25 results/page)
- `GET /organizations/{EIN}.json` — Full org data by EIN (40-120 fields per filing)

**Person search:** ProPublica has a "People Search" on their website (`projects.propublica.org/nonprofits/name_search`) covering Part VII data. **But there is NO API endpoint for person-name search.** API is org-level only.

**Rate limits:** Not explicitly documented. Other ProPublica APIs cap at 5,000/day.

**License:** **CC BY-NC-ND 3.0 US — CANNOT use commercially.** This is a blocker. Must go to raw IRS XML instead.

**Authentication:** No API key required.

**Verdict:** Useful for development/testing but cannot use in production due to NC license. The underlying IRS data is public domain — parse it ourselves.

### Tier 5: Other APIs & Datasets

| Source | What It Provides | Person Search? | Free? | Commercial? |
|--------|-----------------|---------------|-------|-------------|
| **GivingTuesday 990 API** | EIN lookup, parsed 990 data | No (EIN only) | Yes | Unclear |
| **Charity Navigator GraphQL** | Charity ratings, efficiency metrics | No (org only) | Free tier | Planned paid tiers |
| **Every.org API** | 1M+ 501(c)(3) orgs, basic metadata | No (org only) | Free non-commercial | Enterprise plans available |
| **CharityAPI.org** | 1.7M nonprofits, EIN lookup, NTEE codes | No (org only) | Free for charities | Paid otherwise |
| **NCCS (Urban Institute)** | Research-grade 990 datasets since 1996 | No (bulk data) | Yes | Yes (research) |
| **NODC Compensation DB** | Pre-parsed Part VII + Schedule J (names, titles, comp) | **Yes (bulk download)** | Yes | Yes (open data) |
| **OpenSecrets Nonprofit** | 20K+ non-charity nonprofits (c4/c5/c6), board members | Board members only | Edu only | **CC BY-NC-SA — blocker** |

**Best free path for person-name matching:** Download NODC compensation database (pre-parsed) OR parse IRS 990 XML Part VII ourselves.

### Tier 6: State AG Charity Registries (LIMITED)

**California** (`oag.ca.gov/charities`):
- CSV registration lists updated bimonthly
- Search by EIN/registration number only — **no person name search**
- **No Schedule B donor data** — Supreme Court killed it (*Americans for Prosperity v. Bonta*, 2021)
- No API

**New York** (`charitiesnys.com`):
- Web search only, no API, no bulk download
- Org-level search only — **no person name search**
- **Suspended Schedule B collection** September 2021

**Verdict:** State registries are not useful for prospect matching. No person search, no donor data, no APIs.

---

## 3. Schedule B — The Redaction Question (RESOLVED)

This was the key research question. Answer:

**Regular 501(c)(3) public charities:** Donor names **REDACTED** on all public copies. Organizations must report to IRS but IRS removes names before public release.

**501(c)(4)/(5)/(6) organizations:** Since 2020 Treasury regulations, these orgs **don't even report donor names to the IRS** anymore (only contribution amounts over $5,000).

**Private foundations (990-PF):** Donor names are **PUBLIC**. Schedule B is open to public inspection. This covers ~125K-150K foundations. Donors of $5,000+ are listed with names and addresses.

**527 political organizations:** Donor names **PUBLIC** (already covered by our political matcher).

**State-level unredacted filings:** **DEAD.** Supreme Court ruled in *Americans for Prosperity Foundation v. Bonta* (July 2021) that requiring donor disclosure is unconstitutional. CA, NY, NJ all suspended.

**Bottom line:** For individual donor identity, we have 990-PF (private foundations) and FEC (political). That's it. Everything else is officer/director/trustee matching.

---

## 4. Competitive Landscape

### DonorSearch (~$1,200-$4,200/yr)
- **Moat: NOZA database** — 50M+ donation records scraped from nonprofit annual reports, donor honor rolls, capital campaign pages. Grows 500K-700K records/week. Now owned by Blackbaud.
- Uses 120M+ gift records (claimed largest philanthropic database)
- Also uses FEC data, SEC filings, real estate, 990 officer data, foundation grants
- Focus: **High-volume philanthropic history**
- **What they do that we can't easily replicate:** NOZA's 20+ years of scraped donor recognition lists

### iWave/Kindsight (~$3,745/yr)
- Uses 44+ vetted datasets including ZoomInfo, D&B, Refinitiv, Candid
- Foundation data via **Candid partnership**
- Focus: **AI-powered scoring** (capacity, affinity, propensity)
- Differentiator: Quality/depth over volume

### WealthEngine/Altrata (~$5,000+/yr)
- 2M+ profiles built by 400+ human researchers
- Focus: **Wealth capacity** (net worth, assets, income)
- Weak on philanthropic history — "limited visibility into donor engagement, giving history, and mission alignment"
- Poor satisfaction: 38/100 on G2 (vs iWave 96/100, DonorSearch 66/100)

### What We Can Offer That's Different

| Gap | Opportunity |
|-----|------------|
| **No real-time monitoring** | Alert when prospect appears on a newly filed 990 (new board seat, new foundation grant) |
| **Cross-referencing political + philanthropic** | We already have the political matcher — unique combination |
| **Giving-pattern analysis** | Competitors focus on wealth capacity. We can analyze HOW people give (causes, timing, escalation) |
| **Affordable pricing** | Competitors start at $1,200-$5,000/yr. Small nonprofits are priced out |
| **Transparency** | Show exactly which IRS filing the data comes from (not a black box) |

---

## 5. Verified Filing Volumes (Real IRS Data)

> Verified March 2026 by downloading actual IRS index CSVs from `apps.irs.gov/pub/epostcard/990/xml/`.

### Annual Totals by Return Type

| Return Type | 2024 | 2025 | What's In It | Useful? |
|---|---|---|---|---|
| **990** | 363,100 | 376,920 | Officers/directors/trustees (Part VII), grants made (Schedule I) | **Yes — board matching** |
| **990-PF** | 126,982 | 130,347 | **Donor names** (Schedule B), grants made (Part XV), officers (Part VII) | **Yes — highest value** |
| **990-EZ** | 215,355 | 217,102 | Small orgs, minimal officer data | Skip |
| **990-T** | 23,282 | 24,537 | Unrelated business income tax | Skip |
| **Total** | **728,719** | **748,906** | | |

**Key fact: Regular 990s do NOT have public donor names.** Schedule B is redacted on all public copies of 501(c)(3) filings. Only 990-PF (private foundations) have public donor names. This is settled law, reinforced by the Supreme Court in 2021.

### Monthly 990-PF Distribution (2025 — Verified)

990-PF is our highest-value filing type (donor names + grants + officers).

| Batch ID | Month | 990-PF Count | Notes |
|---|---|---|---|
| 2025_TEOS_XML_01A | Jan 2025 | 2,292 | |
| 2025_TEOS_XML_02A | Feb 2025 | 5,641 | |
| 2025_TEOS_XML_03A | Mar 2025 | 6,605 | |
| 2025_TEOS_XML_04A | Apr 2025 | 11,540 | |
| **2025_TEOS_XML_05A** | **May 2025** | **37,082** | **Spike — calendar-year filer deadline (May 15)** |
| 2025_TEOS_XML_06A | Jun 2025 | 7,407 | |
| 2025_TEOS_XML_07A | Jul 2025 | 3,546 | |
| 2025_TEOS_XML_08A | Aug 2025 | 5,544 | |
| 2025_TEOS_XML_09A | Sep 2025 | 7,148 | |
| 2025_TEOS_XML_10A | Oct 2025 | 1,443 | |
| **2025_TEOS_XML_11A-D** | **Nov 2025** | **38,449** | **Spike — extended filer deadline (Nov 15). 4 batches.** |
| 2025_TEOS_XML_12A | Dec 2025 | 3,650 | |
| **Full Year** | | **130,347** | |

### Monthly 990 (Regular) Distribution (2025 — Verified)

Regular 990s have officers/directors/trustees but NO donor names.

| Batch ID | Month | 990 Count | Notes |
|---|---|---|---|
| 2025_TEOS_XML_01A | Jan 2025 | 9,264 | |
| 2025_TEOS_XML_02A | Feb 2025 | 21,917 | |
| 2025_TEOS_XML_03A | Mar 2025 | 18,701 | |
| 2025_TEOS_XML_04A | Apr 2025 | 23,687 | |
| **2025_TEOS_XML_05A** | **May 2025** | **74,419** | **Spike** |
| 2025_TEOS_XML_06A | Jun 2025 | 22,445 | |
| 2025_TEOS_XML_07A | Jul 2025 | 13,419 | |
| 2025_TEOS_XML_08A | Aug 2025 | 23,712 | |
| 2025_TEOS_XML_09A | Sep 2025 | 23,538 | |
| 2025_TEOS_XML_10A | Oct 2025 | 5,085 | |
| **2025_TEOS_XML_11A-D** | **Nov 2025** | **126,839** | **Spike — 4 batches** |
| 2025_TEOS_XML_12A | Dec 2025 | 13,894 | |
| **Full Year** | | **376,920** | |

### Available Data for Initial Scrape (Nov 2025 → Present)

| Batch | Month | 990-PF | 990 | Total |
|---|---|---|---|---|
| 2025_TEOS_XML_11A | Nov 2025 | 9,251 | 29,469 | 38,720 |
| 2025_TEOS_XML_11B | Nov 2025 | 13,010 | 44,146 | 57,156 |
| 2025_TEOS_XML_11C | Nov 2025 | 7,200 | 24,342 | 31,542 |
| 2025_TEOS_XML_11D | Nov 2025 | 8,988 | 28,882 | 37,870 |
| 2025_TEOS_XML_12A | Dec 2025 | 3,650 | 13,894 | 17,544 |
| 2026_TEOS_XML_01A | Jan 2026 | 1,057 | 7,180 | 8,237 |
| | Feb 2026 | Not published yet | | |
| | Mar 2026 | Not published yet | | |
| **TOTAL available** | | **43,156** | **147,913** | **191,069** |

---

## 6. Technical Feasibility Assessment

### What We'd Parse

| Data Source | Records (per year) | Parsing Complexity | Update Frequency |
|------------|---------|-------------------|-----------------|
| 990-PF Schedule B (foundation donors) | ~130K filings × ~5-50 donors each | Medium (XML schema versioning) | Monthly |
| 990-PF Part XV (grants made) | ~130K filings × ~10-100 grants each | Medium | Monthly |
| 990 Part VII (officers/directors) | ~377K filings × ~10 people each | Medium | Monthly |
| 990 Schedule I (charity grants) | Variable | Medium | Monthly |
| EO BMF (org registry) | ~1.8M orgs | Easy (CSV) | Monthly |

### Name Matching Challenges

**990 names vs FEC names:**
- FEC: `"SMITH, JOHN A JR"` (structured, ALL CAPS, last-first)
- 990: `"John A. Smith Jr."` (mixed case, first-last, periods, varied formatting)
- Different normalization needed than our FEC parser

**Ambiguity:**
- Common names on multiple boards (John Smith serves on 5 nonprofits — is it the same person?)
- No SSN or unique ID in 990 data — must match on name + org + compensation + location
- Same person may appear with slight name variations across filings

**Cross-filing matching:**
- Same person as officer on a 990 AND donor on a 990-PF — need to link them
- Prospect's family foundation (same last name + "Foundation" in org name)

### Architecture Fit

This fits our existing monorepo pattern perfectly:
- **`@pm/core`** — already has name parsing, employer matching, prospect loading
- **`apps/nonprofit/`** — new app, same structure as `apps/political/`
- Parsers: 990 XML parser (Part VII, Schedule B, Part XV, Schedule I)
- Fetchers: IRS bulk XML downloader, BMF CSV downloader
- Matcher: same pattern (load prospects → build index → match → score → route → export)

### Key Differences from Political Matcher

| Aspect | Political Matcher | Nonprofit Matcher |
|--------|------------------|-------------------|
| Data format | Pipe-delimited text, JSON API | XML (versioned schemas) |
| Name format | `LAST, FIRST MIDDLE` | `First Middle Last` |
| Match direction | Donor name → prospect | Officer/donor name → prospect |
| Update frequency | Weekly bulk + daily API | Monthly bulk XML |
| Data lag | 6-8 weeks | 12-18 months |
| Volume per update | ~100K-1M contribution records | ~50K-200K filings/month |

---

## 6. Recommended Approach

### MVP Scope (Build First)

**Focus on the three highest-value, freely-available datasets:**

1. **990 Part VII — Nonprofit leadership matching**
   - Parse officer/director/trustee names + titles + compensation
   - Match against prospect list
   - Signal: "Your prospect [Name] is a trustee at [Org] (unpaid)" or "is CEO of [Org] ($450K/yr)"

2. **990-PF Schedule B — Foundation donor matching**
   - Parse contributor names + amounts from private foundation filings
   - Match against prospect list
   - Signal: "Your prospect [Name] donated $100K to [Foundation Name]"

3. **990-PF Part XV — Foundation grant tracking**
   - Parse grants made by foundations
   - When prospect is a foundation officer (from #1), show what their foundation funds
   - Signal: "[Prospect]'s foundation ([Name]) gave $2M to education orgs last year"

### Future Enhancements

4. **990 Schedule I** — Grants made by public charities (lower priority, similar to Part XV)
5. **Cross-reference with political matcher** — "Prospect gives to both [Foundation] AND [Political Committee]"
6. **Candid Grants API** — Enrichment layer if we want richer grant data ($6,000/yr)
7. **Real-time alerts** — Monitor monthly IRS XML releases for prospects appearing on new filings

### Data Pipeline

```
IRS Bulk XML (monthly)
    ↓
Parse 990 XML → Extract Part VII, Schedule B, Part XV
    ↓
Normalize names (first-last format → our standard)
    ↓
Store in local state (like .pfund/ for political)
    ↓
Match against prospect CSV (same pattern as political)
    ↓
Score + Route → client.csv + review.csv
```

---

## 7. Open Questions (For Plan Phase)

1. **Schema versioning** — How many XML schema versions do we need to support? Can we start with 2020+ only (post e-file mandate) to simplify?
2. **Initial data load** — Do we process all ~1.5M org filings, or only the ~125K private foundations first?
3. **Name deduplication** — Same person across multiple orgs — do we deduplicate or show each affiliation separately?
4. **Scoring model** — How to score "board member at small charity" vs "donor to major foundation" vs "CEO of large nonprofit"?
5. **Output format** — Same CSV format as political matcher, or different columns?
6. **Storage** — 990 XML files are large. Do we keep raw XML or only parsed extracts?

---

## 8. Yield Study Results (Verified from Real Data)

> Run March 2026 against the January 2026 IRS batch (`2026_TEOS_XML_01A.zip`). Parsed all 12,245 XML files.

### Raw Numbers

| Metric | Count |
|--------|-------|
| XML files parsed | 12,245 (100% success rate) |
| Total person records extracted | 83,020 |
| **Donors (990-PF Schedule B)** | **218 records (213 unique names)** |
| **Officers/Directors/Trustees** | **82,802 records (75,762 unique names)** |
| Unique first+last names (no middle) | 75,139 |

### Donor Volume — The Hard Truth

Only **218 donor records** from 12,245 filings. Most 990-PFs either don't have Schedule B (contributions below $5,000 threshold) or have very few individual donors.

- 213 unique donors per month × 12 = **~2,556 unique donors per year**
- Against a 50K prospect list with realistic 1-2% name overlap → **~25-50 raw donor matches per year**
- After disambiguation → **~10-25 verified donor matches per year**

**This is not enough to sell as a standalone "donor matching" product.**

### Officer Volume — The Real Opportunity

**75,762 unique officer names per month.** These are foundation trustees, charity board members, nonprofit executives — often wealthy, philanthropically active individuals.

- Against a 50K prospect list with realistic 2-3% overlap → **1,500-2,250 raw officer matches per month**
- After disambiguation → **500-1,000 verified officer matches per month**

**This IS enough for a viable product.**

### Name Quality Analysis

| Category | Count | % of Unique Names |
|----------|-------|-------------------|
| Appear once | 71,467 | 94.1% |
| Appear twice | 3,561 | 4.7% |
| Appear 3-5 times | 712 | 0.9% |
| Appear 6+ times (noise risk) | 175 | 0.2% |

94% of names appear only once — low ambiguity, good signal quality. The 175 names appearing 6+ times are mostly officers of trust companies (like "Greg Comfort" appearing 47 times across 47 managed foundations) or placeholder text ("Vacant" appearing 20 times).

### Donor Amount Distribution

For the 218 donors that ARE visible:

| Range | Count | Notes |
|-------|-------|-------|
| Under $5K | 10 | Below Schedule B threshold (unusual) |
| $5K–$50K | 124 | Core Schedule B disclosures |
| $50K–$500K | 59 | Significant gifts |
| **$500K+** | **23** | **Major gifts — highest value signals** |
| **Median** | **$26,000** | |
| **Total** | **$153.6M** | |

### Top States by Person Records

| State | Records | | State | Records |
|-------|---------|---|-------|---------|
| CA | 7,488 | | MA | 3,318 |
| NY | 5,576 | | NC | 3,266 |
| IL | 4,714 | | MI | 2,794 |
| TX | 4,347 | | VA | 2,723 |
| PA | 4,163 | | | |
| FL | 3,858 | | | |

### Product Viability Conclusion

**Officers/board matching is the viable product, not donor matching.** The yield study proves:

1. **Donor data is too sparse** — 213 names/month won't sustain a product
2. **Officer data is abundant** — 75K names/month is more than enough
3. **Name quality is high** — 94% unique, low noise
4. **Geographic coverage is broad** — all major states represented

The product pitch should be: "Which of your prospects sit on nonprofit boards and lead private foundations?" — not "Who donated to which charity?"

---

## 9. What Data Can and Cannot Be Tracked (Critical for Sales)

### What we CAN tell a gift officer

| Signal | Source | Example |
|--------|--------|---------|
| "Your prospect sits on the board of a private foundation" | 990-PF Part VII | "John Smith is a Trustee of the Smith Family Foundation" |
| "Your prospect's foundation gave $500K in grants last year" | 990-PF Part XV | "The Smith Foundation gave $200K to Stanford, $150K to Red Cross..." |
| "Your prospect donated $100K to a private foundation" | 990-PF Schedule B | "John Smith contributed $100K to the ABC Family Foundation" |
| "Your prospect is a $300K/yr nonprofit executive" | 990 Part VII | "John Smith is CEO of XYZ Charity, compensation: $312,000" |
| "Your prospect serves on 3 nonprofit boards" | 990 Part VII across filings | Cross-referencing multiple filings for same person |
| "Your prospect gave $5,600 to political campaigns" | FEC (our political matcher) | Cross-product intelligence |

### What we CANNOT tell a gift officer

| Question they'll ask | Why we can't answer it |
|---------------------|----------------------|
| "Did my alumnus donate to the Red Cross?" | Red Cross files a regular 990. **Schedule B donor names are redacted on all public copies.** This is federal law — the IRS removes names before public release. |
| "Did my prospect give to Stanford?" | Same — Stanford is a public charity (990 filer). Donor identities are private. |
| "Did my prospect donate to ANY regular charity?" | No public data source has this. The Supreme Court ruled in 2021 (*Americans for Prosperity v. Bonta*) that even states can't force donor disclosure. |
| "How much did my prospect give to their alma mater?" | This data only exists inside each nonprofit's own records. It is never filed with the IRS in a public way. |

### Why can't anyone see donations to regular charities?

The law treats **private foundations** differently from **public charities**:

- **Private foundations** (990-PF): Originally created by a small group of donors. IRS requires full transparency including donor names, because these entities have fewer public accountability mechanisms.
- **Public charities** (990): Supported by a broad base of donors. The law protects donor privacy — the charity reports donor names to the IRS on Schedule B, but the IRS **redacts all names** before making the filing public.

This isn't a data gap we can solve with better scraping or a different API. It's a fundamental legal protection that the Supreme Court has reinforced.

### How DonorSearch gets around this (and why we can't easily replicate it)

DonorSearch has built the **NOZA database** — 50M+ donation records collected over 20+ years by scraping a source that ISN'T government filings: **nonprofit annual reports and donor honor rolls.**

Many nonprofits voluntarily publish their donors' names in marketing/stewardship materials:

- **Annual reports** — PDF or web pages with "President's Circle ($100K+): John & Jane Smith" donor tiers
- **Honor rolls** — Lists of donors grouped by giving level, published on websites or in alumni magazines
- **Campaign pages** — Capital campaign donor recognition on websites or physical donor walls

DonorSearch hired people to manually collect these lists from thousands of nonprofits — scraping PDFs, copying names from websites, digitizing printed materials. This is pure manual labor at scale. There is no API, no bulk download, no structured data source. Every nonprofit formats their annual report differently.

**This is their competitive moat.** It took 20+ years and was acquired by Blackbaud for a reason. We cannot replicate this with a data pipeline — it requires human labor to read unstructured documents from thousands of unique sources.

### Our positioning (honest and differentiated)

We are NOT competing with DonorSearch on historical donor data. Our angle:

| DonorSearch | Our Product |
|-------------|-------------|
| "Who gave to which charity" (20 years of scraped honor rolls) | "Who leads which foundations" (fresh IRS filing alerts) |
| Historical database (backward-looking) | Real-time monitoring (forward-looking) |
| $1,200-$4,200/yr | Affordable alternative |
| Black box scores | Transparent — links to exact IRS filing |
| Single data type (philanthropic) | Cross-referenced (philanthropic + political) |

---

## Sources

### IRS Official
- [Form 990 Series Downloads](https://www.irs.gov/charities-non-profits/form-990-series-downloads)
- [EO Business Master File Extract](https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf)
- [Schedule B Instructions](https://www.irs.gov/instructions/i990sb)
- [Contributors Not Subject to Disclosure](https://www.irs.gov/charities-non-profits/public-disclosure-and-availability-of-exempt-organizations-returns-and-applications-contributors-identities-not-subject-to-disclosure)
- [XML Schemas for EO e-File](https://www.irs.gov/e-file-providers/current-valid-xml-schemas-and-business-rules-for-exempt-organizations-and-other-tax-exempt-entities-modernized-e-file)
- [Publication 6292 — Return Projections](https://www.irs.gov/pub/irs-pdf/p6292.pdf)

### Data Platforms
- [GivingTuesday 990 Data Lake](https://990data.givingtuesday.org/)
- [ProPublica Nonprofit Explorer API](https://projects.propublica.org/nonprofits/api/)
- [Candid Developer Portal](https://developer.candid.org/)
- [Charity Navigator GraphQL API](https://www.charitynavigator.org/products-and-services/graphql-api/)
- [NODC 990 Compensation Database](https://github.com/Nonprofit-Open-Data-Collective/irs-990-compensation-data)
- [IRSx 990 XML Reader](https://github.com/jsfenfen/990-xml-reader)

### Competitive
- [DonorSearch Data Sources](https://www.donorsearch.net/our-data/)
- [Blackbaud Acquires NOZA](https://investor.blackbaud.com/news-releases/news-release-details/blackbaud-acquires-noza-worlds-largest-searchable-database)
- [iWave/Kindsight Data](https://kindsight.io/iwave-data/)
- [WealthEngine (Altrata)](https://altrata.com/products/wealthengine)

### Legal
- [Americans for Prosperity v. Bonta (2021)](https://www.supremecourt.gov/opinions/20pdf/19-251_p86b.pdf)
- [IRS Use of Content](https://www.irs.gov/about-irs/use-of-content-from-irsgov)
- [ProPublica Data Store Terms](https://www.propublica.org/datastore/api/nonprofit-explorer-api)
- [Candid API License Agreement](https://candid.org/terms-of-service/api-license-agreement/)
