/**
 * Form 8-K Parser — Current Report (Major Corporate Events)
 *
 * 8-K is the "something happened" workhorse. Key items for prospect research:
 *   - Item 1.01: Entry into Material Agreement
 *   - Item 2.01: Completion of Acquisition/Disposition
 *   - Item 5.02: Departure/Election of Directors/Officers (CRITICAL — career events + hidden liquidity from severance)
 *   - Item 5.07: Submission for Security Holder Vote
 *   - Item 8.01: Other Events
 *
 * 8-K content is HTML/XBRL — no clean XML schema.
 * We extract item types from the header and attempt to find names in the body.
 */

const { extractEmbeddedHtml, stripHtml, decodeEntities } = require('./xml-utils');

// Map item codes to categories
const ITEM_CATEGORIES = {
  'Entry into a Material Definitive Agreement': { code: '1.01', category: 'AGREEMENT' },
  'Completion of Acquisition or Disposition of Assets': { code: '2.01', category: 'M&A' },
  'Results of Operations and Financial Condition': { code: '2.02', category: 'EARNINGS' },
  'Creation of a Direct Financial Obligation': { code: '2.03', category: 'DEBT' },
  'Departure of Directors or Certain Officers': { code: '5.02', category: 'PERSONNEL' },
  'Election of Directors': { code: '5.02', category: 'PERSONNEL' },
  'Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers': { code: '5.02', category: 'PERSONNEL' },
  'Appointment of Certain Officers': { code: '5.02', category: 'PERSONNEL' },
  'Amendments to Articles of Incorporation or Bylaws': { code: '5.03', category: 'GOVERNANCE' },
  'Submission of Matters to a Vote of Security Holders': { code: '5.07', category: 'GOVERNANCE' },
  'Regulation FD Disclosure': { code: '7.01', category: 'DISCLOSURE' },
  'Other Events': { code: '8.01', category: 'OTHER' },
  'Financial Statements and Exhibits': { code: '9.01', category: 'EXHIBITS' },
};

function parseForm8K(rawContent, header) {
  const result = {
    formType: header.formType,
    filedDate: header.filedDate,
    periodOfReport: header.periodOfReport,

    filer: {
      name: header.filer?.name || null,
      cik: header.filer?.cik || null,
      sic: header.filer?.sic || null,
    },

    items: [],        // Structured item list
    categories: [],   // Unique categories (PERSONNEL, M&A, etc.)
    isPersonnelEvent: false,
    isMAEvent: false,
    isEarningsEvent: false,

    // Names extracted from the body text (best-effort)
    mentionedNames: [],

    persons: [],
    transactions: [],
    alerts: [],
  };

  // Parse item information from header
  for (const itemText of (header.itemInformation || [])) {
    const categoryInfo = matchItemCategory(itemText);
    result.items.push({
      text: itemText,
      code: categoryInfo.code,
      category: categoryInfo.category,
    });
    if (categoryInfo.category && !result.categories.includes(categoryInfo.category)) {
      result.categories.push(categoryInfo.category);
    }
  }

  result.isPersonnelEvent = result.categories.includes('PERSONNEL');
  result.isMAEvent = result.categories.includes('M&A');
  result.isEarningsEvent = result.categories.includes('EARNINGS');

  // Try to extract names from the HTML body for personnel events
  if (result.isPersonnelEvent) {
    const html = extractEmbeddedHtml(rawContent);
    if (html) {
      const text = stripHtml(html);
      const names = extractPersonnelNames(text);
      result.mentionedNames = names;
      for (const n of names) {
        result.persons.push({
          name: n.name,
          role: n.role || 'Person mentioned in 8-K',
          cik: null,
        });
      }
    }
  }

  // Alerts
  if (result.isPersonnelEvent) {
    const nameList = result.mentionedNames.map(n => n.name).join(', ');
    result.alerts.push({
      type: 'PERSONNEL_CHANGE',
      severity: 'HIGH',
      message: `Executive/director departure or appointment at ${result.filer.name}.${nameList ? ` Mentioned: ${nameList}.` : ''} Potential hidden liquidity from severance/accelerated vesting.`,
    });
  }

  if (result.isMAEvent) {
    result.alerts.push({
      type: 'M&A_EVENT',
      severity: 'HIGH',
      message: `M&A activity at ${result.filer.name}. Potential cashout event for insiders.`,
    });
  }

  if (result.isEarningsEvent) {
    result.alerts.push({
      type: 'EARNINGS',
      severity: 'INFO',
      message: `Earnings announcement by ${result.filer.name}.`,
    });
  }

  if (!result.isPersonnelEvent && !result.isMAEvent && !result.isEarningsEvent && result.items.length > 0) {
    result.alerts.push({
      type: 'CORPORATE_EVENT',
      severity: 'INFO',
      message: `${result.filer.name}: ${result.items.map(i => i.text).join('; ')}.`,
    });
  }

  return result;
}

function matchItemCategory(itemText) {
  const normalized = itemText.trim();
  // Exact match first
  if (ITEM_CATEGORIES[normalized]) return ITEM_CATEGORIES[normalized];
  // Partial match
  for (const [key, val] of Object.entries(ITEM_CATEGORIES)) {
    if (normalized.toLowerCase().includes(key.toLowerCase().slice(0, 20))) return val;
  }
  // Keyword-based
  const lower = normalized.toLowerCase();
  if (lower.includes('departure') || lower.includes('appointment') || lower.includes('election') || lower.includes('officer') || lower.includes('director')) {
    return { code: '5.02', category: 'PERSONNEL' };
  }
  if (lower.includes('acquisition') || lower.includes('merger') || lower.includes('disposition')) {
    return { code: '2.01', category: 'M&A' };
  }
  if (lower.includes('results of operations') || lower.includes('financial condition')) {
    return { code: '2.02', category: 'EARNINGS' };
  }
  return { code: null, category: 'OTHER' };
}

/**
 * Best-effort name extraction from 8-K body text for personnel events.
 * Looks for patterns like "John Smith has been appointed..." or "the departure of Jane Doe"
 */
function extractPersonnelNames(text) {
  const names = [];
  const seen = new Set();

  // Common patterns in 8-K personnel disclosures
  const patterns = [
    /(?:appointed|hired|named|elected|promoted)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+(?:\s+(?:Jr\.|Sr\.|III|IV|II))?)/g,
    /(?:departure|resignation|retirement|termination)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+(?:\s+(?:Jr\.|Sr\.|III|IV|II))?)/g,
    /(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (!seen.has(name) && name.length > 3 && name.split(' ').length >= 2) {
        seen.add(name);
        // Try to find a role near the name
        const contextStart = Math.max(0, match.index - 100);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 200);
        const context = text.slice(contextStart, contextEnd);
        const roleMatch = context.match(/(?:Chief|President|Vice|Senior|Executive|Managing|General|Director|Officer|CEO|CFO|COO|CTO|CIO|SVP|EVP|VP)\s*(?:of\s+)?[A-Za-z\s,&]*/i);

        names.push({
          name,
          role: roleMatch ? roleMatch[0].trim().slice(0, 80) : null,
        });
      }
    }
  }

  return names;
}

module.exports = { parseForm8K };
