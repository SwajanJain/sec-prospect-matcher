# SEC Prospect Matcher

Match prospects against SEC filings to surface actionable wealth signals for gift officers and operations teams.

## What It Does

- **Parses structured data** from Form 4, 13G/D, 144, S-1, DEF 14A, 8-K, Form D, and other SEC filings
- **Matches prospects by name** using Aho-Corasick multi-pattern search + structured XML extraction
- **Cross-verifies companies** to prevent false positives (e.g., wrong "Jennifer Wong")
- **Reduces false positives** with 5 rules: mention-only downgrade, two-signal requirement, strong locus detection, attorney-in-fact suppression, hyphenated name protection
- **Classifies signals** into 3 tiers (liquidity events, capacity indicators, network/engagement)
- **Exports two CSVs**: 44-field debug CSV for internal review, 18-field client CSV for operations

## Quick Start

```bash
npm install
```

Configure paths in `run-sec-matcher.js`:

```javascript
const PROSPECTS_CSV = '/path/to/prospects.csv';
const SEC_FILINGS_FOLDER = '/path/to/sec-filings/';
```

Run:

```bash
node --max-old-space-size=8192 run-sec-matcher.js
```

Then generate the client-ready CSV:

```bash
node export-client-csv.js
```

## Input Format

**Prospects CSV** — any of these column names work:

| Field | Accepted Column Names |
|-------|----------------------|
| Name | `Prospect Name`, `Name`, `name`, `prospect_name` |
| Company | `Prospect Company`, `Company Name`, `Company`, `company_name` |
| ID | `Prospect ID`, `prospect_id`, `id` |
| Team | `Team Name`, `team_name` |

**SEC Filings** — raw `.txt` files named `{accession-number}.txt`, downloaded from EDGAR.

## Output

### Client CSV (18 fields)

| Column | Purpose |
|--------|---------|
| Signal Tier | Priority ranking (1-3) |
| Confidence | Match confidence (0-98%) |
| Match Quality | Ops triage label: Verified / Review Needed / Likely Wrong Person / Unverified Mention |
| Prospect Name | Matched prospect |
| Prospect Company | From prospect data |
| Team Name | Prospect's team |
| Prospect ID | Database ID |
| Signal | Event category (e.g., Liquidity Event, Same-Day Sale) |
| Form Type | SEC form (4, 144, DEF 14A, etc.) |
| Issuer/Company | Filing company |
| Ticker | Stock ticker |
| Filed Date | Filing date |
| Filer Role | Person's role in filing |
| Transaction | Summarized event (e.g., "Option exercise + Open market sale (6 transactions) [10b5-1]") |
| Value ($) | Dollar value of transaction |
| Action | Gift officer recommendation |
| Notes | Non-redundant context from filing alerts |
| Accession Number | SEC filing identifier |

### Debug CSV (44 fields)

Full diagnostic output including match method, distance metrics, company verification details, alert breakdowns, and false-positive risk scores.

## Architecture

```
sec-prospect-matcher/
├── UnifiedMatcher.js          # Core matcher engine
│   ├── Structured matching    # XML/SGML parsing → name extraction → company cross-check
│   ├── Text matching          # Aho-Corasick search → two-signal validation → mention-only gating
│   ├── False positive rules   # Company mismatch rejection, attorney-in-fact, hyphenated names
│   └── Signal classification  # Tier assignment + gift officer actions
├── run-sec-matcher.js         # CLI entry point
├── export-client-csv.js       # Debug CSV → 18-field client CSV converter
├── false-positive-analyzer.js # FP risk scoring engine
├── parsers/                   # SEC form-specific parsers
│   ├── form4-parser.js        # Form 4 (insider transactions)
│   ├── form3-parser.js        # Form 3 (initial ownership)
│   ├── schedule13-parser.js   # Schedule 13D/G (beneficial ownership)
│   ├── form144-parser.js      # Form 144 (intent to sell)
│   ├── formD-parser.js        # Form D (private offerings)
│   ├── form8k-parser.js       # Form 8-K (current events)
│   ├── def14a-parser.js       # DEF 14A (proxy statements)
│   ├── form13f-parser.js      # Form 13F (institutional holdings)
│   ├── generic-parser.js      # Fallback for other form types
│   ├── header-parser.js       # SEC header extraction
│   ├── xml-utils.js           # XML parsing utilities
│   └── index.js               # Parser registry
├── SEC-FILING-TYPES.md        # Reference: SEC form type guide
├── SEC-FILING-TYPES.pdf       # Reference: SEC form type guide (PDF)
└── matches/                   # Output CSVs (gitignored)
```

## False Positive Prevention

Five rules reduce false positives from ~85% to <5% for company-verified matches:

1. **Mention-Only Downgrade** — Text matches without 2+ corroborating signals get confidence 0
2. **Two-Signal Requirement** — Text matches need company proximity + role context, or strong locus section, to count
3. **Strong Locus Detection** — Only trust names in form-specific sections (e.g., Item 5.02 in 8-K, "election of directors" in DEF 14A)
4. **Attorney-in-Fact Suppression** — Filters out names appearing only as legal signatories
5. **Hyphenated Name Protection** — Prevents "Brian Carr-Smith" from matching "Brian Smith"

Plus **company-mismatch rejection**: structured matches where the prospect's company doesn't match the filing issuer and isn't found in the filing text are rejected.

## Performance

- **68,718 prospects x 6,719 filings** in ~3 minutes (with `--max-old-space-size=8192`)
- Aho-Corasick automaton reduces search from O(prospects x files) to O(files)

## License

MIT
