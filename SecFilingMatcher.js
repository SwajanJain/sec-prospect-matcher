/**
 * SEC Filing Matcher — Intelligent Filing-Aware Prospect Matching
 *
 * Combines:
 *   1. Structured XML parsing for high-value form types (Form 4, 3, 5, 144, D, 13D/G, 13F)
 *   2. Text-based name matching for all filing types (Aho-Corasick fallback)
 *   3. Signal classification (Tier 1/2/3, Liquidity/Capacity/Propensity)
 *   4. Enriched output with dollar values, transaction codes, alerts
 *
 * For structured forms: Match by comparing extracted owner/filer names against prospects.
 * For all forms: Also run text matching as fallback to catch names the structured parser misses.
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const AhoCorasick = require('ahocorasick');
const { parseFiling, hasSpecializedParser, extractRawText } = require('./parsers');
const { classifySignal } = require('./signal-classifier');

class SecFilingMatcher {
  constructor() {
    this.prospects = [];
    this.prospectIndex = {};     // name -> prospect for fast lookup
    this.ahoCorasick = null;     // Aho-Corasick automaton for fast text search
    this.nameToProspect = {};    // AC pattern -> prospect mapping
    this.results = [];
    this.stats = {
      totalFilings: 0,
      parsedStructured: 0,
      parsedGeneric: 0,
      matchesFound: 0,
      matchesByTier: { 1: 0, 2: 0, 3: 0 },
      matchesByFormType: {},
      matchesByMatchMethod: { structured: 0, text: 0 },
      parseErrors: 0,
    };
  }

  /**
   * Load prospects from CSV.
   * Expected columns: prospect_id, Name, Company Name
   */
  async loadProspects(csvPath) {
    return new Promise((resolve, reject) => {
      const prospects = [];
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row) => {
          const name = (row['Name'] || row['name'] || row['prospect_name'] || '').trim();
          const company = (row['Company Name'] || row['company_name'] || row['Company'] || '').trim();
          const id = (row['prospect_id'] || row['id'] || '').trim();

          if (name) {
            prospects.push({ id, name, company });
          }
        })
        .on('end', () => {
          this.prospects = prospects;
          this._buildIndex();
          resolve(prospects.length);
        })
        .on('error', reject);
    });
  }

  /**
   * Build lookup indices for fast matching.
   */
  _buildIndex() {
    this.prospectIndex = {};
    this.nameToProspect = {};

    const acPatterns = [];

    for (const p of this.prospects) {
      const name = p.name.trim();
      if (!name || name.length < 4) continue;

      // Exact name index (lowercase)
      const key = name.toLowerCase();
      if (!this.prospectIndex[key]) {
        this.prospectIndex[key] = [];
      }
      this.prospectIndex[key].push(p);

      // Also index "Last, First" → "First Last" variants
      const parts = name.split(/\s+/);
      if (parts.length >= 2) {
        const reversed = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`.toLowerCase();
        if (!this.prospectIndex[reversed]) {
          this.prospectIndex[reversed] = [];
        }
        this.prospectIndex[reversed].push(p);
      }

      // Build Aho-Corasick patterns for text search (only names with 2+ words, 5+ chars)
      if (parts.length >= 2 && name.length >= 5) {
        const pattern = name.toLowerCase();
        if (!this.nameToProspect[pattern]) {
          this.nameToProspect[pattern] = [];
          acPatterns.push(pattern);
        }
        this.nameToProspect[pattern].push(p);
      }
    }

    // Build Aho-Corasick automaton
    console.log(`  Building Aho-Corasick automaton with ${acPatterns.length} patterns...`);
    this.ahoCorasick = new AhoCorasick(acPatterns);
    console.log('  Automaton ready.');
  }

  /**
   * Match a single name against the prospect list.
   * Returns array of matching prospects.
   */
  _matchName(nameFromFiling) {
    if (!nameFromFiling) return [];
    const matches = [];
    const seen = new Set();

    // Normalize the filing name
    const normalized = nameFromFiling.toLowerCase().trim();

    // 1. Exact match
    if (this.prospectIndex[normalized]) {
      for (const p of this.prospectIndex[normalized]) {
        if (!seen.has(p.id)) {
          matches.push({ ...p, matchConfidence: 'HIGH', matchMethod: 'exact' });
          seen.add(p.id);
        }
      }
    }

    // 2. SEC filings often use "Last First" format (no comma). Try parsing.
    const secParts = normalized.split(/\s+/);
    if (secParts.length >= 2) {
      // Try "Last First Middle" → "First Middle Last"
      const reordered = `${secParts.slice(1).join(' ')} ${secParts[0]}`.toLowerCase();
      if (this.prospectIndex[reordered]) {
        for (const p of this.prospectIndex[reordered]) {
          if (!seen.has(p.id)) {
            matches.push({ ...p, matchConfidence: 'HIGH', matchMethod: 'name_reorder' });
            seen.add(p.id);
          }
        }
      }

      // Also try just "First Last" from "Last First"
      if (secParts.length === 2) {
        const swapped = `${secParts[1]} ${secParts[0]}`;
        if (this.prospectIndex[swapped]) {
          for (const p of this.prospectIndex[swapped]) {
            if (!seen.has(p.id)) {
              matches.push({ ...p, matchConfidence: 'HIGH', matchMethod: 'name_swap' });
              seen.add(p.id);
            }
          }
        }
      }

      // Try "Last First Middle" → "First Last" (drop middle from SEC name)
      if (secParts.length === 3) {
        const twoWord = `${secParts[1]} ${secParts[0]}`.toLowerCase();
        if (this.prospectIndex[twoWord]) {
          for (const p of this.prospectIndex[twoWord]) {
            if (!seen.has(p.id)) {
              matches.push({ ...p, matchConfidence: 'MEDIUM', matchMethod: 'name_reorder_drop_middle' });
              seen.add(p.id);
            }
          }
        }
        // IMPORTANT: Do NOT match `${secParts[1]} ${secParts[2]}` here.
        // In SEC "Last First Middle" strings, that is First+Middle (drops the true last name),
        // and causes false positives like prospect "Gary Lee" matching filing person "Ellis Gary Lee"
        // (actual last name is Ellis; middle is Lee).
      }
    }

    // 3. Fuzzy: Try matching after removing suffixes/prefixes
    const cleanedFiling = normalized.replace(/\b(jr\.?|sr\.?|iii|iv|ii|md|phd|esq)\b/gi, '').trim();
    if (cleanedFiling !== normalized && this.prospectIndex[cleanedFiling]) {
      for (const p of this.prospectIndex[cleanedFiling]) {
        if (!seen.has(p.id)) {
          matches.push({ ...p, matchConfidence: 'MEDIUM', matchMethod: 'suffix_removed' });
          seen.add(p.id);
        }
      }
    }

    return matches;
  }

  /**
   * Text-based name search using Aho-Corasick (fast multi-pattern matching).
   * Scans the raw filing text for all prospect names simultaneously.
   */
  _textSearch(rawContent) {
    if (!this.ahoCorasick) return [];

    const matches = [];
    const seen = new Set();
    const text = rawContent.toLowerCase();

    // Aho-Corasick search — finds all pattern occurrences in one pass
    const acResults = this.ahoCorasick.search(text);

    for (const [endPos, patterns] of acResults) {
      for (const pattern of patterns) {
        const prospects = this.nameToProspect[pattern];
        if (!prospects) continue;

        // Word boundary check
        const startPos = endPos - pattern.length + 1;
        const before = startPos > 0 ? text[startPos - 1] : ' ';
        const after = endPos + 1 < text.length ? text[endPos + 1] : ' ';
        const isWordBoundary = /[\s,.<>()\/\n\r\t;:"']/.test(before) && /[\s,.<>()\/\n\r\t;:"']/.test(after);
        if (!isWordBoundary) continue;

        for (const p of prospects) {
          if (!seen.has(p.id)) {
            matches.push({ ...p, matchConfidence: 'MEDIUM', matchMethod: 'text_search' });
            seen.add(p.id);
          }
        }
      }
    }

    return matches;
  }

  /**
   * Process all filings in a folder.
   *
   * @param {string} filingsFolder - Path to folder containing .txt SEC filing files
   * @param {object} options - { progressCallback, maxFiles }
   * @returns {Array} Enriched match results
   */
  async processFilings(filingsFolder, options = {}) {
    const { progressCallback, maxFiles } = options;

    const allFiles = fs.readdirSync(filingsFolder)
      .filter(f => f.endsWith('.txt'))
      .sort();

    const files = maxFiles ? allFiles.slice(0, maxFiles) : allFiles;
    this.stats.totalFilings = files.length;

    console.log(`Processing ${files.length} filing(s) against ${this.prospects.length} prospect(s)...\n`);

    for (let i = 0; i < files.length; i++) {
      const filename = files[i];
      const filepath = path.join(filingsFolder, filename);

      try {
        const rawContent = fs.readFileSync(filepath, 'utf-8');
        this._processOneFiling(rawContent, filename);
      } catch (err) {
        this.stats.parseErrors++;
        if (i < 5) console.error(`  Error reading ${filename}: ${err.message}`);
      }

      // Progress reporting
      if (progressCallback && (i % 50 === 0 || i === files.length - 1)) {
        progressCallback({
          current: i + 1,
          total: files.length,
          matches: this.results.length,
        });
      }
    }

    return this.results;
  }

  /**
   * Process a single filing: parse → match → classify → store results.
   */
  _processOneFiling(rawContent, filename) {
    // Step 1: Parse the filing
    const parsed = parseFiling(rawContent, filename);
    if (parsed.parseError) this.stats.parseErrors++;

    const isSpecialized = parsed._parserUsed !== 'generic' && !parsed.parseError;
    if (isSpecialized) {
      this.stats.parsedStructured++;
    } else {
      this.stats.parsedGeneric++;
    }

    // Step 2: Match using structured data (names extracted by specialized parsers)
    const structuredMatches = [];
    if (parsed.persons && parsed.persons.length > 0) {
      for (const person of parsed.persons) {
        const prospectMatches = this._matchName(person.name);
        for (const pm of prospectMatches) {
          structuredMatches.push({
            prospect: pm,
            filingPerson: person,
            matchMethod: 'structured',
          });
        }
      }
    }

    // Step 3: Text-based matching (fallback — catches names the structured parser missed)
    const textMatches = this._textSearch(rawContent);
    const structuredProspectIds = new Set(structuredMatches.map(m => m.prospect.id));

    // Merge: structured matches take priority, text matches fill gaps
    const allMatches = [...structuredMatches];
    for (const tm of textMatches) {
      if (!structuredProspectIds.has(tm.id)) {
        allMatches.push({
          prospect: tm,
          filingPerson: null,
          matchMethod: 'text',
        });
      }
    }

    if (allMatches.length === 0) return;

    // Step 4: Classify signal
    const signal = classifySignal(parsed);

    // Step 5: Create result records
    for (const match of allMatches) {
      const result = {
        // Prospect info
        prospect_id: match.prospect.id,
        prospect_name: match.prospect.name,
        prospect_company: match.prospect.company,

        // Match quality
        match_method: match.matchMethod,
        match_confidence: match.prospect.matchConfidence || 'MEDIUM',
        filing_person_name: match.filingPerson?.name || null,
        filing_person_role: match.filingPerson?.role || null,
        filing_person_cik: match.filingPerson?.cik || null,

        // Filing info
        filename: parsed.filename,
        accession_number: parsed.accessionNumber,
        form_type: parsed.formType,
        normalized_type: parsed.normalizedType,
        filed_date: parsed.filedDate,

        // Company info
        issuer_name: parsed.issuer?.name || parsed.filer?.name || parsed.subjectCompany?.name || null,
        issuer_ticker: parsed.issuer?.ticker || null,
        issuer_cik: parsed.issuer?.cik || parsed.filer?.cik || null,

        // Signal classification
        signal_tier: signal.tier,
        signal_tier_label: signal.tierLabel,
        dimensions: signal.dimensions.join(', '),
        urgency: signal.urgency,
        gift_officer_action: signal.giftOfficerAction,

        // Transaction details (for ownership forms)
        transaction_codes: (parsed.transactions || []).map(t => t.code).filter(Boolean).join(', '),
        transaction_summary: (parsed.transactions || []).map(t => {
          const parts = [t.codeLabel || t.code];
          if (t.shares) parts.push(`${t.shares.toLocaleString()} shares`);
          if (t.pricePerShare) parts.push(`@$${t.pricePerShare}`);
          if (t.value) parts.push(`= $${t.value.toLocaleString()}`);
          return parts.join(' ');
        }).join(' | '),

        total_value: (parsed.transactions || []).reduce((sum, t) => sum + (t.value || 0), 0) || null,

        // Flags
        is_10b5_1: parsed.is10b5_1 || false,
        has_philanthropy_signal: (parsed.alerts || []).some(a => a.type === 'PHILANTHROPY_SIGNAL'),
        has_same_day_sale: (parsed.alerts || []).some(a => a.type === 'SAME_DAY_SALE'),

        // Alerts
        alerts: (parsed.alerts || []).map(a => `[${a.severity}] ${a.message}`).join(' | '),
        alert_count: (parsed.alerts || []).length,

        // Signal summary for gift officers
        signal_summary: signal.summary,
      };

      this.results.push(result);
      this.stats.matchesFound++;
      this.stats.matchesByTier[signal.tier] = (this.stats.matchesByTier[signal.tier] || 0) + 1;
      this.stats.matchesByFormType[parsed.formType] = (this.stats.matchesByFormType[parsed.formType] || 0) + 1;
      this.stats.matchesByMatchMethod[match.matchMethod] = (this.stats.matchesByMatchMethod[match.matchMethod] || 0) + 1;
    }
  }

  /**
   * Export results to CSV.
   */
  async exportToCsv(outputPath) {
    const createCsvWriter = require('csv-writer').createObjectCsvWriter;

    const writer = createCsvWriter({
      path: outputPath,
      header: [
        { id: 'signal_tier', title: 'Signal Tier' },
        { id: 'urgency', title: 'Urgency' },
        { id: 'prospect_name', title: 'Prospect Name' },
        { id: 'prospect_company', title: 'Prospect Company' },
        { id: 'prospect_id', title: 'Prospect ID' },
        { id: 'form_type', title: 'Form Type' },
        { id: 'issuer_name', title: 'Issuer/Company' },
        { id: 'issuer_ticker', title: 'Ticker' },
        { id: 'filed_date', title: 'Filed Date' },
        { id: 'match_method', title: 'Match Method' },
        { id: 'match_confidence', title: 'Match Confidence' },
        { id: 'filing_person_name', title: 'Filing Person Name' },
        { id: 'filing_person_role', title: 'Filing Person Role' },
        { id: 'transaction_codes', title: 'Transaction Codes' },
        { id: 'transaction_summary', title: 'Transaction Summary' },
        { id: 'total_value', title: 'Total Value ($)' },
        { id: 'is_10b5_1', title: '10b5-1 Plan' },
        { id: 'has_philanthropy_signal', title: 'Philanthropy Signal' },
        { id: 'has_same_day_sale', title: 'Same-Day Sale' },
        { id: 'signal_tier_label', title: 'Signal Category' },
        { id: 'dimensions', title: 'Dimensions' },
        { id: 'gift_officer_action', title: 'Gift Officer Action' },
        { id: 'alerts', title: 'Alerts' },
        { id: 'signal_summary', title: 'Summary' },
        { id: 'filename', title: 'Filing Filename' },
        { id: 'accession_number', title: 'Accession Number' },
      ],
    });

    // Sort results: Tier 1 first, then by urgency, then by value
    const sorted = [...this.results].sort((a, b) => {
      if (a.signal_tier !== b.signal_tier) return a.signal_tier - b.signal_tier;
      const urgencyOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (a.urgency !== b.urgency) return (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3);
      return (b.total_value || 0) - (a.total_value || 0);
    });

    await writer.writeRecords(sorted);
    return outputPath;
  }

  /**
   * Print summary statistics.
   */
  printStats() {
    console.log('\n' + '='.repeat(80));
    console.log('SEC FILING MATCHER — RESULTS SUMMARY');
    console.log('='.repeat(80) + '\n');

    console.log(`Total filings processed:   ${this.stats.totalFilings}`);
    console.log(`  Structured parsing:      ${this.stats.parsedStructured}`);
    console.log(`  Generic/text parsing:    ${this.stats.parsedGeneric}`);
    console.log(`  Parse errors:            ${this.stats.parseErrors}`);
    console.log('');

    console.log(`Total matches found:       ${this.stats.matchesFound}`);
    console.log('');

    console.log('Matches by Signal Tier:');
    console.log(`  Tier 1 (Liquidity/Action):     ${this.stats.matchesByTier[1] || 0}`);
    console.log(`  Tier 2 (Capacity/Enrichment):  ${this.stats.matchesByTier[2] || 0}`);
    console.log(`  Tier 3 (Network/Engagement):   ${this.stats.matchesByTier[3] || 0}`);
    console.log('');

    console.log('Matches by Match Method:');
    console.log(`  Structured (XML parsing):  ${this.stats.matchesByMatchMethod.structured || 0}`);
    console.log(`  Text search (fallback):    ${this.stats.matchesByMatchMethod.text || 0}`);
    console.log('');

    console.log('Matches by Form Type:');
    const sortedTypes = Object.entries(this.stats.matchesByFormType)
      .sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedTypes) {
      console.log(`  ${type.padEnd(25)} ${count}`);
    }
    console.log('');

    // Unique prospects matched
    const uniqueProspects = new Set(this.results.map(r => r.prospect_id)).size;
    console.log(`Unique prospects matched:  ${uniqueProspects} / ${this.prospects.length}`);

    // Highlight key findings
    const tier1 = this.results.filter(r => r.signal_tier === 1);
    const philanthropy = this.results.filter(r => r.has_philanthropy_signal);
    const sameDaySales = this.results.filter(r => r.has_same_day_sale);
    const is10b51 = this.results.filter(r => r.is_10b5_1);

    if (tier1.length > 0 || philanthropy.length > 0) {
      console.log('\nKEY FINDINGS:');
      if (tier1.length > 0) console.log(`  Tier 1 alerts (call now):    ${tier1.length}`);
      if (philanthropy.length > 0) console.log(`  Philanthropy signals (G):    ${philanthropy.length}`);
      if (sameDaySales.length > 0) console.log(`  Same-day sales (M+S):        ${sameDaySales.length}`);
      if (is10b51.length > 0) console.log(`  10b5-1 plan trades:          ${is10b51.length}`);
    }

    console.log('\n' + '='.repeat(80));
  }
}

module.exports = SecFilingMatcher;
