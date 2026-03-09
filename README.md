# Prospect Intelligence

Monorepo for prospect intelligence products. Match prospects against public data sources to surface actionable signals for gift officers and operations teams.

## Products

| Product | Path | Description |
|---------|------|-------------|
| **SEC Matcher** | `apps/sec/` | Document intelligence — matches prospects against SEC EDGAR filings using structured XML parsing + Aho-Corasick text search |
| **Political Funding** | `apps/political/` | Record matching — matches prospects against FEC contributions, IRS 527, state, and lobbying data |

## Shared Core

`packages/core/` (`@pm/core`) contains prospect-side identity utilities shared across all products:

- **Name parsing** — FEC format (`SMITH, JOHN A JR`) and standard format (`John Smith`)
- **Name variants** — Nickname lookup (120+ groups), suffix stripping, middle-name dropping, dehyphenation
- **Employer matching** — Legal suffix removal, exact/substring/token overlap scoring
- **Prospect loading** — Flexible CSV import with column alias detection
- **CSV utilities** — Quoted value parsing and escaping
- **State store** — File-system state management with PID-based locking
- **Logger & Config** — Simple stderr logger, `.env` file reader

## Quick Start

```bash
npm install                    # Installs all workspaces
npm run build:core             # Build shared core (required first)
npm run build:political        # Build political funding matcher
```

### Run SEC Matcher

```bash
cd apps/sec
node --max-old-space-size=8192 run-sec-matcher.js
```

### Run Political Funding Matcher

```bash
npm run build:political
npx pfund fetch daily          # Fetch recent FEC data
npx pfund run --prospects /path/to/prospects.csv
```

## Testing

```bash
npm run test:core              # 14 tests — name parsing, variants, employer matching, prospect loading
npm run test:political         # 8 tests — FEC parsing, API fetching, end-to-end matching
```

## Architecture

```
prospect-intelligence/
├── packages/
│   └── core/                  # @pm/core — shared identity utilities (~600 lines)
│       └── src/
│           ├── types.ts       # PersonNameParts, ProspectRecord, EmployerMatchResult
│           ├── name-parser.ts # parseFecName(), parsePersonName()
│           ├── name-index.ts  # generateNameVariants(), buildProspectIndex()
│           ├── employer-matcher.ts
│           ├── prospect-loader.ts
│           ├── csv.ts, config.ts, state-store.ts, logger.ts
│           └── index.ts       # Re-exports everything
├── apps/
│   ├── sec/                   # SEC product (JavaScript)
│   │   ├── UnifiedMatcher.js  # Core engine (1,856 lines)
│   │   ├── parsers/           # 10 form-specific parsers
│   │   └── ...
│   └── political/             # Political product (TypeScript)
│       ├── src/core/          # PoliticalMatcher engine
│       ├── src/parsers/       # FEC, IRS 527 parsers
│       ├── src/fetchers/      # Data source fetchers
│       ├── src/cli/           # pfund CLI
│       └── tests/
└── package.json               # npm workspaces
```

## License

MIT
