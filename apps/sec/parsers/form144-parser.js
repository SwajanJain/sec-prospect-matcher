/**
 * Form 144 Parser — Notice of Proposed Sale of Restricted Securities
 *
 * PREDICTIVE signal: This tells you someone is ABOUT TO sell stock.
 * Filed before the actual sale happens (24-48 hour advance warning).
 *
 * Key fields:
 *   - approximateDateOfSale: When the sale will happen
 *   - aggregateMarketValue: How much they plan to sell
 *   - nameOfBroker: Executing broker
 *
 * Some Form 144s are XML, some are older plaintext/HTML. Handle both.
 */

const { extractTag, extractNumber, extractEmbeddedXml, decodeEntities, extractEmbeddedHtml, stripHtml } = require('./xml-utils');

function parseForm144(rawContent, header) {
  const result = {
    formType: '144',
    filedDate: header.filedDate,
    periodOfReport: header.periodOfReport,

    issuer: {
      name: header.issuer?.name || header.filer?.name || null,
      cik: header.issuer?.cik || header.filer?.cik || null,
      ticker: null,
    },

    reportingPerson: {
      name: header.reportingOwner?.name || null,
      cik: header.reportingOwner?.cik || null,
    },

    saleDetails: {
      approximateDateOfSale: null,
      aggregateMarketValue: null,
      numberOfShares: null,
      nameOfBroker: null,
    },

    persons: [],
    transactions: [],
    alerts: [],
  };

  // Try XML parsing first
  const xml = extractEmbeddedXml(rawContent);
  if (xml) {
    result.reportingPerson.name = decodeEntities(extractTag(xml, 'entityName') || extractTag(xml, 'nameOfReportingPerson')) || result.reportingPerson.name;
    result.issuer.name = decodeEntities(extractTag(xml, 'issuerName') || extractTag(xml, 'nameOfIssuer')) || result.issuer.name;
    result.issuer.cik = extractTag(xml, 'issuerCik') || result.issuer.cik;
    result.issuer.ticker = extractTag(xml, 'issuerTradingSymbol') || extractTag(xml, 'tickerSymbol');

    result.saleDetails.approximateDateOfSale = extractTag(xml, 'approximateDateOfSale');
    result.saleDetails.aggregateMarketValue = extractNumber(xml, 'aggregateMarketValue');
    result.saleDetails.numberOfShares = extractNumber(xml, 'amountOfSecurities') || extractNumber(xml, 'numberOfShares');
    result.saleDetails.nameOfBroker = decodeEntities(extractTag(xml, 'nameOfBroker'));
  }

  // Fallback: try text/HTML parsing
  if (!result.reportingPerson.name) {
    const html = extractEmbeddedHtml(rawContent);
    if (html) {
      const text = stripHtml(html);
      // Try common patterns in Form 144 text
      const nameMatch = text.match(/Name of Person[^:]*:\s*([A-Z][A-Za-z\s,.'-]+)/);
      if (nameMatch) result.reportingPerson.name = nameMatch[1].trim();

      const issuerMatch = text.match(/Name of Issuer[^:]*:\s*([A-Z][A-Za-z\s,.'-]+)/);
      if (issuerMatch) result.issuer.name = issuerMatch[1].trim();

      const dateMatch = text.match(/Approximate Date of Sale[^:]*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/);
      if (dateMatch) result.saleDetails.approximateDateOfSale = dateMatch[1];

      const valueMatch = text.match(/Aggregate Market Value[^:]*:\s*\$?([\d,]+\.?\d*)/);
      if (valueMatch) result.saleDetails.aggregateMarketValue = parseFloat(valueMatch[1].replace(/,/g, ''));
    }
  }

  // Use header owner as fallback
  if (!result.reportingPerson.name && header.reportingOwner) {
    result.reportingPerson.name = header.reportingOwner.name;
    result.reportingPerson.cik = header.reportingOwner.cik;
  }

  // Build persons list
  if (result.reportingPerson.name) {
    result.persons.push({
      name: result.reportingPerson.name,
      role: 'Restricted Securities Holder',
      cik: result.reportingPerson.cik,
    });
  }

  // Create a synthetic transaction for uniform handling
  if (result.saleDetails.aggregateMarketValue || result.saleDetails.numberOfShares) {
    result.transactions.push({
      code: '144_NOTICE',
      codeLabel: 'Intent to Sell (Form 144)',
      date: result.saleDetails.approximateDateOfSale,
      shares: result.saleDetails.numberOfShares,
      value: result.saleDetails.aggregateMarketValue,
      broker: result.saleDetails.nameOfBroker,
    });
  }

  // Alerts
  if (result.saleDetails.aggregateMarketValue) {
    const value = result.saleDetails.aggregateMarketValue;
    result.alerts.push({
      type: 'UPCOMING_SALE',
      severity: value > 1000000 ? 'HIGH' : 'MEDIUM',
      message: `Intent to sell ~$${value.toLocaleString()} in restricted securities${result.saleDetails.approximateDateOfSale ? ` around ${result.saleDetails.approximateDateOfSale}` : ''}.`,
    });
  } else {
    result.alerts.push({
      type: 'UPCOMING_SALE',
      severity: 'MEDIUM',
      message: 'Notice of proposed sale of restricted securities filed.',
    });
  }

  return result;
}

module.exports = { parseForm144 };
