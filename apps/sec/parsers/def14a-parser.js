/**
 * DEF 14A Parser — Definitive Proxy Statement
 *
 * The single best document for total wealth picture:
 *   - Summary Compensation Table (salary, bonus, stock awards, options, all other comp)
 *   - Beneficial Ownership Table (shares held by each director/officer)
 *   - Director bios (often include educational background — alumni discovery!)
 *   - "All Other Compensation" column = UHNW lifestyle proxy (aircraft, security, etc.)
 *
 * DEF 14A is HTML — no clean XML schema.
 * This parser does best-effort extraction from HTML/text.
 * For production, LLM augmentation is recommended for complex tables.
 */

const { extractEmbeddedHtml, stripHtml, decodeEntities } = require('./xml-utils');

function parseDef14A(rawContent, header) {
  const result = {
    formType: header.formType,
    filedDate: header.filedDate,
    periodOfReport: header.periodOfReport,

    filer: {
      name: header.filer?.name || null,
      cik: header.filer?.cik || null,
    },

    // Named Executive Officers found in compensation tables
    executives: [],

    // Directors found
    directors: [],

    // Education mentions (for alumni discovery)
    educationMentions: [],

    persons: [],
    transactions: [],
    alerts: [],
  };

  const html = extractEmbeddedHtml(rawContent);
  if (!html) {
    return result;
  }

  const text = stripHtml(html);

  // Extract Named Executive Officers (NEOs) from Summary Compensation Table area
  // Look for common patterns around compensation tables
  const neoNames = extractNEONames(text);
  for (const neo of neoNames) {
    result.executives.push(neo);
    result.persons.push({
      name: neo.name,
      role: neo.title || 'Named Executive Officer',
      cik: null,
    });
  }

  // Extract director names from director sections
  const directorNames = extractDirectorNames(text);
  for (const dir of directorNames) {
    // Avoid duplicates with executives
    if (!result.executives.some(e => e.name === dir.name)) {
      result.directors.push(dir);
      result.persons.push({
        name: dir.name,
        role: dir.title || 'Director',
        cik: null,
      });
    }
  }

  // Look for educational institution mentions (alumni discovery)
  result.educationMentions = extractEducationMentions(text);

  // Alerts
  if (result.executives.length > 0) {
    result.alerts.push({
      type: 'COMPENSATION_DISCLOSURE',
      severity: 'MEDIUM',
      message: `Proxy statement for ${result.filer.name}. ${result.executives.length} NEO(s) identified. Compensation data available.`,
    });
  }

  if (result.educationMentions.length > 0) {
    result.alerts.push({
      type: 'ALUMNI_DISCOVERY',
      severity: 'INFO',
      message: `Educational institutions mentioned: ${[...new Set(result.educationMentions.map(e => e.institution))].join(', ')}.`,
    });
  }

  return result;
}

/**
 * Extract Named Executive Officer names from proxy statement text.
 * Looks for patterns around compensation discussion.
 */
function extractNEONames(text) {
  const names = [];
  const seen = new Set();

  // Pattern: "Title" followed by name, or name followed by title
  const patterns = [
    // "John Smith, Chief Executive Officer"
    /([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+(?:\s+(?:Jr\.|Sr\.|III|IV|II))?)\s*,\s*((?:Chief|President|Executive|Senior|Vice)\s[A-Za-z\s]+Officer)/gi,
    // "Chief Executive Officer John Smith"
    /((?:Chief|President|Executive|Senior|Vice)\s[A-Za-z\s]+Officer)\s*[,:]?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+)/gi,
    // CEO/CFO/COO/etc acronyms
    /([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+)\s*,?\s*(?:our\s+)?(CEO|CFO|COO|CTO|CIO|CLO|CHRO|CAO)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let name, title;
      if (match[1].match(/^(Chief|President|Executive|Senior|Vice)/i)) {
        title = match[1].trim();
        name = match[2].trim();
      } else {
        name = match[1].trim();
        title = match[2].trim();
      }

      if (name && !seen.has(name) && name.split(' ').length >= 2 && name.length > 3) {
        seen.add(name);
        names.push({ name, title });
      }
    }
  }

  return names;
}

/**
 * Extract director names from proxy statement.
 */
function extractDirectorNames(text) {
  const names = [];
  const seen = new Set();

  // Pattern: "Director" near a name
  const patterns = [
    /([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+)\s*(?:,\s*|\s+)(?:Independent\s+)?Director/gi,
    /Director\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name && !seen.has(name) && name.split(' ').length >= 2 && name.length > 3) {
        seen.add(name);
        names.push({ name, title: 'Director' });
      }
    }
  }

  return names;
}

/**
 * Extract education/university mentions from proxy text (alumni discovery).
 */
function extractEducationMentions(text) {
  const mentions = [];

  // Patterns for education background
  const patterns = [
    /(?:B\.?A\.?|B\.?S\.?|M\.?A\.?|M\.?S\.?|M\.?B\.?A\.?|J\.?D\.?|Ph\.?D\.?|Ed\.?D\.?|Bachelor|Master|Doctor|degree)\s+(?:from|in\s+\w+\s+from)\s+(?:the\s+)?([A-Z][A-Za-z\s]+?(?:University|College|Institute|School|Academy))/gi,
    /(?:graduated|attended|alumnus|alumna|alumni|studied)\s+(?:from\s+)?(?:the\s+)?([A-Z][A-Za-z\s]+?(?:University|College|Institute|School|Academy))/gi,
    /([A-Z][A-Za-z\s]+?(?:University|College|Institute|School|Academy))[\s,]+(?:where|class of|in\s+\d{4})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const institution = match[1].trim();
      if (institution.length > 3 && institution.length < 80) {
        mentions.push({ institution });
      }
    }
  }

  return mentions;
}

module.exports = { parseDef14A };
