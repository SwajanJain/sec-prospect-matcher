/**
 * Generic Filing Parser — Fallback for All Other Form Types
 *
 * For filing types without a specialized parser (424B, 497, 10-K, S-1, etc.),
 * extract basic metadata from the header. Name matching against these forms
 * is handled by the text-based matcher (existing AdaptiveMatcher).
 */

function parseGeneric(rawContent, header) {
  return {
    formType: header.formType,
    filedDate: header.filedDate,
    periodOfReport: header.periodOfReport,

    filer: {
      name: header.filer?.name || header.issuer?.name || null,
      cik: header.filer?.cik || header.issuer?.cik || null,
    },

    // Generic filings rely on text matching for persons
    persons: [],
    transactions: [],
    alerts: [],

    // Flag that this used generic parsing
    _parserUsed: 'generic',
  };
}

module.exports = { parseGeneric };
