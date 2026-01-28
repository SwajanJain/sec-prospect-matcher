/**
 * SEC Filing Header Parser
 * Extracts metadata from the SEC-HEADER section common to all EDGAR filings.
 */

function parseHeader(rawContent) {
  const result = {
    accessionNumber: null,
    formType: null,
    filedDate: null,
    periodOfReport: null,
    acceptanceDatetime: null,
    publicDocumentCount: null,
    itemInformation: [],      // 8-K items
    reportingOwner: null,     // For ownership forms (3/4/5)
    issuer: null,             // Company info
    filer: null,              // For non-ownership forms
  };

  // Extract header section
  const headerMatch = rawContent.match(/<SEC-HEADER>([\s\S]*?)<\/SEC-HEADER>/);
  if (!headerMatch) return result;
  const header = headerMatch[1];

  // Basic fields
  result.accessionNumber = extractField(header, 'ACCESSION NUMBER');
  result.formType = extractField(header, 'CONFORMED SUBMISSION TYPE');
  result.filedDate = extractField(header, 'FILED AS OF DATE');
  result.periodOfReport = extractField(header, 'CONFORMED PERIOD OF REPORT');
  result.acceptanceDatetime = extractField(header, '<ACCEPTANCE-DATETIME>', true);
  result.publicDocumentCount = extractField(header, 'PUBLIC DOCUMENT COUNT');

  // 8-K item information (can have multiple)
  const itemMatches = header.match(/ITEM INFORMATION:\s*(.+)/g);
  if (itemMatches) {
    result.itemInformation = itemMatches.map(m => m.replace('ITEM INFORMATION:', '').trim());
  }

  // Reporting owner (Forms 3/4/5/144)
  const ownerSection = header.match(/REPORTING-OWNER:\s*([\s\S]*?)(?=ISSUER:|FILER:|$)/);
  if (ownerSection) {
    result.reportingOwner = {
      name: extractField(ownerSection[1], 'COMPANY CONFORMED NAME'),
      cik: extractField(ownerSection[1], 'CENTRAL INDEX KEY'),
      street1: extractField(ownerSection[1], 'STREET 1'),
      city: extractField(ownerSection[1], 'CITY'),
      state: extractField(ownerSection[1], 'STATE'),
      zip: extractField(ownerSection[1], 'ZIP'),
    };
  }

  // Issuer (for ownership forms)
  const issuerSection = header.match(/ISSUER:\s*([\s\S]*?)(?=REPORTING-OWNER:|FILER:|$)/);
  if (issuerSection) {
    result.issuer = {
      name: extractField(issuerSection[1], 'COMPANY CONFORMED NAME'),
      cik: extractField(issuerSection[1], 'CENTRAL INDEX KEY'),
      sic: extractField(issuerSection[1], 'STANDARD INDUSTRIAL CLASSIFICATION'),
      stateOfIncorporation: extractField(issuerSection[1], 'STATE OF INCORPORATION'),
      ein: extractField(issuerSection[1], 'EIN'),
    };
  }

  // Filer (for non-ownership forms: 8-K, 10-K, DEF 14A, etc.)
  const filerSection = header.match(/FILER:\s*([\s\S]*?)(?=REPORTING-OWNER:|ISSUER:|SUBJECT COMPANY:|$)/);
  if (filerSection) {
    result.filer = {
      name: extractField(filerSection[1], 'COMPANY CONFORMED NAME'),
      cik: extractField(filerSection[1], 'CENTRAL INDEX KEY'),
      sic: extractField(filerSection[1], 'STANDARD INDUSTRIAL CLASSIFICATION'),
      stateOfIncorporation: extractField(filerSection[1], 'STATE OF INCORPORATION'),
      ein: extractField(filerSection[1], 'EIN'),
    };
  }

  return result;
}

function extractField(text, fieldName, isTag = false) {
  if (isTag) {
    const match = text.match(new RegExp(fieldName + '(.+)'));
    return match ? match[1].trim() : null;
  }
  const match = text.match(new RegExp(fieldName + ':\\s*(.+)'));
  return match ? match[1].trim() : null;
}

/**
 * Normalize form type to a canonical category for routing.
 * Maps variants like "4/A", "3/A", "8-K/A" to their base types.
 */
function normalizeFormType(formType) {
  if (!formType) return 'UNKNOWN';
  const ft = formType.toUpperCase().trim();

  // Ownership forms
  if (/^4(\/A)?$/.test(ft)) return 'FORM4';
  if (/^3(\/A)?$/.test(ft)) return 'FORM3';
  if (/^5(\/A)?$/.test(ft)) return 'FORM5';

  // Form 144
  if (ft === '144') return 'FORM144';

  // 8-K family
  if (/^8-K/.test(ft)) return '8K';

  // Proxy statements
  if (/^DEF\s*14A$/.test(ft)) return 'DEF14A';
  if (/^DEFA14A$/.test(ft)) return 'DEFA14A';
  if (/^DEFC14A$/.test(ft)) return 'DEFC14A';
  if (/^DEFM14A$/.test(ft)) return 'DEFM14A';
  if (/^PRE\s*14A$/.test(ft)) return 'PRE14A';
  if (/^PREM14A$/.test(ft)) return 'PREM14A';

  // 13D/G schedules
  if (/^SCHEDULE 13D/.test(ft)) return 'SC13D';
  if (/^SCHEDULE 13G/.test(ft)) return 'SC13G';

  // 13F institutional holdings
  if (/^13F-HR/.test(ft)) return '13FHR';
  if (/^13F-NT/.test(ft)) return '13FNT';

  // Form D (private offerings)
  if (/^D(\/A)?$/.test(ft)) return 'FORMD';

  // Annual/quarterly reports
  if (/^10-K/.test(ft)) return '10K';
  if (/^10-Q/.test(ft)) return '10Q';

  // IPO / offerings
  if (/^S-1/.test(ft)) return 'S1';
  if (/^F-1/.test(ft)) return 'F1';
  if (/^S-4/.test(ft)) return 'S4';
  if (/^424B/.test(ft)) return '424B';

  // Foreign issuer equivalents
  if (/^20-F/.test(ft)) return '20F';
  if (/^6-K/.test(ft)) return '6K';
  if (/^40-F/.test(ft)) return '40F';

  // Form ADV
  if (/^(ADV|MA-I|MA\/A|MA-A)/.test(ft)) return 'ADV';

  // Tender offers
  if (/^SC TO/.test(ft)) return 'SCTO';
  if (/^SC 13E/.test(ft)) return 'SC13E3';

  return 'OTHER';
}

/**
 * Extract raw text content (strip all XML/HTML tags) for fallback text matching.
 */
function extractRawText(rawContent) {
  // Remove SEC document wrapper tags
  let text = rawContent.replace(/<SEC-DOCUMENT>.*$/m, '');
  text = text.replace(/<SEC-HEADER>[\s\S]*?<\/SEC-HEADER>/, '');
  // Strip XML/HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ');
  return text;
}

module.exports = { parseHeader, normalizeFormType, extractField, extractRawText };
