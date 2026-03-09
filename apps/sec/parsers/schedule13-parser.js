/**
 * Schedule 13D/G Parser — Beneficial Ownership > 5%
 *
 * 13D: Active/activist investor acquiring 5%+ stake
 * 13G: Passive investor with 5%+ stake
 *
 * Signal: Major concentrated wealth. Person/entity owns a large block of shares.
 * Amendments (/A) signal increasing or decreasing stakes.
 *
 * These are mostly HTML/text, but we can extract key info from the header
 * and body text.
 */

const { extractEmbeddedHtml, stripHtml, extractEmbeddedXml, extractTag, extractNumber, decodeEntities } = require('./xml-utils');

function parseSchedule13(rawContent, header) {
  const is13D = (header.formType || '').includes('13D');
  const isAmendment = (header.formType || '').includes('/A');

  const result = {
    formType: header.formType,
    filedDate: header.filedDate,
    periodOfReport: header.periodOfReport,
    is13D,
    isAmendment,

    subjectCompany: {
      name: header.filer?.name || header.issuer?.name || null,
      cik: header.filer?.cik || header.issuer?.cik || null,
    },

    reportingPerson: {
      name: header.reportingOwner?.name || null,
      cik: header.reportingOwner?.cik || null,
    },

    ownership: {
      percentOwned: null,
      sharesOwned: null,
      aggregateValue: null,
    },

    persons: [],
    transactions: [],
    alerts: [],
  };

  // Try to get reporting person from various header sections
  // In 13D/G filings, the "FILER" is often the reporting person (not the issuer)
  // and the "SUBJECT COMPANY" is the company whose stock they own
  const subjectSection = rawContent.match(/SUBJECT COMPANY:\s*([\s\S]*?)(?=FILED BY:|REPORTING-OWNER:|$)/);
  if (subjectSection) {
    const subjectName = subjectSection[1].match(/COMPANY CONFORMED NAME:\s*(.+)/);
    const subjectCik = subjectSection[1].match(/CENTRAL INDEX KEY:\s*(.+)/);
    if (subjectName) result.subjectCompany.name = subjectName[1].trim();
    if (subjectCik) result.subjectCompany.cik = subjectCik[1].trim();
  }

  const filedBySection = rawContent.match(/FILED BY:\s*([\s\S]*?)(?=SUBJECT COMPANY:|REPORTING-OWNER:|$)/);
  if (filedBySection) {
    const filerName = filedBySection[1].match(/COMPANY CONFORMED NAME:\s*(.+)/);
    const filerCik = filedBySection[1].match(/CENTRAL INDEX KEY:\s*(.+)/);
    if (filerName) result.reportingPerson.name = filerName[1].trim();
    if (filerCik) result.reportingPerson.cik = filerCik[1].trim();
  }

  // If no FILED BY, use FILER
  if (!result.reportingPerson.name && header.filer?.name) {
    result.reportingPerson.name = header.filer.name;
    result.reportingPerson.cik = header.filer.cik;
  }

  // Try to extract ownership percentage from body text
  const html = extractEmbeddedHtml(rawContent);
  if (html) {
    const text = stripHtml(html);
    // Look for ownership percentage
    const pctMatch = text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      if (pct >= 1 && pct <= 100) {
        result.ownership.percentOwned = pct;
      }
    }

    // Look for aggregate shares
    const sharesMatch = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*shares/i);
    if (sharesMatch) {
      result.ownership.sharesOwned = parseInt(sharesMatch[1].replace(/,/g, ''));
    }
  }

  // Build persons list
  if (result.reportingPerson.name) {
    result.persons.push({
      name: result.reportingPerson.name,
      role: is13D ? '5%+ Active Investor' : '5%+ Passive Investor',
      cik: result.reportingPerson.cik,
    });
  }

  // Synthetic transaction
  result.transactions.push({
    code: is13D ? 'SC13D' : 'SC13G',
    codeLabel: is13D ? 'Schedule 13D (Active 5%+ Ownership)' : 'Schedule 13G (Passive 5%+ Ownership)',
    percentOwned: result.ownership.percentOwned,
    shares: result.ownership.sharesOwned,
    value: result.ownership.aggregateValue,
    date: result.filedDate,
  });

  // Alerts
  const ownerInfo = result.ownership.percentOwned ? `${result.ownership.percentOwned}% ownership` : '5%+ ownership';
  result.alerts.push({
    type: is13D ? 'ACTIVIST_OWNERSHIP' : 'LARGE_PASSIVE_OWNERSHIP',
    severity: 'HIGH',
    message: `${result.reportingPerson.name || 'Unknown'} holds ${ownerInfo} in ${result.subjectCompany.name || 'unknown company'}${isAmendment ? ' (amended filing)' : ''}.`,
  });

  return result;
}

module.exports = { parseSchedule13 };
