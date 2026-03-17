# Prospect Intelligence

**Built at [AlmaConnect](https://almaconnect.com) · MVP**

University fundraising teams need to know two things about every prospect: *can they give?* and *will they give?* The answers exist in public records — SEC filings, political donations, nonprofit disclosures, real estate transactions — but they're scattered across dozens of sources and formats. Researching a single prospect takes 5–10 minutes. Multiply that by 10,000 alumni and your research team is buried in browser tabs instead of surfacing insights.

Prospect Intelligence batch-matches your entire prospect list against these public datasets in minutes. Drop in a CSV from your CRM, get back a scored, prioritized list of who to call first — and what to say when you call.

## Why this matters

Public records contain signals that strongly predict charitable giving, but most advancement teams never see them:

- A prospect donating **$2,500+ to political campaigns** is 15× more likely to make a charitable gift
- An insider selling **$500K in stock** has liquidity — and may be in a giving mindset
- Someone on **three nonprofit boards** has a demonstrated pattern of generosity
- A recent **property sale or refinance** signals a life transition and available capital

These signals are public and free. They're just impossibly hard to find at scale — until now.

## What it finds

| Module | Signals | Source |
|--------|---------|--------|
| **Real Estate** | Ownership changes, refinances, mortgage activity, property values | ATTOM property records across 138 US counties |
| **Political Funding** | Campaign contributions, PAC donations, lobbying spend | FEC filings, IRS 527, state records |
| **Nonprofit** | Board seats, officer roles, major gifts, grants, compensation | IRS 990 & 990-PF filings |
| **SEC Filings** | Insider stock trades, executive compensation, board appointments | SEC EDGAR (Forms 4, 3, 144, D, 8-K, 13D/G, DEF 14A) |

## How matching works

The hard part isn't accessing public data — it's matching messy records back to real people. "William R. Smith III" on an SEC filing is the same person as "Bill Smith" in your CRM. A trust named "The Smith Family Trust" might be your prospect's entity.

We match using:

- **Name intelligence** — nicknames (Bill ↔ William), suffix handling (Jr/Sr/III), initial expansion, trust name extraction, fuzzy matching across 120+ nickname groups
- **Address verification** — multi-tier scoring: exact street match → ZIP → city+state → state, with the owner's mailing address (where they live) weighted far higher than property location (which could be an investment)
- **Employer corroboration** — legal suffix stripping, substring and token matching
- **Event context** — ownership changes and refinances boost confidence; state mismatches penalize it

Every match gets a transparent confidence score (high / medium / low / review) so gift officers know what to trust and what to verify first.

## The output

A **client-ready CSV** per module — scored matches with signals, property details, financial data, and recommended actions. It goes straight to the gift officer's desk, no cleanup needed.

## Project structure

```
packages/core/        → Shared identity matching engine (name parsing, variants, employer matching)
apps/real-estate/     → ATTOM property record scanner (TypeScript)
apps/nonprofit/       → IRS 990 XML parser and matcher (TypeScript)
apps/political/       → FEC / IRS 527 matcher (TypeScript)
apps/sec/             → SEC EDGAR filing matcher (JavaScript)
```

## Getting started

```bash
npm install              # Install all workspaces
npm run build:core       # Build shared core (run first)
```

```bash
# Real estate — scan property records for ownership events
npx tsx apps/real-estate/src/cli/monitor.ts --prospects=data/prospects.csv

# Nonprofit — match against IRS 990 filings
npx tsx apps/nonprofit/src/run.ts --prospects=data/prospects.csv --xml-dir=data/2026_01A/

# Political funding — match against FEC contribution records
npm run build:political && npx pfund run --prospects=data/prospects.csv

# SEC filings — match against EDGAR documents
cd apps/sec && node --max-old-space-size=8192 run-sec-matcher.js
```

## Tests

```bash
npm run test:core          # Name parsing, variants, employer matching
npm run test:real-estate   # Address matching, confidence scoring
npm run test:nonprofit     # XML parsing, integration
npm run test:political     # FEC parsing, end-to-end matching
```

## License

MIT
