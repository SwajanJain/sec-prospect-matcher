# Real Estate Matcher — Future Improvements

> Logged March 2026. Source: ops team research + cross-referencing with industry capacity formulas.

---

## 1. Census Data by Geography (ZIP-Level)

US Census ACS API provides median household income, wealth estimates, and demographic data at ZIP-code granularity. Free, no API key needed for basic access.

- **Data:** median income, median home value, ownership rates by ZIP
- **Cost:** free
- **API:** https://www.census.gov/data/developers.html
- **Use case:** feeds the high-cost-of-living adjustment deferred in MASTER-PLAN.md — discount property-based capacity in high-cost ZIPs (a $1M home in Manhattan KS vs Manhattan NY)
- **Implementation:** instead of hardcoding metro tiers (BWF methodology), use Census median home value by ZIP as a dynamic adjustment factor in `capacity-formula.ts`
- **Secondary use:** corroborate whether a property value is unusual for its geography (a $3M home in a $200K-median ZIP is a stronger wealth signal than a $3M home in a $2M-median ZIP)

---

## 2. BLS Occupational Data

Bureau of Labor Statistics Occupational Outlook Handbook provides median pay by occupation. Free government data.

- **Data:** occupation title, median annual pay, pay range, growth outlook
- **Cost:** free
- **Source:** https://www.bls.gov/ooh/
- **Use case:** if the prospect CSV includes job title or occupation, map it to BLS median salary to corroborate property-based capacity estimates. DonorSearch uses "1/10 of tangible net worth over 4-5 years" as giving capacity — BLS salary data helps estimate tangible net worth.
- **Challenge:** mapping free-text job titles to BLS Standard Occupational Classification (SOC) codes. Likely needs a fuzzy title matcher or a curated lookup table for common nonprofit-sector titles.
- **Cross-product note:** this enrichment would also benefit the political matcher (which already has employer/occupation from FEC data) and the nonprofit matcher (which has titles from 990 Part VII).
