/**
 * Form 13F Parser — Institutional Holdings
 *
 * WARNING: "Red Herring" — 13F reports AUM (Assets Under Management),
 * NOT personal wealth. If an alumnus manages a $2B fund, the $2B belongs
 * to clients, not the manager.
 *
 * Use to:
 *   - Tag alumni as "Investment Professional" / "Fund Manager"
 *   - Estimate personal wealth from management fees (~2% of AUM)
 *     and carried interest (~20% of profits)
 *   - NEVER include 13F values in personal wealth summations
 *
 * 13F-HR has an XML information table in newer filings.
 */

const { extractEmbeddedXml, extractTag, extractNumber, extractAllBlocks, decodeEntities } = require('./xml-utils');

function parseForm13F(rawContent, header) {
  const result = {
    formType: header.formType,
    filedDate: header.filedDate,
    periodOfReport: header.periodOfReport,

    filer: {
      name: header.filer?.name || null,
      cik: header.filer?.cik || null,
    },

    // Key: this is AUM, NOT personal wealth
    aum: {
      totalValue: null,           // Total value of all holdings
      holdingsCount: null,        // Number of distinct holdings
      isAmendment: (header.formType || '').includes('/A'),
    },

    // Top holdings (by value)
    topHoldings: [],

    persons: [],
    transactions: [],
    alerts: [],

    // Important flag
    _warning: 'AUM_NOT_PERSONAL_WEALTH',
  };

  // Try to extract the information table XML
  // 13F-HR has primary doc + information table as separate documents
  const xmlSections = rawContent.match(/<XML>([\s\S]*?)<\/XML>/g);
  if (xmlSections) {
    for (const section of xmlSections) {
      const xml = section.replace(/<\/?XML>/g, '');

      // Check if this is the cover page
      const formType = extractTag(xml, 'formType');
      if (formType === '13F-HR') {
        // Cover page
        const otherManagerCount = extractNumber(xml, 'form13FFileNumber');
        // Try to get the total value from the summary
        result.aum.totalValue = extractNumber(xml, 'tableEntryTotal');
        result.aum.holdingsCount = extractNumber(xml, 'tableValueTotal');
      }

      // Check if this is the information table
      const infoTableEntries = extractAllBlocks(xml, 'infoTable');
      if (infoTableEntries.length > 0) {
        let totalValue = 0;
        const holdings = [];

        for (const entry of infoTableEntries) {
          const nameOfIssuer = decodeEntities(extractTag(entry, 'nameOfIssuer'));
          const titleOfClass = extractTag(entry, 'titleOfClass');
          const value = extractNumber(entry, 'value'); // in thousands
          const shares = extractNumber(entry, 'sshPrnamt');

          if (value) totalValue += value;

          holdings.push({
            issuer: nameOfIssuer,
            titleOfClass,
            valueThousands: value,
            shares,
          });
        }

        // Sort by value descending, take top 10
        holdings.sort((a, b) => (b.valueThousands || 0) - (a.valueThousands || 0));
        result.topHoldings = holdings.slice(0, 10);
        result.aum.totalValue = totalValue * 1000; // Convert from thousands
        result.aum.holdingsCount = holdings.length;
      }
    }
  }

  // Build persons list (filer = the fund manager)
  if (result.filer.name) {
    result.persons.push({
      name: result.filer.name,
      role: 'Institutional Investment Manager',
      cik: result.filer.cik,
    });
  }

  // Synthetic transaction
  if (result.aum.totalValue) {
    result.transactions.push({
      code: '13F',
      codeLabel: 'Institutional Holdings Report (AUM — NOT personal wealth)',
      value: result.aum.totalValue,
      date: result.periodOfReport || result.filedDate,
      _warning: 'This is AUM, not personal wealth.',
    });
  }

  // Alerts
  if (result.aum.totalValue) {
    const aumFormatted = formatLargeNumber(result.aum.totalValue);
    const estFees = formatLargeNumber(result.aum.totalValue * 0.02);
    result.alerts.push({
      type: 'FUND_MANAGER',
      severity: 'INFO',
      message: `Institutional manager with ${aumFormatted} AUM (${result.aum.holdingsCount || '?'} holdings). ⚠️ AUM ≠ personal wealth. Est. management fees: ~${estFees}/yr.`,
    });
  } else {
    result.alerts.push({
      type: 'FUND_MANAGER',
      severity: 'INFO',
      message: `Institutional investment manager filing (13F). Tag as "Investment Professional".`,
    });
  }

  return result;
}

function formatLargeNumber(num) {
  if (!num) return '$0';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
}

module.exports = { parseForm13F };
