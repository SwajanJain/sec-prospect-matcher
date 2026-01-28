/**
 * Unified Matcher — Combines SecFilingMatcher + AdaptiveMatcher
 *
 * Pipeline per filing:
 *   Parse filing (parsers/index.js)
 *     -> Structured match: _matchName() + _crossCheckCompany()
 *     -> Text match: AC search + adaptive validation + distance scoring
 *     -> Merge (structured priority)
 *     -> Signal classification (signal-classifier.js)
 *     -> Build enriched result with confidence score
 *
 * Fixes the Jennifer Wong class of false positives: name-only structured matches
 * now require company cross-checking, and text matches use AdaptiveMatcher's
 * space-boundary / English-context / encoded-blocking validation.
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const AhoCorasick = require('ahocorasick');
const { parseFiling, hasSpecializedParser } = require('./parsers');
const { extractRawText } = require('./parsers/header-parser');
const { classifySignal } = require('./signal-classifier');
const AdaptiveMatchingRules = require('./adaptive-matcher-rules');
const FalsePositiveDetector = require('./false-positive-analyzer');

// Legal suffixes stripped for fuzzy company comparison
const LEGAL_SUFFIXES_RE = /\b(inc\.?|incorporated|corp\.?|corporation|company|co\.?|llc|ltd\.?|limited|plc|lp|l\.?p\.?|group|holdings|enterprises?|partners|partnership|& co\.?)\b/gi;

function stripLegalSuffixes(name) {
  return name.replace(LEGAL_SUFFIXES_RE, '').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

// Regex for personal name suffixes (Jr., Sr., III, etc.)
// Uses lookahead instead of trailing \b so "Jr." with dot is matched correctly
const NAME_SUFFIXES_RE = /\b(jr|sr|iii|iv|ii|md|phd|esq)\.?(?=\s|$)/gi;

// Nickname groups — bidirectional. Each group lists equivalent first names.
const NICKNAME_GROUPS = [
  ['william', 'bill', 'will', 'billy', 'willy'],
  ['robert', 'bob', 'rob', 'bobby', 'robbie'],
  ['elizabeth', 'liz', 'beth', 'lizzy', 'betty', 'eliza'],
  ['richard', 'rick', 'rich', 'dick'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['michael', 'mike'],
  ['thomas', 'tom', 'tommy'],
  ['edward', 'ed', 'eddie', 'ted', 'teddy'],
  ['joseph', 'joe', 'joey'],
  ['charles', 'charlie', 'chuck'],
  ['david', 'dave'],
  ['christopher', 'chris'],
  ['daniel', 'dan', 'danny'],
  ['matthew', 'matt'],
  ['anthony', 'tony'],
  ['catherine', 'katherine', 'kate', 'katie', 'kathy', 'cathy'],
  ['margaret', 'maggie', 'meg', 'peggy'],
  ['jennifer', 'jen', 'jenny'],
  ['patricia', 'pat', 'patty', 'trish'],
  ['barbara', 'barb'],
  ['benjamin', 'ben', 'benny'],
  ['jonathan', 'jon'],
  ['nicholas', 'nick'],
  ['stephen', 'steven', 'steve'],
  ['timothy', 'tim'],
  ['lawrence', 'larry'],
  ['raymond', 'ray'],
  ['gregory', 'greg'],
  ['andrew', 'andy', 'drew'],
  ['kenneth', 'ken', 'kenny'],
  ['donald', 'don'],
  ['frederick', 'fred', 'freddy'],
  ['gerald', 'jerry'],
  ['jeffrey', 'jeff'],
  ['leonard', 'leo', 'len'],
  ['peter', 'pete'],
  ['alexander', 'alexandra', 'alex'],
  ['douglas', 'doug'],
  ['philip', 'phil'],
  ['ronald', 'ron'],
  ['samuel', 'sam'],
  ['theodore', 'theo'],
  ['walter', 'walt'],
  ['nathaniel', 'nathan', 'nate'],
  ['rebecca', 'becky', 'becca'],
  ['victoria', 'vicky', 'tori'],
  ['deborah', 'debra', 'deb', 'debbie'],
  ['pamela', 'pam'],
  ['sandra', 'sandy'],
  ['susan', 'sue', 'susie'],
  ['cynthia', 'cindy'],
  ['dorothy', 'dot', 'dotty'],
  ['christine', 'christina', 'chris', 'tina'],
];

// Build lookup: name → all alternative first names (merges overlapping groups)
const NICKNAME_LOOKUP = {};
for (const group of NICKNAME_GROUPS) {
  for (const name of group) {
    if (!NICKNAME_LOOKUP[name]) NICKNAME_LOOKUP[name] = new Set();
    for (const variant of group) {
      if (variant !== name) NICKNAME_LOOKUP[name].add(variant);
    }
  }
}
for (const name of Object.keys(NICKNAME_LOOKUP)) {
  NICKNAME_LOOKUP[name] = Array.from(NICKNAME_LOOKUP[name]);
}

class UnifiedMatcher {
  constructor() {
    this.prospects = [];
    this.prospectIndex = {};      // lowercased name -> [prospect] (for structured matching)
    this.prospectById = {};       // id -> prospect (for quick lookup)
    this.ahoCorasick = null;      // AC automaton with name+company patterns
    this.patternMap = new Map();  // pattern -> { type, prospectIds, variations }
    this.adaptiveRules = new AdaptiveMatchingRules();
    this.fpDetector = new FalsePositiveDetector();
    this.results = [];
    this.stats = {
      totalFilings: 0,
      parsedStructured: 0,
      parsedGeneric: 0,
      matchesFound: 0,
      matchesByTier: { 1: 0, 2: 0, 3: 0 },
      matchesByFormType: {},
      matchesByMatchMethod: { structured: 0, text: 0 },
      matchesByConfidence: {},
      companyVerified: 0,
      companyNotVerified: 0,
      uncertainMatches: 0,
      parseErrors: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Index building
  // ---------------------------------------------------------------------------

  _buildIndex() {
    this.prospectIndex = {};
    this.prospectById = {};
    this.patternMap = new Map();

    const acPatterns = [];

    for (const p of this.prospects) {
      this.prospectById[p.id] = p;

      const name = p.name.trim();
      if (!name || name.length < 4) continue;

      // Generate all name variants (handles suffixes, middle names, hyphens, nicknames)
      const variants = this._generateProspectNameVariants(name);

      // --- Prospect index for structured matching ---
      for (const variant of variants) {
        const key = variant.toLowerCase();
        if (key.length < 4) continue;

        if (!this.prospectIndex[key]) this.prospectIndex[key] = [];
        if (!this.prospectIndex[key].some(e => e.id === p.id)) {
          this.prospectIndex[key].push(p);
        }

        // Also index reversed form ("Last First ..." → "First ... Last")
        const parts = key.split(/\s+/);
        if (parts.length >= 2) {
          const reversed = `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`;
          if (!this.prospectIndex[reversed]) this.prospectIndex[reversed] = [];
          if (!this.prospectIndex[reversed].some(e => e.id === p.id)) {
            this.prospectIndex[reversed].push(p);
          }
        }
      }

      // --- AC automaton patterns (name + company) ---
      // Build unique first+last pairs from all variants
      const acPairsAdded = new Set();
      for (const variant of variants) {
        const parts = variant.toLowerCase().split(/\s+/);
        if (parts.length < 2) continue;
        const firstName = parts[0];
        const lastName = parts[parts.length - 1];
        if (firstName.length < 2 || lastName.length < 2) continue;

        const namePattern = `${firstName} ${lastName}`;
        if (acPairsAdded.has(namePattern)) continue;
        acPairsAdded.add(namePattern);

        if (!this.patternMap.has(namePattern)) {
          this.patternMap.set(namePattern, { type: 'name', prospectIds: [], variations: [] });
          acPatterns.push(namePattern);
        }
        const info = this.patternMap.get(namePattern);
        if (!info.prospectIds.includes(p.id)) {
          info.prospectIds.push(p.id);
        }
        info.variations.push({
          prospectId: p.id,
          text: namePattern,
          type: 'first_last_exact',
          firstName,
          lastName,
        });
      }

      // Company patterns (unchanged)
      if (p.company && p.company.length >= 3) {
        const root = stripLegalSuffixes(p.company).toLowerCase().replace(/\s+/g, ' ').trim();
        if (root.length >= 3) {
          if (!this.patternMap.has(root)) {
            this.patternMap.set(root, { type: 'company', prospectIds: [], variations: [] });
            acPatterns.push(root);
          }
          const info = this.patternMap.get(root);
          info.prospectIds.push(p.id);
          info.variations.push({ prospectId: p.id, text: root, type: 'company_root' });
        }
      }
    }

    console.log(`  Building Aho-Corasick automaton with ${acPatterns.length} patterns (names + companies)...`);
    this.ahoCorasick = new AhoCorasick(acPatterns);
    console.log('  Automaton ready.');
  }

  // ---------------------------------------------------------------------------
  // Name variant generation (fixes edge cases 1-5)
  // ---------------------------------------------------------------------------

  /**
   * Generate all plausible name variants for a prospect name.
   * Handles: suffix stripping, middle-name dropping, hyphen→space, nicknames.
   */
  _generateProspectNameVariants(name) {
    const variants = new Set();

    // Step 1: Clean commas, normalize spaces
    let cleaned = name.replace(/,/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    variants.add(cleaned);

    // Step 2: Strip personal suffixes (Jr., Sr., III, MD, etc.)
    const suffixStripped = cleaned.replace(NAME_SUFFIXES_RE, '').replace(/\s+/g, ' ').trim();
    if (suffixStripped !== cleaned && suffixStripped.length >= 4) {
      variants.add(suffixStripped);
    }

    // Step 3: For each base form, produce hyphen and middle-name variants
    const baseForms = new Set([cleaned]);
    if (suffixStripped !== cleaned && suffixStripped.length >= 4) baseForms.add(suffixStripped);

    for (const base of baseForms) {
      // Hyphen → space
      if (base.includes('-')) {
        const dehyphenated = base.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
        if (dehyphenated.length >= 4) variants.add(dehyphenated);
      }

      // Drop middle name(s): 3+ word names → first + last
      const parts = base.split(/\s+/);
      if (parts.length >= 3) {
        const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
        if (firstLast.length >= 4) {
          variants.add(firstLast);
          if (firstLast.includes('-')) {
            variants.add(firstLast.replace(/-/g, ' ').replace(/\s+/g, ' ').trim());
          }
        }
      }

      // Also produce dehyphenated + middle-dropped combo
      if (base.includes('-')) {
        const dehypParts = base.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/);
        if (dehypParts.length >= 3) {
          const fl = `${dehypParts[0]} ${dehypParts[dehypParts.length - 1]}`;
          if (fl.length >= 4) variants.add(fl);
        }
      }
    }

    // Step 4: Nickname variants — for each variant so far, swap first name with nicknames
    const currentVariants = Array.from(variants);
    for (const v of currentVariants) {
      const parts = v.split(/\s+/);
      if (parts.length < 2) continue;
      const firstName = parts[0];
      const nicknames = NICKNAME_LOOKUP[firstName] || [];
      for (const nick of nicknames) {
        // Full variant with nickname (e.g., "bill michael smith")
        const rest = parts.slice(1).join(' ');
        const nickFull = `${nick} ${rest}`;
        if (nickFull.length >= 4) variants.add(nickFull);

        // First+last only with nickname (e.g., "bill smith")
        if (parts.length >= 3) {
          const nickFL = `${nick} ${parts[parts.length - 1]}`;
          if (nickFL.length >= 4) variants.add(nickFL);
        }
      }
    }

    return Array.from(variants);
  }

  // ---------------------------------------------------------------------------
  // Structured name matching (from SecFilingMatcher)
  // ---------------------------------------------------------------------------

  _matchName(nameFromFiling) {
    if (!nameFromFiling) return [];
    const matches = [];
    const seen = new Set();
    // Clean filing name: strip commas, replace hyphens with spaces, collapse whitespace
    const normalized = nameFromFiling
      .replace(/,/g, '')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();

    // 1. Exact match
    if (this.prospectIndex[normalized]) {
      for (const p of this.prospectIndex[normalized]) {
        if (!seen.has(p.id)) {
          matches.push({ ...p, matchMethod: 'exact' });
          seen.add(p.id);
        }
      }
    }

    // 2. SEC "Last First Middle" reordering
    const secParts = normalized.split(/\s+/);
    if (secParts.length >= 2) {
      const reordered = `${secParts.slice(1).join(' ')} ${secParts[0]}`.toLowerCase();
      if (this.prospectIndex[reordered]) {
        for (const p of this.prospectIndex[reordered]) {
          if (!seen.has(p.id)) {
            matches.push({ ...p, matchMethod: 'name_reorder' });
            seen.add(p.id);
          }
        }
      }

      // Two-word name swap
      if (secParts.length === 2) {
        const swapped = `${secParts[1]} ${secParts[0]}`;
        if (this.prospectIndex[swapped]) {
          for (const p of this.prospectIndex[swapped]) {
            if (!seen.has(p.id)) {
              matches.push({ ...p, matchMethod: 'name_swap' });
              seen.add(p.id);
            }
          }
        }
      }

      // Three-word: drop middle
      if (secParts.length === 3) {
        // SAFE: First + Last (drops middle name) - e.g., "Ellis Gary Lee" → "Gary Ellis"
        const firstLast = `${secParts[1]} ${secParts[0]}`.toLowerCase();
        if (this.prospectIndex[firstLast]) {
          for (const p of this.prospectIndex[firstLast]) {
            if (!seen.has(p.id)) {
              matches.push({ ...p, matchMethod: 'name_reorder_drop_middle' });
              seen.add(p.id);
            }
          }
        }

        // RISKY: First + Middle (drops last name!) - e.g., "Ellis Gary Lee" → "Gary Lee"
        // This can cause false positives (prospect "Gary Lee" matching "Ellis Gary Lee")
        // Keep the match but flag as UNCERTAIN with very low confidence
        const firstMiddle = `${secParts[1]} ${secParts[2]}`.toLowerCase();
        if (this.prospectIndex[firstMiddle]) {
          for (const p of this.prospectIndex[firstMiddle]) {
            if (!seen.has(p.id)) {
              matches.push({
                ...p,
                matchMethod: 'first_middle_only',
                uncertainMatch: true,
                uncertainReason: 'Matched First+Middle only; filing last name differs from prospect last name'
              });
              seen.add(p.id);
            }
          }
        }
      }
    }

    // 3. Suffix removal
    const cleanedFiling = normalized.replace(NAME_SUFFIXES_RE, '').replace(/\s+/g, ' ').trim();
    if (cleanedFiling !== normalized && this.prospectIndex[cleanedFiling]) {
      for (const p of this.prospectIndex[cleanedFiling]) {
        if (!seen.has(p.id)) {
          matches.push({ ...p, matchMethod: 'suffix_removed' });
          seen.add(p.id);
        }
      }
    }

    return matches;
  }

  // ---------------------------------------------------------------------------
  // Company cross-check (NEW — prevents Jennifer Wong class false positives)
  // ---------------------------------------------------------------------------

  _crossCheckCompany(prospect, parsedFiling, rawText) {
    if (!prospect.company || prospect.company.trim().length === 0) {
      return { verified: false, method: 'no_company_on_prospect' };
    }

    const prospectCompanyRoot = stripLegalSuffixes(prospect.company).toLowerCase().trim();
    if (prospectCompanyRoot.length < 2) {
      return { verified: false, method: 'company_too_short' };
    }

    // Guardrail: sometimes a "company" value is effectively just the person's name
    // (e.g. "Gary Lee Enterprises" -> root "gary lee" after suffix stripping).
    // In that case, checking the filing text for the "company" will trivially succeed
    // whenever the person's name appears, creating false "company_verified" signals.
    const prospectNameTokens = (prospect.name || '')
      .toLowerCase()
      .replace(/,/g, '')
      .replace(NAME_SUFFIXES_RE, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    const companyTokens = prospectCompanyRoot.split(/\s+/).filter(Boolean);
    if (companyTokens.length > 0 && companyTokens.every(t => prospectNameTokens.includes(t))) {
      return { verified: false, method: 'company_root_overlaps_prospect_name' };
    }

    // Check 1: Compare against issuer / filer / subjectCompany from parsed structured data
    const filingCompanies = [
      parsedFiling.issuer?.name,
      parsedFiling.filer?.name,
      parsedFiling.subjectCompany?.name,
    ].filter(Boolean);

    for (const fc of filingCompanies) {
      const filingRoot = stripLegalSuffixes(fc).toLowerCase().trim();
      if (filingRoot.length < 2) continue;
      // Fuzzy: one contains the other
      if (filingRoot.includes(prospectCompanyRoot) || prospectCompanyRoot.includes(filingRoot)) {
        return { verified: true, method: 'structured_issuer_match' };
      }
    }

    // Check 2: Search raw filing text for prospect company
    if (rawText) {
      const lowerText = rawText.toLowerCase();
      if (lowerText.includes(prospectCompanyRoot)) {
        return { verified: true, method: 'text_company_found' };
      }
    }

    return { verified: false, method: 'company_not_found' };
  }

  // ---------------------------------------------------------------------------
  // Text search with adaptive validation (from AdaptiveMatcher)
  // ---------------------------------------------------------------------------

  _textSearchWithValidation(rawContent) {
    if (!this.ahoCorasick) return [];

    const text = rawContent.toLowerCase();
    const acResults = this.ahoCorasick.search(text);

    // Track per-prospect hits: { nameHit, companyHit, namePositions[], companyPositions[] }
    const prospectHits = new Map();

    for (const [endPos, patterns] of acResults) {
      for (const pattern of patterns) {
        const patternInfo = this.patternMap.get(pattern);
        if (!patternInfo) continue;

        const startPos = endPos - pattern.length + 1;

        // Word boundary check (same as AdaptiveMatcher)
        const beforeChar = startPos > 0 ? text[startPos - 1] : '';
        const afterChar = endPos + 1 < text.length ? text[endPos + 1] : '';
        const boundaryRe = /[\s\.,;:!?\-\(\)\[\]{}"'\/\\|~`@#$%^&*+=<>]/;
        const beforeOk = !beforeChar || boundaryRe.test(beforeChar);
        const afterOk = !afterChar || boundaryRe.test(afterChar);
        if (!beforeOk || !afterOk) continue;

        // Adaptive validation (space boundaries, English context, encoded blocking)
        const matchInfo = { start: startPos, end: endPos + 1, pattern };
        if (!this._validateAdaptive(text, matchInfo, patternInfo)) continue;

        // Adjacent name token check — prevents "Gary Lee" matching "Ellis Gary Lee"
        // Only applies to name patterns (not company patterns)
        if (patternInfo.type === 'name') {
          if (this._hasAdjacentNameToken(rawContent, startPos, endPos + 1)) continue;
        }

        // Record hits per prospect
        for (const variation of patternInfo.variations) {
          const pid = variation.prospectId;
          let hit = prospectHits.get(pid);
          if (!hit) {
            hit = { nameHit: false, companyHit: false, namePositions: [], companyPositions: [] };
            prospectHits.set(pid, hit);
          }
          if (patternInfo.type === 'name') {
            hit.nameHit = true;
            if (hit.namePositions.length < 3) hit.namePositions.push(startPos);
          } else if (patternInfo.type === 'company') {
            hit.companyHit = true;
            if (hit.companyPositions.length < 3) hit.companyPositions.push(startPos);
          }
        }
      }
    }

    // Build matches with distance-based confidence
    const matches = [];
    for (const [pid, hits] of prospectHits) {
      const prospect = this.prospectById[pid];
      if (!prospect) continue;

      if (hits.nameHit && hits.companyHit) {
        // Calculate minimum name-company distance
        let minDist = Infinity;
        let closestNamePos = null;
        let closestCompanyPos = null;
        for (const np of hits.namePositions) {
          for (const cp of hits.companyPositions) {
            const d = Math.abs(np - cp);
            if (d < minDist) {
              minDist = d;
              closestNamePos = np;
              closestCompanyPos = cp;
            }
          }
        }

        let confidence, matchType, distanceCategory;
        if (minDist <= 4000) {
          confidence = 95;
          matchType = 'Name+Company';
          distanceCategory = 'HIGH (≤4K chars)';
        } else if (minDist <= 8000) {
          confidence = 85;
          matchType = 'Name+Company';
          distanceCategory = 'MEDIUM (4K-8K chars)';
        } else if (minDist <= 50000) {
          confidence = 70;
          matchType = 'Name+Company';
          distanceCategory = 'LOW (8K-50K chars)';
        } else {
          // Too far apart — downgrade to Name Only
          confidence = 75;
          matchType = 'Name Only';
          distanceCategory = 'TOO FAR (>50K chars)';
        }

        // Extract context snippets around name and company matches
        const nameContext = this._extractContext(rawContent, closestNamePos, 60);
        const companyContext = this._extractContext(rawContent, closestCompanyPos, 60);

        matches.push({
          prospect,
          matchMethod: 'text',
          matchType,
          confidence,
          distance: minDist,
          distanceCategory,
          nameContext,
          companyContext,
        });
      } else if (hits.nameHit) {
        const nameContext = hits.namePositions[0] != null
          ? this._extractContext(rawContent, hits.namePositions[0], 60)
          : null;

        matches.push({
          prospect,
          matchMethod: 'text',
          matchType: 'Name Only',
          confidence: 75,
          distance: null,
          distanceCategory: null,
          nameContext,
          companyContext: null,
        });
      }
      // Company-only matches are intentionally skipped (low value, high noise)
    }

    return matches;
  }

  /**
   * Extract a context snippet around a position in text.
   */
  _extractContext(text, position, radius = 60) {
    if (position == null || !text) return null;
    const start = Math.max(0, position - radius);
    const end = Math.min(text.length, position + radius);
    let snippet = text.slice(start, end);
    // Clean up: collapse whitespace, add ellipsis if truncated
    snippet = snippet.replace(/\s+/g, ' ').trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    return snippet;
  }

  /**
   * Apply AdaptiveMatcher's validation rules:
   * space boundaries, English context, encoded blocking
   */
  _validateAdaptive(text, matchInfo, patternInfo) {
    const { start, end } = matchInfo;

    const prospectId = patternInfo.variations[0]?.prospectId;
    if (!prospectId) return true;
    const prospect = this.prospectById[prospectId];
    if (!prospect) return true;

    let rules;
    if (patternInfo.type === 'name') {
      rules = this.adaptiveRules.classifyName(prospect.name);
    } else if (patternInfo.type === 'company') {
      rules = this.adaptiveRules.classifyCompany(prospect.company);
    } else {
      return true;
    }

    // RULE 1: Skip matching entirely
    if (rules.matchingRules && rules.matchingRules.skipMatching) return false;

    // RULE 2: Space boundary check
    if (rules.matchingRules && rules.matchingRules.requireWordBoundaries) {
      const beforeChar = start > 0 ? text[start - 1] : ' ';
      const afterChar = end < text.length ? text[end] : ' ';
      const beforeIsSpace = /[\s\n\t]/.test(beforeChar) || start === 0;
      const afterIsSpace = /[\s\n\t,.]/.test(afterChar) || end === text.length;
      if (!beforeIsSpace || !afterIsSpace) return false;
    }

    // RULE 3: English context check
    if (rules.matchingRules && rules.matchingRules.requireEnglishContext) {
      const ctxStart = Math.max(0, start - 50);
      const ctxEnd = Math.min(text.length, end + 50);
      const context = text.slice(ctxStart, ctxEnd);
      const englishWords = context.match(/\b[a-z]{4,}\b/g) || [];
      const minWords = rules.matchingRules.minContextWords || 2;
      if (englishWords.length < minWords) return false;
    }

    // RULE 4: Block encoded sections
    if (rules.matchingRules && rules.matchingRules.blockEncodedSections) {
      const ctxStart = Math.max(0, start - 100);
      const ctxEnd = Math.min(text.length, end + 100);
      const context = text.slice(ctxStart, ctxEnd);
      const encodedChars = (context.match(/[^a-z0-9\s.,;:!?()\-'"]/g) || []).length;
      const encodedPercent = (encodedChars / context.length) * 100;
      if (encodedPercent > 30) return false;

      // Also check for minimal English words (blocks garbage text)
      const commonEnglishWords = [
        'the', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'by', 'from',
        'as', 'at', 'on', 'that', 'this', 'which', 'will', 'shall', 'may',
        'an', 'a', 'but', 'not', 'if', 'such', 'its', 'it', 'be', 'any',
        'has', 'have', 'had', 'was', 'were', 'been', 'are', 'is',
        'company', 'corporation', 'inc', 'llc', 'limited', 'group',
        'agreement', 'pursuant', 'section', 'hereby', 'therefore',
        'securities', 'stock', 'shares', 'common', 'exchange',
        'filing', 'report', 'statement', 'disclosure',
        'name', 'title', 'officer', 'director', 'executive', 'chief',
        'date', 'period', 'term', 'year', 'fiscal',
        'amount', 'total', 'value', 'price',
        'issued', 'authorized', 'granted', 'acquired', 'sold',
      ];
      const contextWords = context.split(/\s+/).filter(w => w.length > 2);
      const englishWordCount = contextWords.filter(w => commonEnglishWords.includes(w)).length;
      if (context.length > 50 && englishWordCount < 2) return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Adjacent name token check (prevents "Gary Lee" matching "Ellis Gary Lee")
  // ---------------------------------------------------------------------------

  /**
   * Check if the matched text appears to be part of a longer name.
   * Returns true if there's an adjacent name-like token (reject the match).
   *
   * @param {string} text - The full text being searched
   * @param {number} matchStart - Start position of the match
   * @param {number} matchEnd - End position of the match
   * @returns {boolean} True if match is likely part of a longer name (should reject)
   */
  _hasAdjacentNameToken(text, matchStart, matchEnd) {
    // Common titles/roles that appear before names but aren't part of the name
    const TITLES = new Set([
      'mr', 'ms', 'mrs', 'dr', 'prof',
      'ceo', 'cfo', 'coo', 'cto', 'cio', 'cmo', 'cpo', 'cso',
      'evp', 'svp', 'vp', 'avp',
      'director', 'president', 'chairman', 'chairwoman', 'chair',
      'executive', 'officer', 'manager', 'partner', 'founder',
      'chief', 'senior', 'junior', 'managing', 'general',
      'hon', 'honorable', 'judge', 'justice',
      'by', 'from', 'to', 'of', 'and', 'or', 'the', 'a', 'an',
      'name', 'signed', 'filed', 'reported', 'pursuant',
    ]);

    // Look at 25 chars before and after the match
    const beforeWindow = text.slice(Math.max(0, matchStart - 25), matchStart);
    const afterWindow = text.slice(matchEnd, Math.min(text.length, matchEnd + 25));

    // Check for adjacent token BEFORE (no punctuation between, just whitespace)
    // Pattern: word characters followed by only whitespace up to match start
    const beforeMatch = beforeWindow.match(/([a-zA-Z]+)\s*$/);
    if (beforeMatch) {
      const tokenBefore = beforeMatch[1].toLowerCase();
      // Check what's between the token and our match
      const gapBefore = beforeWindow.slice(beforeMatch.index + beforeMatch[1].length);
      // If gap is ONLY whitespace (no punctuation), this token is "adjacent"
      if (/^\s*$/.test(gapBefore)) {
        // If it's not a known title and looks like a name (2-15 alphabetic chars, starts with capital in original)
        if (!TITLES.has(tokenBefore) && tokenBefore.length >= 2 && tokenBefore.length <= 15) {
          // Check if the original had a capital (name-like)
          const originalToken = beforeWindow.slice(beforeMatch.index, beforeMatch.index + beforeMatch[1].length);
          if (/^[A-Z]/.test(originalToken)) {
            return true; // Likely part of a longer name
          }
        }
      }
    }

    // Check for adjacent token AFTER (no punctuation between, just whitespace)
    const afterMatch = afterWindow.match(/^\s*([a-zA-Z]+)/);
    if (afterMatch) {
      const tokenAfter = afterMatch[1].toLowerCase();
      // Check what's between match end and the token
      const gapAfter = afterWindow.slice(0, afterMatch.index + afterMatch[0].length - afterMatch[1].length);
      // If gap is ONLY whitespace (no punctuation), this token is "adjacent"
      if (/^\s*$/.test(gapAfter)) {
        // If it's not a known title/common word and looks like a name
        if (!TITLES.has(tokenAfter) && tokenAfter.length >= 2 && tokenAfter.length <= 15) {
          // Check if the original had a capital (name-like)
          const startIdx = afterMatch.index + afterMatch[0].length - afterMatch[1].length;
          const originalToken = afterWindow.slice(startIdx, startIdx + afterMatch[1].length);
          if (/^[A-Z]/.test(originalToken)) {
            return true; // Likely part of a longer name
          }
        }
      }
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Confidence scoring matrix
  // ---------------------------------------------------------------------------

  _computeConfidence(matchMethod, companyCheck) {
    const verified = companyCheck && companyCheck.verified;
    switch (matchMethod) {
      case 'exact':
      case 'name_swap':
        return verified ? 98 : 60;
      case 'name_reorder':
        return verified ? 95 : 50;
      case 'name_reorder_drop_middle':
        return verified ? 90 : 40;
      case 'suffix_removed':
        return verified ? 90 : 40;
      case 'first_middle_only':
        // UNCERTAIN: First+Middle match (drops filing's last name)
        // Very low confidence regardless of company verification
        // because the filing person's actual last name differs from prospect
        return 20;
      default:
        return verified ? 90 : 50;
    }
  }

  // ---------------------------------------------------------------------------
  // Match verdict (do not drop matches; classify for review)
  // ---------------------------------------------------------------------------

  _computeMatchVerdict(result) {
    const fp = result.fp_risk_level || '';
    const confidence = Number.isFinite(result.match_confidence) ? result.match_confidence : 0;

    // Hard stop: structured First+Middle-only is almost always the wrong person
    if (result.structured_match_type === 'first_middle_only') {
      return {
        verdict: 'LIKELY_FALSE_POSITIVE',
        reason: 'Structured match used First+Middle only (drops filing last name)'
      };
    }

    if (fp === 'HIGH_RISK') {
      return { verdict: 'LIKELY_FALSE_POSITIVE', reason: 'High FP risk score' };
    }

    if (result.uncertain_match) {
      return { verdict: 'NEEDS_REVIEW', reason: result.uncertain_reason || 'Uncertain match' };
    }

    if (result.company_verified && confidence >= 85) {
      return { verdict: 'LIKELY_VALID', reason: 'High confidence with company verification' };
    }

    if (!result.company_verified && result.match_method === 'structured') {
      return { verdict: 'NEEDS_REVIEW', reason: 'Structured name match but company not verified' };
    }

    if (fp === 'MEDIUM_RISK') {
      return { verdict: 'NEEDS_REVIEW', reason: 'Medium FP risk score' };
    }

    if (confidence < 70) {
      return { verdict: 'NEEDS_REVIEW', reason: 'Low confidence' };
    }

    return { verdict: 'LIKELY_VALID', reason: 'Passed validation heuristics' };
  }

  // ---------------------------------------------------------------------------
  // Filing processing
  // ---------------------------------------------------------------------------

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

    // Extract raw text for company cross-checking and text search
    const rawText = extractRawText(rawContent);

    // Step 2: Structured matching with company cross-check
    const structuredMatches = [];
    if (parsed.persons && parsed.persons.length > 0) {
      for (const person of parsed.persons) {
        const prospectMatches = this._matchName(person.name);
        for (const pm of prospectMatches) {
          const companyCheck = this._crossCheckCompany(pm, parsed, rawText);
          const confidence = this._computeConfidence(pm.matchMethod, companyCheck);

          if (companyCheck.verified) {
            this.stats.companyVerified++;
          } else {
            this.stats.companyNotVerified++;
          }

          structuredMatches.push({
            prospect: pm,
            filingPerson: person,
            matchMethod: 'structured',
            structuredMatchType: pm.matchMethod,  // exact, name_reorder, first_middle_only, etc.
            confidence,
            companyVerified: companyCheck.verified,
            companyCheckMethod: companyCheck.method,
            uncertainMatch: pm.uncertainMatch || false,
            uncertainReason: pm.uncertainReason || '',
          });
        }
      }
    }

    // Step 3: Text matching with adaptive validation
    const textMatches = this._textSearchWithValidation(rawContent);
    const structuredProspectIds = new Set(structuredMatches.map(m => m.prospect.id));

    // Merge: structured matches take priority, text matches fill gaps
    const allMatches = [...structuredMatches];
    for (const tm of textMatches) {
      if (!structuredProspectIds.has(tm.prospect.id)) {
        allMatches.push({
          prospect: tm.prospect,
          filingPerson: null,
          matchMethod: 'text',
          confidence: tm.confidence,
          companyVerified: tm.matchType === 'Name+Company',
          companyCheckMethod: tm.matchType === 'Name+Company' ? 'text_proximity' : 'none',
          textMatchType: tm.matchType,
          textDistance: tm.distance,
          textDistanceCategory: tm.distanceCategory,
          nameContext: tm.nameContext,
          companyContext: tm.companyContext,
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
        structured_match_type: match.structuredMatchType || null,  // exact, name_reorder, first_middle_only, etc.
        match_confidence: match.confidence,
        company_verified: match.companyVerified,
        company_check_method: match.companyCheckMethod || '',
        uncertain_match: match.uncertainMatch || false,
        uncertain_reason: match.uncertainReason || '',

        // Distance info (for text matches with Name+Company)
        distance: match.textDistance || null,
        distance_category: match.textDistanceCategory || null,

        // Context snippets (for text matches)
        name_context: match.nameContext || null,
        company_context: match.companyContext || null,

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

        // Transaction details
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

        // Signal summary
        signal_summary: signal.summary,
      };

      // Generate match_remarks (human-readable explanation of how match was made)
      const remarks = [];
      if (match.matchMethod === 'text') {
        if (match.textMatchType === 'Name+Company') {
          if (result.distance) {
            remarks.push(`Name and company found ${result.distance.toLocaleString()} chars apart`);
            remarks.push(`Distance quality: ${result.distance_category || 'Unknown'}`);
          } else {
            remarks.push('Both name and company found together');
          }
        } else if (match.textMatchType === 'Name Only') {
          if (result.distance && result.distance > 50000) {
            remarks.push(`Company found but too far (${(result.distance / 1000).toFixed(1)}K chars away)`);
          } else {
            remarks.push('Only prospect name found (company not detected)');
          }
        }
      } else if (match.matchMethod === 'structured') {
        remarks.push(`Structured match via ${result.structured_match_type || 'XML parsing'}`);
        if (result.company_verified) {
          remarks.push(`Company verified: ${result.company_check_method}`);
        } else {
          remarks.push('Company not verified in filing');
        }
        if (result.uncertain_match) {
          remarks.push(`UNCERTAIN: ${result.uncertain_reason}`);
        }
      }
      result.match_remarks = remarks.join(' | ');

      // False-positive risk scoring
      const fpInput = {
        prospect_name: result.prospect_name,
        company_name: result.prospect_company || '',
        match_type: match.textMatchType || (match.companyVerified ? 'Name + Company' : 'Name Only'),
        confidence: result.match_confidence,
        sec_filing: result.filename,
        match_method: result.match_method,
        structured_match_type: result.structured_match_type,
        company_verified: result.company_verified,
        uncertain_match: result.uncertain_match,
      };
      const fpAnalysis = this.fpDetector.calculateFPRiskScore(fpInput);
      result.fp_risk_score = fpAnalysis.score;
      result.fp_risk_level = fpAnalysis.classification;
      result.fp_reasons = fpAnalysis.reasons.join(' | ');

      // Verdict for downstream workflows (auto-approve vs review vs reject)
      const verdict = this._computeMatchVerdict(result);
      result.match_verdict = verdict.verdict;
      result.match_verdict_reason = verdict.reason;

      this.results.push(result);
      this.stats.matchesFound++;
      this.stats.matchesByTier[signal.tier] = (this.stats.matchesByTier[signal.tier] || 0) + 1;
      this.stats.matchesByFormType[parsed.formType] = (this.stats.matchesByFormType[parsed.formType] || 0) + 1;
      this.stats.matchesByMatchMethod[match.matchMethod] = (this.stats.matchesByMatchMethod[match.matchMethod] || 0) + 1;

      // Track confidence distribution
      const confBucket = `${Math.floor(match.confidence / 10) * 10}-${Math.floor(match.confidence / 10) * 10 + 9}`;
      this.stats.matchesByConfidence[confBucket] = (this.stats.matchesByConfidence[confBucket] || 0) + 1;

      // Track uncertain matches
      if (match.uncertainMatch) {
        this.stats.uncertainMatches++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

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
        { id: 'match_confidence', title: 'Confidence' },
        { id: 'uncertain_match', title: 'Uncertain Match' },
        { id: 'uncertain_reason', title: 'Uncertain Reason' },
        { id: 'match_verdict', title: 'Match Verdict' },
        { id: 'match_verdict_reason', title: 'Match Verdict Reason' },
        { id: 'company_verified', title: 'Company Verified' },
        { id: 'company_check_method', title: 'Company Check Method' },
        { id: 'distance', title: 'Distance (chars)' },
        { id: 'distance_category', title: 'Distance Category' },
        { id: 'match_remarks', title: 'Match Remarks' },
        { id: 'name_context', title: 'Name Context' },
        { id: 'company_context', title: 'Company Context' },
        { id: 'structured_match_type', title: 'Structured Match Type' },
        { id: 'form_type', title: 'Form Type' },
        { id: 'issuer_name', title: 'Issuer/Company' },
        { id: 'issuer_ticker', title: 'Ticker' },
        { id: 'filed_date', title: 'Filed Date' },
        { id: 'match_method', title: 'Match Method' },
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
        { id: 'fp_risk_score', title: 'FP Risk Score' },
        { id: 'fp_risk_level', title: 'FP Risk Level' },
        { id: 'fp_reasons', title: 'FP Reasons' },
        { id: 'filename', title: 'Filing Filename' },
        { id: 'accession_number', title: 'Accession Number' },
      ],
    });

    // Sort: Tier 1 first, then urgency, then confidence desc, then value
    const sorted = [...this.results].sort((a, b) => {
      if (a.signal_tier !== b.signal_tier) return a.signal_tier - b.signal_tier;
      const urgencyOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (a.urgency !== b.urgency) return (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3);
      if (a.match_confidence !== b.match_confidence) return b.match_confidence - a.match_confidence;
      return (b.total_value || 0) - (a.total_value || 0);
    });

    await writer.writeRecords(sorted);
    return outputPath;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  printStats() {
    console.log('\n' + '='.repeat(80));
    console.log('UNIFIED MATCHER — RESULTS SUMMARY');
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

    console.log('Company Verification:');
    console.log(`  Verified (structured):     ${this.stats.companyVerified}`);
    console.log(`  Not verified (structured): ${this.stats.companyNotVerified}`);
    console.log('');

    console.log('Match Quality:');
    console.log(`  Uncertain matches:         ${this.stats.uncertainMatches} (First+Middle only, needs review)`);
    console.log('');

    console.log('Confidence Distribution:');
    const confBuckets = Object.entries(this.stats.matchesByConfidence).sort((a, b) => b[0].localeCompare(a[0]));
    for (const [bucket, count] of confBuckets) {
      console.log(`  ${bucket.padEnd(10)} ${count}`);
    }
    console.log('');

    console.log('Matches by Form Type:');
    const sortedTypes = Object.entries(this.stats.matchesByFormType).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedTypes) {
      console.log(`  ${type.padEnd(25)} ${count}`);
    }
    console.log('');

    console.log('False Positive Risk Distribution:');
    const fpCounts = { HIGH_RISK: 0, MEDIUM_RISK: 0, LOW_RISK: 0, LIKELY_VALID: 0 };
    for (const r of this.results) {
      if (fpCounts[r.fp_risk_level] !== undefined) fpCounts[r.fp_risk_level]++;
    }
    console.log(`  HIGH_RISK (70+):    ${fpCounts.HIGH_RISK}`);
    console.log(`  MEDIUM_RISK (50-69): ${fpCounts.MEDIUM_RISK}`);
    console.log(`  LOW_RISK (30-49):    ${fpCounts.LOW_RISK}`);
    console.log(`  LIKELY_VALID (<30):  ${fpCounts.LIKELY_VALID}`);
    console.log('');

    const uniqueProspects = new Set(this.results.map(r => r.prospect_id)).size;
    console.log(`Unique prospects matched:  ${uniqueProspects} / ${this.prospects.length}`);

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

module.exports = UnifiedMatcher;
