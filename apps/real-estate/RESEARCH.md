# Real Estate Matcher - Research

> Research completed on March 9, 2026.
>
> Goal: evaluate how to build a `real-estate matcher` product for the same nonprofit advancement / prospect research ICP as the other apps in this repo.

---

## Executive Summary

The real-estate matcher is viable, but only if we treat it as a **public-record ownership and property-intelligence product**, not as a listings product.

The core thesis is strong for the ICP:

- real estate is already one of the most important wealth indicators used in prospect research
- the raw signals are public, explainable, and usually easier to defend than opaque "wealth scores"
- unlike one-time screenings, a matcher can surface **new purchases, sales, mortgage events, ownership changes, portfolio expansion, absentee ownership, and high-value holdings** as ongoing signals

The hard part is not "is there data?" The hard part is:

1. U.S. real-estate data is fragmented across thousands of county assessors and recorders
2. owner names are messy and often held in trusts / LLCs
3. parcel, assessor, and recorder records refresh on different timelines
4. the best nationwide datasets are mostly commercial, not free

My recommendation:

- **Best MVP path:** use a nationwide public-record vendor for assessor + recorder data, with ATTOM as the strongest single-vendor starting point
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

## 2. What U.S. Real-Estate Data Actually Exists

At a high level, the data comes from two local government functions:

### 2.1 Assessor / tax-roll data

This is the parcel and tax side.

Typical fields:

- parcel ID / APN
- situs address
- owner name
- mailing address
- land value
- improvement value
- total assessed value
- tax amount
- land use / property type
- building characteristics
- exemptions / occupancy indicators in some jurisdictions

This is the best source for:

- current ownership snapshot
- mailing address vs property address
- valuation proxies
- portfolio rollups
- residential vs commercial vs vacant land classification

### 2.2 Recorder / deed / mortgage data

This is the transaction side.

Typical fields:

- grantor / seller
- grantee / buyer
- document type
- recording date
- transfer date
- sale amount / consideration
- mortgage amount
- lender
- vesting / ownership rights
- document number

This is the best source for:

- recent acquisitions and dispositions
- mortgage / refi activity
- trust and LLC naming clues
- ownership history
- transaction recency

### 2.3 Parcel geometry / cadastre

This is the map layer:

- parcel polygon
- centroid
- parcel boundary alignment
- spatial joins to flood, tract, ZIP, school district, etc.

This is useful for:

- map UX
- joining federal enrichments
- de-duplicating parcel records
- portfolio visualization

### 2.4 What listings / MLS data is

MLS data is not the same thing as public-record ownership data.

MLS/listings are useful for:

- active listings
- listing photos
- asking prices
- listing status

But they are weak for this thesis because:

- they do not tell you the full owned portfolio
- they only cover listed inventory
- licensing and usage are governed by MLS permissions and vendor contracts
- they are more relevant to agent / portal products than advancement research

This is why MLS should be treated as optional enrichment, not the foundation.

---

## 3. Source Landscape: Best Options

## 3.1 Option A - Nationwide public-record vendor (best MVP path)

This category is the most practical way to build the app quickly.

### ATTOM

ATTOM is the strongest single-vendor option for a first version.

What ATTOM clearly offers:

- assessor data covering 158M+ properties across 3,000+ counties
- recorder data with 500M+ transactions across 2,690+ counties
- property API with owner, mortgage, sales history, AVM, and foreclosure information
- daily weekday refresh for assessor and recorder in the developer docs

Why ATTOM is strong:

- one integration covers assessor + recorder + valuation + foreclosure
- direct developer platform exists
- data model is clearly productized for application use
- enough coverage and update cadence for monitoring workflows

Weaknesses:

- pricing is quote-based, not transparent
- parcel geometry is not its core story
- some "current owner" fields are still derived from county public records and will inherit county inconsistency

Best use:

- first nationwide MVP
- ownership, sale, mortgage, and portfolio signals
- operational monitoring jobs

### BatchData

BatchData is worth evaluating as an alternative / challenger vendor.

What is attractive:

- developer-oriented API posture
- strong property search and owner search story
- explicit async/batch workflows in docs/help center
- broader contact-enrichment stack if that ever matters

Weaknesses:

- less institutionally "canonical" than ATTOM in this market
- pricing and data lineage are less transparent in public materials
- more GTM emphasis on investor / lead-gen use cases than on authoritative public-record research

Best use:

- lower-friction evaluation alongside ATTOM
- possible faster prototype if procurement is easier

### PropMix

PropMix offers recorder, assessment, foreclosure, and MLS-related APIs.

What is interesting:

- one platform spans assessor, recorder, foreclosure, and some analytics
- public docs mention assessment and recorder APIs explicitly

Weaknesses:

- less clearly positioned as the authoritative public-record backbone than ATTOM or DataTree
- broader platform is mixed across MLS and public data, which increases evaluation complexity

Best use:

- benchmark option if ATTOM pricing or contracting is difficult

## 3.2 Option B - Parcel-first / map-first vendor

### Regrid

Regrid is the strongest parcel-centric option.

What Regrid is best at:

- standardized nationwide parcel dataset
- owner + address + parcel ID + geometry
- API, bulk files, feature service, data store
- parcel search by address, owner name, parcel number, polygon, point, and radius
- strong spatial add-ons such as building footprints, secondary addresses, zoning, and enhanced ownership

Why Regrid matters:

- if the product will have a map-heavy UI, parcel geometry, or spatial portfolio views, Regrid is excellent
- if we want to join federal enrichments by parcel / tract cleanly, Regrid helps a lot

Weaknesses:

- Regrid is strongest on parcel and normalized ownership context, not on being the deepest recorder / mortgage / deed-history platform
- enterprise nationwide pricing is public and meaningful: premium parcel data starts at $80K/year as of the current enterprise page
- API billing is per returned parcel record, so owner-name searches can get expensive quickly on common names

Best use:

- parcel geometry
- spatial joins
- map UX
- property portfolio views
- county-focused or state-focused rollout where parcel normalization matters more than raw document depth

## 3.3 Option C - Title / document search-heavy vendor

### First American DataTree

DataTree is compelling if the long-term differentiator is document search and title-chain depth.

What stands out:

- nationwide property / owner search across counties and state lines
- title chain and lien reports
- full-text search over billions of recorded documents
- direct document-image and title-plant workflow positioning

Why it matters:

- if we later want to explain ownership through primary recorded documents, trace chains of title, or resolve tricky trust/entity cases, DataTree is powerful

Weaknesses:

- less public, self-serve developer posture than ATTOM
- feels more like a research workstation / enterprise data product than an app-builder-first API
- likely higher integration and procurement friction

Best use:

- phase 2 or enterprise variant
- review / analyst tooling
- difficult title / lien / entity cases

## 3.4 Option D - County-by-county direct ingestion

This is the cheapest in raw data-license terms and the worst in engineering complexity.

What you get:

- direct public records
- sometimes full free access
- no middleman in some jurisdictions

What you pay with:

- every county has different formats and terms
- some expose APIs, some expose bulk files, some expose only portals
- refresh cadence varies wildly
- document types and field naming differ
- maintenance never ends

Examples of fragmentation:

- NYC ACRIS is a strong official system for deeds and mortgages, but it is only NYC and has its own workflows, maintenance windows, and borough-specific concepts
- Cook County land records are a different institutional setup again

Best use:

- a very narrow pilot in a few hand-picked counties or metros
- supplementing a vendor stack in strategically important markets

Not recommended as the initial nationwide architecture.

## 3.5 Option E - MLS / listings

MLS data should not be the foundation of the matcher.

Why not:

- it shows listed inventory, not total ownership
- access is governed by MLS permissions and broker / portal rules
- it is more useful for active listings than for wealth-footprint detection

Possible role later:

- enrich a property with photos, listing text, or recent list price history
- add "recently listed for sale" alerts after the core app exists

---

## 4. Best Data Sources by Signal Type

| Signal | Best source | Why |
|---|---|---|
| Current owner name | Assessor or normalized parcel data | Usually the best "current snapshot" |
| Mailing address | Assessor | Best for owner-occupied vs absentee inference |
| Parcel geometry | Regrid or equivalent parcel vendor | Cleaner map and spatial joins |
| Sale date / transfer amount | Recorder | Transaction truth |
| Mortgage / refinance | Recorder | Loan amount and lender are deed/mortgage events |
| Current valuation proxy | Assessor plus vendor AVM | Assessed value alone is uneven by county |
| Portfolio rollup | Assessor + recorder dedupe | Need a stable parcel/property ID |
| Trust / LLC ownership clue | Recorder + document search | Vesting and grantee strings matter |
| Flood risk / hazard | FEMA NFHL | Federal official source |
| Neighborhood affluence | Census ACS, FHFA HPI | Good tract / ZIP enrichments |

---

## 5. What Information We Can Show the ICP

The ICP does not need an appraiser's workbench. They need prospect research signals.

## 5.1 Core outputs that are genuinely useful

### A. Property portfolio summary

For each matched prospect:

- number of owned properties
- total assessed value
- total estimated value, if AVM available
- states / metros represented
- residential vs commercial mix

Why it matters:

- easy capacity proxy
- immediate CRM enrichment

### B. Notable holdings

For the top properties:

- address
- owner name on record
- property type
- assessed value
- estimated value
- last sale date and amount
- mortgage amount if available
- mailing address relationship

Why it matters:

- this is the evidence table gift officers and researchers will inspect

### C. Recent activity alerts

Examples:

- purchased a $4.2M property last month
- sold a long-held asset
- refinanced with a large mortgage
- transferred a property into a trust / LLC

Why it matters:

- timelier than a one-time screening
- creates reasons to update strategy or prioritize review

### D. Ownership pattern signals

Examples:

- absentee owner
- second-home footprint
- trust-owned property
- multiple-property portfolio
- concentrated holdings in high-value ZIPs

Why it matters:

- stronger evidence than a single asset

### E. Review evidence

Every match should show:

- record owner string
- matched prospect name
- confidence score
- match reason
- evidence fields used
- vendor/property ID/APN if available

Why it matters:

- the ICP will not trust a black box

## 5.2 Signals that should be treated carefully

### Distress / foreclosure

This data exists and can be sourced, but it is sensitive.

Recommendation:

- ingestable internally
- not a default donor-facing or gift-officer-facing signal
- only surface with careful policy and likely only for operations / review workflows

### Debt-heavy signals

Large mortgages can mean leverage, not wealth.

Recommendation:

- show them as context
- do not convert them into simplistic wealth scores

---

## 6. Matching: How We Would Actually Match Prospects to Property Owners

This is the core problem.

Real-estate matching is harder than SEC and different from political:

- names are often stored as all-caps owner strings
- owners can be couples, trusts, LLCs, estates, and family entities
- address can be a stronger corroborator than employer
- county data may collapse multiple owners into one field

## 6.1 Minimum viable matching inputs

If the prospect CSV only has `name + company`, matching quality will be materially weaker than political.

For real-estate, the preferred inputs are:

- prospect name
- aliases / alternate names
- home address or mailing address
- city
- state
- spouse / partner name if available
- known entity names or foundation / family office names if available

If we only have:

- `name`
- `city`
- `state`

we can still build a matcher, but review load will be higher.

## 6.2 Recommended candidate-generation strategy

### Stage 1 - owner-name blocking

Use normalized owner strings to generate candidates:

- exact first + last
- suffix stripped
- middle dropped
- nickname variants where appropriate
- co-owner split handling

Examples:

- `SMITH JOHN A TR` -> `john smith`
- `JOHN A SMITH AND JANE B SMITH`
- `SMITH FAMILY TRUST`

### Stage 2 - trust / entity parsing

Look for common patterns:

- `REVOCABLE TRUST`
- `FAMILY TRUST`
- `LIVING TRUST`
- `TRUSTEE`
- `[LAST NAME] LLC`
- `[LAST NAME] HOLDINGS`

These should not auto-match as strongly as person-name records. They should usually produce lower-confidence candidates unless corroborated.

### Stage 3 - address corroboration

This is likely the most important secondary signal.

Compare:

- prospect known address vs owner mailing address
- prospect city/state vs situs city/state
- prospect city/state vs owner mailing city/state

If prospect address equals owner mailing address, confidence should jump sharply.

### Stage 4 - portfolio corroboration

If one prospect matches multiple properties with consistent owner-mailing evidence, confidence should rise.

Example:

- same owner name
- same mailing address
- multiple parcels in same metro

This is stronger than a single isolated hit.

## 6.3 Proposed scoring model

### High-confidence signals

- exact normalized person-name match
- owner mailing address matches prospect address
- multiple properties tied to same mailing address
- trust string explicitly contains full prospect surname and given name
- spouse/co-owner name also known in CRM

### Medium-confidence signals

- exact name plus same city/state
- exact name plus same ZIP
- exact name plus repeated portfolio pattern
- trust / LLC with strong surname and address support

### Low-confidence / review signals

- common name only
- entity-only ownership with weak surname overlap
- no address corroboration
- property in irrelevant geography with no supporting evidence

## 6.4 Common false-positive patterns

- common names like `John Smith`, `David Lee`, `Maria Garcia`
- parent/child with the same name
- trust names containing only surname
- LLCs named after streets, neighborhoods, or abstract words
- owner records with initials only
- stale assessor owner snapshot after a recent deed

This means the app needs a `client.csv` vs `review.csv` pattern similar to the political matcher.

---

## 7. Recommended Product Signals for MVP

These are the signals I would prioritize first.

## Tier 1 - very strong and explainable

- **High-value property owned**: current assessed or estimated value exceeds threshold
- **Recent acquisition**: deed/transfer recorded recently
- **Multi-property owner**: more than one probable property match
- **Owner-occupied high-value primary residence**: owner mailing equals property address
- **Second-home / vacation-home pattern**: non-local residential property with a different mailing address

## Tier 2 - strong but more contextual

- **Recent mortgage / refinance event**
- **Commercial property ownership**
- **Trust-owned property with high-confidence linkage**
- **Portfolio concentrated in affluent tracts / ZIPs**

## Tier 3 - optional / later

- foreclosure / distress
- permit / renovation / construction activity
- flood / hazard overlays
- HOA / lien-heavy title context

---

## 8. Architecture Options

## Option 1 - Best single-vendor MVP

**Use ATTOM for assessor + recorder + valuation + optional foreclosure.**

### Flow

1. Load prospects from `@pm/core`
2. Normalize names and known addresses
3. Query or ingest ATTOM property records
4. Build owner-name index
5. Candidate generation
6. Score with address + ownership + portfolio corroboration
7. Export `client.csv`, `review.csv`, manifest, stats

### Advantages

- fastest path to usable product
- one vendor relationship
- daily-ish refresh on key public record types
- enough data breadth to define a clear MVP

### Disadvantages

- likely expensive
- geometry/maps may still need a second dependency later

## Option 2 - Spatial-first product

**Use Regrid for parcel + owner + geometry, add recorder data separately where needed.**

### Best when

- map UX is core
- portfolio visualization matters
- state/county rollout is acceptable
- you want parcel boundaries and spatial enrichments early

### Risk

- transaction / mortgage depth may require a second vendor

## Option 3 - Analyst-grade / enterprise workflow

**Use ATTOM or Regrid for app data, add DataTree for analyst review and document resolution.**

This is probably the best long-term enterprise architecture, but not the best first build.

## Option 4 - Geo pilot

**Pick 1-3 target geographies and ingest direct official county systems.**

Good if:

- you want to validate the thesis cheaply
- you know your first customers are concentrated in a few states

Bad if:

- you want a national product quickly

---

## 9. External Dependencies

## 9.1 Likely required

### A. Primary property data source

Pick one:

- ATTOM
- BatchData
- PropMix
- Regrid plus another recorder source

Without this, nationwide scale will be too slow.

### B. Address normalization / geocoding

At minimum we need:

- standardized addresses
- lat/lon for geography joins
- county / tract / ZIP normalization

Practical options:

- free baseline: U.S. Census Geocoder
- production-grade vendor: Smarty or Melissa

### C. Storage / state management

We will need:

- staged raw files or normalized property JSON
- run manifests
- lookups by parcel ID / APN / property ID

The `StateStore` pattern from `@pm/core` is a good fit.

## 9.2 Strongly recommended

### D. Entity resolution

To resolve LLCs and trusts better:

- OpenCorporates for business lookup and officer / address context
- state secretary-of-state sources in key jurisdictions later

### E. Federal enrichment layers

- Census ACS for neighborhood housing / income context
- FHFA HPI for area-level appreciation context
- FEMA NFHL for hazard context

These are not required for the core matcher but are valuable enrichments.

## 9.3 Optional later

### F. Maps / tiles

- Regrid tiles
- Mapbox
- Esri

### G. Permit / renovation feeds

Can become a separate product surface later.

### H. Listings / MLS

Only as optional enrichment, not a base dependency.

---

## 10. Best MVP Recommendation

## Recommendation

Build the first version around **nationwide public-record ownership and transaction data**, not listings.

### Preferred stack

1. **Primary data vendor:** ATTOM
2. **Address/geocode:** Census Geocoder first, then upgrade to Smarty or Melissa if needed
3. **Entity enrichment:** OpenCorporates
4. **Optional parcel/map dependency:** Regrid, only if map/spatial UX becomes central
5. **Federal enrichment:** ACS + FHFA + FEMA

### Why this is the best first build

- It fits the existing monorepo thesis: public-data matching for advancement teams
- It is explainable and operationally useful
- It minimizes engineering time spent on county normalization
- It creates clean outputs the ICP can trust

### What the MVP should do

- ingest staged public-record property data
- match prospects to probable owned properties
- surface top holdings and portfolio summary
- detect recent purchases, sales, and mortgage events
- emit `client.csv` and `review.csv`

### What the MVP should not try to do

- full nationwide county scraping
- full title search replacement
- MLS integration
- perfect trust / LLC resolution on day one
- opaque wealth scores

---

## 11. Product Output Design for the ICP

Suggested output columns:

- Prospect ID
- Prospect Name
- Match Confidence
- Match Quality
- Owner Name on Record
- Ownership Type
- Property Address
- Property City/State
- Property Type
- Owner Mailing Address
- Owner-Occupied Flag
- Assessed Value
- Estimated Value
- Last Sale Date
- Last Sale Amount
- Mortgage Amount
- Lender
- Signal Tier
- Signal
- Action
- Match Reason
- Source Property ID / APN

Suggested signal examples:

- `High-Value Primary Residence`
- `Recent Purchase`
- `Second Home`
- `Multi-Property Portfolio`
- `Commercial Holding`
- `Trust-Owned Asset`
- `Recent Refinance`

Suggested gift-officer actions:

- "Review for capacity recalibration"
- "Add to pre-meeting briefing"
- "Route to prospect research for ownership verification"
- "Monitor for future transaction activity"

---

## 12. Risks and Caveats

## Data risks

- county lag and stale owner snapshots
- assessor and recorder disagreeing temporarily
- incomplete sale price disclosure in some states or document types
- trust / LLC opacity

## Matching risks

- common names
- family members sharing names
- entity-only ownership
- stale mailing addresses

## Product risks

- if the user only gives us names, review volume rises
- if we over-index on distress signals, the product can feel off-mission for advancement
- if we choose a parcel-only vendor, transaction richness may disappoint users

## Commercial risks

- vendor contracts and pricing
- redistribution restrictions
- county-source licensing nuance if we ingest directly

---

## 13. Bottom Line

The best version of the real-estate matcher is:

- a **nationwide public-record matcher**
- centered on **ownership, value, portfolio, and transaction signals**
- with **reviewable evidence**
- using a **vendor-first architecture** for MVP

If we build it this way, it will complement the other apps cleanly:

- SEC matcher: liquidity / insider / corporate-event signals
- Political matcher: giving / values / influence signals
- Nonprofit matcher: philanthropic footprint / board signals
- Real-estate matcher: hard-asset / ownership / portfolio signals

That is a coherent suite for the same ICP.

---

## Sources

### Primary data vendors

- [ATTOM Assessor Data](https://www.attomdata.com/data/property-data/assessor-data/)
- [ATTOM Recorder Data](https://www.attomdata.com/data/transactions-mortgage-data/recorder-data/)
- [ATTOM Property API docs](https://api.developer.attomdata.com/dlpv2docs)
- [Regrid Support Center](https://support.regrid.com/)
- [Regrid Parcel API docs](https://support.regrid.com/api/using-the-parcel-api)
- [Regrid enterprise parcel data](https://regrid.com/enterprise)
- [First American DataTree](https://www.firstam.com/mortgagesolutions/solutions/data-analytics/datatree.html)
- [BatchData property search](https://batchdata.io/property-search)
- [BatchData developer links](https://help.batchservice.com/en/articles/9896241-api-documentation-links)
- [PropMix docs](https://docs.propmix.io/)

### Official public / federal / local sources

- [NYC ACRIS](https://www.nyc.gov/site/finance/property/acris.page)
- [Cook County Recorder of Deeds / Recordings](https://www.cookcountyil.gov/agency/recorder-deeds)
- [U.S. Census Geocoding Services API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)
- [ACS Data via API](https://www.census.gov/programs-surveys/acs/data/data-via-api.html)
- [FHFA House Price Index](https://www.fhfa.gov/reports/house-price-index)
- [FEMA Flood Data Viewers and Geospatial Data / NFHL](https://www.fema.gov/fr/node/501308)
- [FEMA Flood Map Service Center](https://msc.fema.gov/portal)

### Entity resolution

- [OpenCorporates API Reference](https://api.opencorporates.com/v0.3/documentation/API-Reference)

### MLS / listings context

- [Cotality Trestle documentation](https://trestle-documentation.corelogic.com/index.html)

