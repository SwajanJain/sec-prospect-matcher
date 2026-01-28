# SEC Prospect Matcher

An intelligent system for matching alumni/prospect names with SEC filings using **Adaptive Aho-Corasick Algorithm** with **Distance-Based Confidence Scoring**.

## 🎯 Overview

This tool helps organizations (universities, investment firms, etc.) track their alumni/prospects mentioned in SEC filings by:
- **Finding exact name + company mentions** with proximity-based confidence
- **Preventing false positives** through strict validation rules
- **Processing massive datasets** (780 prospects × 287 SEC files in ~9 minutes)

### Example Use Case
**Input:** Carnegie Mellon alumni database (780 prospects)  
**Input:** 287 SEC filing text files  
**Output:** 113 high-quality matches with confidence scores

---

## 🏗️ System Architecture

### Core Components

```
sec-prospect-matcher/
├── AdaptiveMatcher.js              # Main matching engine with distance-based scoring
├── adaptive-matcher-rules.js       # Classification rules for strictness levels
├── run-adaptive-matching.js        # Terminal execution script
├── LinearMatcher.js                # Fast linear Aho-Corasick implementation
├── DatabaseMatcher.js              # Scalable database-driven matcher
└── server.js                       # Express API server
```

---

## 🧠 How It Works

### 1. **Aho-Corasick Multi-Pattern Matching**

Instead of searching for each prospect individually (O(prospects × files × content)), we build a **single automaton** containing all prospects and scan each file **once**:

```javascript
// Traditional approach: O(N × M × K)
for (each prospect) {
    for (each file) {
        search file for prospect  // K operations
    }
}

// Aho-Corasick approach: O(M × K)
automaton = build([all prospects])  // Build once
for (each file) {
    matches = automaton.search(file)  // Find ALL prospects in one pass
}
```

**Result:** ~100x faster for large datasets

---

### 2. **Adaptive Validation Rules**

Not all names/companies should be matched the same way! The system classifies each prospect and applies appropriate strictness:

#### **Name Classification**

| Type | Example | Strictness | Rules |
|------|---------|------------|-------|
| **VERY_SHORT** | "Qi Li", "Bo Wu" | VERY_STRICT | • Both parts ≤2 chars<br>• Require space boundaries<br>• Need 5+ English words nearby<br>• Block encoded sections |
| **SHORT** | "An Li", "Li Zhang" | STRICT | • One part ≤2 chars<br>• Require exact match<br>• Need 3+ English words nearby |
| **MEDIUM** | "Min Lee", "Bob Kim" | MODERATE | • Both parts = 3 chars<br>• Allow middle initials<br>• Need 2+ English words |
| **NORMAL** | "John Smith" | FLEXIBLE | • Both parts ≥4 chars<br>• More lenient validation |

#### **Company Classification**

| Type | Example | Strictness | Rules |
|------|---------|------------|-------|
| **VERY_SHORT** | "IBM", "USG" | VERY_STRICT | • Root ≤3 chars<br>• Require 5+ English words<br>• Check full name too |
| **SHORT** | "Adobe", "Cisco" | STRICT | • Root 4-5 chars<br>• Need 3+ English words |
| **SINGLE_WORD** | "Microsoft" | MODERATE | • One word, any length |
| **MULTI_WORD** | "Goldman Sachs" | FLEXIBLE | • Multiple words (more unique) |

**Implementation:** See `adaptive-matcher-rules.js` (lines 25-271)

---

### 3. **Distance-Based Confidence Scoring**

When both name AND company are found, we calculate their proximity and assign confidence:

```javascript
// Calculate distance between closest name-company pair
for (each nameContext in nameContexts) {
    for (each companyContext in companyContexts) {
        distance = abs(nameContext.position - companyContext.position)
        if (distance < minDistance) {
            minDistance = distance
        }
    }
}

// Assign confidence based on distance
if (minDistance <= 4000 chars)       → HIGH (95% confidence)
else if (minDistance <= 8000 chars)  → MEDIUM (85% confidence)
else if (minDistance <= 50000 chars) → LOW (70% confidence)
else                                 → Name Only (75% confidence)
```

**Why this works:**
- **≤4K chars**: Name in executive bio, company in same paragraph ✅
- **4K-8K chars**: Name in bio, company in nearby section ⚠️
- **8K-50K chars**: Name in bio, company in unrelated table ⚠️⚠️
- **>50K chars**: Likely unrelated (e.g., name on page 10, company on page 100) ❌

**Implementation:** See `AdaptiveMatcher.js` (lines 581-645)

---

### 4. **English Context Validation**

To prevent matches in base64-encoded data or binary garbage, we check for real English words nearby:

```javascript
// 140+ common English words
const commonEnglishWords = [
    // Articles & prepositions
    'the', 'and', 'of', 'to', 'in', 'for', 'with', 'by',

    // Business terms
    'company', 'inc', 'group', 'holdings', 'corporation',

    // SEC terms
    'agreement', 'filing', 'securities', 'stock', 'shares',

    // Executive terms
    'director', 'officer', 'president', 'chairman', 'executive',

    // Financial terms
    'million', 'billion', 'assets', 'equity', 'revenue'
    // ... and many more
]

// Validation logic
context = text.slice(matchPosition - 100, matchPosition + 100)
contextWords = context.split(/\s+/).filter(w => w.length > 2)
englishCount = contextWords.filter(w => commonEnglishWords.includes(w)).length

if (englishCount < 2) {
    return false  // Reject: doesn't look like real English text
}
```

**Blocks patterns like:**
- ❌ `"6 s 8q c 6r 9zc 6fq fu ao nddabg"` (garbage)
- ❌ `"WANGM76WFE3DI ,('ABCD"` (base64)
- ✅ `"john lin serves as vice president of the company"` (real text)

**Implementation:** See `AdaptiveMatcher.js` (lines 316-377)

---

### 5. **Space Boundary Validation**

Strict requirement for proper word boundaries (not just regex `\b`):

```javascript
// WRONG: Regex word boundary allows "Di Wang" to match "&USG"MGC#8"
if (/\bdi wang\b/.test(text)) { ... }

// RIGHT: Require actual spaces
beforeChar = text[matchStart - 1]
afterChar = text[matchEnd]

beforeIsSpace = beforeChar === ' ' || beforeChar === '\n' || beforeChar === '\t'
afterIsSpace = afterChar === ' ' || afterChar === '\n' || afterChar === '\t'

if (!beforeIsSpace || !afterIsSpace) {
    return false  // Reject
}
```

**Implementation:** See `AdaptiveMatcher.js` (lines 273-284)

---

## 📊 CSV Output Format

```csv
Prospect ID,Prospect Name,Company Name,SEC Filing,SEC URL,Match Date,Match Type,Confidence Score,Distance (chars),Distance Category,Match Remarks,Context
625d15c87ca9c100088e1330,Bruce Jacobs,Jacobs Levy Equity Management,0001193125-25-199296.txt,https://www.sec.gov/...,2025-10-02,Name + Company,95,61,HIGH (≤4K chars),"Name and company found 61 chars apart; Distance quality: HIGH (≤4K chars); Confidence: 95%","[COMPANY] ""jacobs levy equity management inc is owned..."""
```

### Column Explanations

- **Match Type**: `Name + Company`, `Name Only`, or `Company Only`
- **Confidence Score**: 95% (HIGH), 85% (MEDIUM), 70% (LOW), 75% (Name Only)
- **Distance**: Character distance between name and company mentions
- **Distance Category**:
  - `HIGH (≤4K chars)` - Strong association
  - `MEDIUM (4K-8K chars)` - Moderate association
  - `LOW (8K-50K chars)` - Weak association
  - `TOO FAR (>50K chars)` - Downgraded to "Name Only"
- **Match Remarks**: Human-readable explanation of why it matched
- **Context**: Text snippets showing where name/company were found

---

## 🚀 Usage

### Command Line

```bash
# Run adaptive matching from terminal
node run-adaptive-matching.js

# Configuration (edit run-adaptive-matching.js):
const prospectsCSV = '/path/to/SEC-CMU - Sheet6.csv'
const secFilingsFolder = '/path/to/filings_sep_2025_matched'
const outputFolder = '/path/to/Downloads'
```

### Expected Input Format

**Prospects CSV:**
```csv
prospect_id,prospect_name,company_name
625d15c87ca9c100088e1330,Bruce Jacobs,Jacobs Levy Equity Management
628c689990fc3e00070f7bd3,Eric Wu,"YouTube,LLC"
```

**SEC Filings:**
- Text files (`.txt`)
- Naming format: `0000000000-00-000000.txt`
- Example: `0001193125-25-199296.txt`

---

## 📈 Performance

### Benchmark Results

**Dataset:**
- 780 prospects
- 287 SEC files (ranging from 50KB to 165MB)
- Total content: ~10GB

**Results:**
- Processing time: ~9 minutes
- Memory usage: ~500MB (with garbage collection)
- Matches found: 113 high-quality matches (down from 229 with false positives)

**Complexity:**
- **Traditional approach**: O(prospects × files × content) = 780 × 287 × content ≈ 223,860 searches
- **Aho-Corasick approach**: O(files × content) = 287 × content ≈ 287 searches
- **Speedup**: ~780x reduction in search operations

---

## 🛡️ False Positive Prevention

### Examples of Blocked False Positives

#### **Case 1: Name in Base64 Garbage**
```
File: 0000866273-25-000069.txt (158MB)
False Match: "Di Wang + Wish"

Problem:
- "di" found at position 1,000 in base64: "DI ,('6r9zc"
- "wang" found at position 2,500 in base64: "WANGM76WFE3"
- "wish" found at position 1,500,000 in real text: "their wish that this agreement"
- Matcher combined them: 1.5MB apart!

Solution:
✅ English context validation (0 English words in base64)
✅ Space boundary check (no spaces around "DI" in "DI ,(")
✅ Distance-based scoring (>50K chars = downgrade to Name Only)

Result: Correctly rejected
```

#### **Case 2: Company Acronym in HTML Attributes**
```
False Match: "USG" in "alt='USG' class='logo'"

Solution:
✅ Space boundary validation (no space before/after in HTML attribute)
✅ English context validation (HTML tags don't have enough English words)

Result: Correctly rejected
```

#### **Case 3: Name + Company Too Far Apart**
```
File: 0000919574-25-005607.txt
Match: "John Lin + Deutsche Bank"

Analysis:
- "John Lin" at position 1,348,289 (executive bio section)
- "Deutsche Bank" at position 1,681,841 (financial holdings table)
- Distance: 333,552 chars (333KB apart!)

Solution:
✅ Distance-based scoring: >50K chars = downgrade to "Name Only" (75% confidence)
✅ CSV shows: distance=333552, category="TOO FAR (>50K chars)"

Result: Captured as "Name Only" (company found but too far to be related)
```

---

## 🔧 Algorithm Details

### Step-by-Step Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD PROSPECTS                                           │
│    - Read CSV with prospect_id, name, company               │
│    - Parse 780 prospects                                    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BUILD AHO-CORASICK AUTOMATON                             │
│    - Generate name patterns: "first last"                   │
│    - Generate company patterns: strip suffixes (Inc, Corp)  │
│    - Build single automaton with ~355 patterns              │
│    - O(total_pattern_length)                                │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PROCESS EACH SEC FILE (LINEAR SCAN)                      │
│    For each file (287 files):                               │
│      a. Read file in 4MB chunks with 2KB overlap            │
│      b. Normalize text (lowercase, remove accents)          │
│      c. Search for ALL patterns in ONE PASS                 │
│      d. For each match found:                               │
│         ├─ Validate word boundaries (require spaces)        │
│         ├─ Validate English context (2+ English words)      │
│         ├─ Validate not in encoded section (<30% special)   │
│         ├─ Store match position + context                   │
│         └─ Track hits: nameHit, companyHit, contexts[]      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. GENERATE MATCH RESULTS                                   │
│    For each prospect with hits in file:                     │
│      IF (nameHit AND companyHit):                           │
│         ├─ Calculate distance between closest pair          │
│         ├─ Assign confidence:                               │
│         │   ≤4K chars  → 95% (HIGH)                          │
│         │   4K-8K      → 85% (MEDIUM)                        │
│         │   8K-50K     → 70% (LOW)                           │
│         │   >50K       → 75% (Name Only)                     │
│         └─ Create match with distance info                  │
│      ELSE IF (nameHit):                                     │
│         └─ Create "Name Only" match (75% confidence)        │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. DEDUPLICATE & EXPORT                                     │
│    - Remove duplicate prospect+file pairs                   │
│    - Keep highest confidence match                          │
│    - Export to CSV with distance columns                    │
│    - 113 unique matches                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📚 Technical Stack

- **Language**: Node.js (JavaScript)
- **Algorithm**: Aho-Corasick Multi-Pattern String Matching
- **Libraries**:
  - `ahocorasick` - Fast multi-pattern search
  - `csv-parser` - CSV file parsing
  - `csv-writer` - CSV file generation
  - `express` - API server (optional)
  - `socket.io` - Real-time progress updates (optional)

---

## 🔄 Comparison with Other Approaches

### LinearMatcher vs AdaptiveMatcher

| Feature | LinearMatcher | AdaptiveMatcher |
|---------|--------------|-----------------|
| Algorithm | Aho-Corasick | Aho-Corasick + Validation |
| Speed | Fast (~45ms per file) | Moderate (~50-60ms per file) |
| False Positives | Medium | Very Low |
| Validation | Basic word boundaries | Space boundaries + English context + Distance scoring |
| Best For | Large datasets, speed priority | Quality over speed, preventing false positives |

### DatabaseMatcher (Alternative Approach)

For **unlimited scale** (millions of prospects):
- Uses SQLite database instead of in-memory automaton
- O(1) prospect count scalability
- Constant ~500MB memory usage
- Trade-off: Slower per-file (database queries)

---

## 📝 Key Insights

1. **Not all patterns are equal** - Short/ambiguous names need stricter validation than long/unique names

2. **Context matters** - Real mentions appear in English text with proper spacing, not in base64 garbage

3. **Proximity is crucial** - Name and company 5 chars apart = related, 500K chars apart = coincidence

4. **Graduated confidence > Hard cutoffs** - Better to report "LOW confidence match" than miss it entirely

5. **Aho-Corasick is a game-changer** - Finding 780 patterns in one pass vs 780 separate searches

---

## 🐛 Known Limitations

1. **HTML Table Matches**: Company names in HTML financial tables may be rejected due to lack of English words in surrounding HTML markup (trade-off for blocking base64 false positives)

2. **Middle Names**: Only supports single middle initial (e.g., "John K. Smith"), not full middle names

3. **Name Variations**: Doesn't handle nicknames (e.g., "Bob" vs "Robert") or hyphenated last names

4. **Memory**: Requires ~500MB RAM for 780 prospects; for millions of prospects, use DatabaseMatcher instead

---

## 🚧 Future Enhancements

- [ ] Machine learning-based confidence scoring
- [ ] Support for fuzzy name matching (Levenshtein distance)
- [ ] Parallel file processing (multi-core)
- [ ] Web UI for real-time progress monitoring
- [ ] Configurable validation rules via JSON config file
- [ ] Support for other document formats (PDF, HTML)

---

## 📄 License

MIT License - Feel free to use and modify for your needs

---

## 🙏 Credits

Built with assistance from Claude Code (Anthropic)

**Co-Authored-By:** Claude <noreply@anthropic.com>

---

## 📞 Contact

For questions or issues, please open a GitHub issue.
