# SEC Prospect Matcher

Match alumni/prospects against SEC filings using **structured XML parsing** combined with **adaptive text validation** to minimize false positives.

## Overview

This tool helps organizations track prospects mentioned in SEC filings by:
- **Parsing structured data** from Form 4, 13G/D, 144, S-1, and other filings
- **Cross-verifying company names** to prevent false positives (e.g., wrong "Jennifer Wong")
- **Classifying signals** into actionable tiers (liquidity events, ownership stakes, etc.)
- **Scoring confidence** based on match method and proximity

### Example Results
- **Input:** 17,152 prospects + 6,719 SEC filings
- **Output:** 186 matches with confidence scores, signal tiers, and gift officer actions

---

## Architecture

```
UnifiedMatcher.js (main entry point)
├── Structured Matching (SecFilingMatcher logic)
│   ├── parsers/           # Form-specific XML parsers
│   │   ├── form4-parser.js
│   │   ├── schedule13-parser.js
│   │   ├── form144-parser.js
│   │   └── ...
│   └── Company cross-verification
│
├── Text Matching (AdaptiveMatcher logic)
│   ├── Aho-Corasick multi-pattern search
│   ├── adaptive-matcher-rules.js  # Strictness classification
│   └── Distance-based confidence scoring
│
└── Signal Classification (signal-classifier.js)
    ├── Tier 1: Liquidity events, IPOs, same-day sales
    ├── Tier 2: Large ownership positions
    └── Tier 3: Board roles, other filings
```

---

## How It Works

### 1. Structured Matching (Priority)
Parse XML/SGML to extract named individuals from filings:

```javascript
// Form 4: reportingOwner → rptOwnerName
// 13G/D: reportingPerson → name
// Form 144: issuerName, sellerName
```

Then cross-verify the prospect's company against:
- Issuer/filer name from filing metadata
- Raw text search for company name

### 2. Text Matching (Fallback)
For prospects not found structurally, use Aho-Corasick to search raw text:

- **Distance scoring**: Name + company within 4K chars = 95% confidence
- **Adaptive validation**: Short names (e.g., "Li Wang") require stricter checks
- **English context**: Reject matches in base64/encoded sections

### 3. Confidence Scoring

| Match Type | Company Verified | Confidence |
|------------|------------------|------------|
| Structured + company verified | Yes | 90-98% |
| Structured + company NOT verified | No | 40-60% |
| Text: Name+Company ≤4K chars | N/A | 95% |
| Text: Name+Company 4K-8K chars | N/A | 85% |
| Text: Name+Company 8K-50K chars | N/A | 70% |
| Text: Name Only | N/A | 50-75% |

### 4. Signal Classification

| Tier | Signal Type | Gift Officer Action |
|------|-------------|---------------------|
| **Tier 1** | Stock sale, IPO, same-day exercise+sale | Call now |
| **Tier 2** | 5%+ ownership stake | Major capacity indicator |
| **Tier 3** | Board appointment, other filings | Informational |

---

## Usage

### Run Matching

```bash
node run-sec-matcher.js
```

Configure paths in `run-sec-matcher.js`:
```javascript
const prospectsCSV = '/path/to/prospects.csv';
const secFilingsFolder = '/path/to/sec-filings/';
```

### Input Format

**Prospects CSV:**
```csv
_id,full_name,employer
65c33296f3ca580007ca7ed7,Paul Kim,Fidelity Investments
65c333c4f715950007272576,Daniel Zeff,"Zeff Capital, LP"
```

**SEC Filings:** Text files named `{accession-number}.txt`

### Output CSV

Key columns:
- `Signal Tier`, `Urgency` - Actionability
- `Confidence`, `Match Verdict` - Trust level
- `Distance (chars)`, `Distance Category` - Proximity for text matches
- `Name Context`, `Company Context` - Text snippets for review
- `Match Remarks` - Human-readable explanation
- `Gift Officer Action` - Recommended next step

---

## File Structure

```
sec-prospect-matcher/
├── UnifiedMatcher.js          # Main matcher (structured + text)
├── run-sec-matcher.js         # CLI runner
├── SecFilingMatcher.js        # Structured matching reference
├── AdaptiveMatcher.js         # Text matching reference
├── adaptive-matcher-rules.js  # Name/company strictness rules
├── signal-classifier.js       # Signal tier classification
├── false-positive-analyzer.js # FP risk scoring
├── parsers/                   # SEC form parsers
│   ├── form4-parser.js
│   ├── schedule13-parser.js
│   ├── form144-parser.js
│   ├── form3-parser.js
│   ├── form8k-parser.js
│   ├── formD-parser.js
│   ├── def14a-parser.js
│   ├── form13f-parser.js
│   ├── generic-parser.js
│   ├── header-parser.js
│   └── xml-utils.js
├── server.js                  # Web UI backend
├── index.html                 # Web UI frontend
├── matches/                   # Output CSVs (gitignored)
└── SEC-FILING-TYPES.md        # Reference documentation
```

---

## False Positive Prevention

### Problem: Common Names
"Jennifer Wong" appears in a Reddit Form 4, but our prospect Jennifer Wong works at "Stay Wanderful" (unrelated).

### Solution: Company Cross-Verification
```javascript
// Structured match: verify prospect company against filing issuer
if (prospect.company !== filing.issuer) {
  confidence = 40;  // Low confidence
  verdict = 'NEEDS_REVIEW';
}
```

### Problem: Name + Company Too Far Apart
"Paul Kim" at position 1,000 and "Fidelity Investments" at position 20,000 in same document.

### Solution: Distance-Based Scoring
```javascript
if (distance > 50000) {
  matchType = 'Name Only';  // Company too far to be related
  confidence = 75;
}
```

---

## Performance

- **17,152 prospects × 6,719 filings** in ~10 minutes
- **Aho-Corasick** reduces search complexity from O(prospects × files) to O(files)
- Memory usage: ~1.5GB peak

---

## License

MIT License

---

## Credits

Built with Claude Code (Anthropic)
