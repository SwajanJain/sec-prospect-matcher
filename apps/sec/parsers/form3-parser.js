/**
 * Form 3/5 Parser — Initial & Annual Ownership Statements
 *
 * Form 3: Filed when someone becomes an insider (officer, director, 10%+ owner)
 *         Signal: Career milestone + new wealth position
 * Form 5: Annual summary of ownership changes not reported on Form 4
 *         Signal: Year-end cleanup, catches missed transactions
 *
 * Both use the same ownershipDocument XML schema as Form 4,
 * but typically have holdings only (no transactions for Form 3).
 */

const { extractTag, extractAllBlocks, extractNumber, extractBool, extractEmbeddedXml, decodeEntities } = require('./xml-utils');

function parseForm3(rawContent, header) {
  const xml = extractEmbeddedXml(rawContent);
  if (!xml) {
    return { parseError: 'No embedded XML found', persons: [], transactions: [] };
  }

  const isForm3 = (header.formType || '').startsWith('3');

  const result = {
    formType: header.formType,
    filedDate: header.filedDate,
    periodOfReport: extractTag(xml, 'periodOfReport') || header.periodOfReport,

    issuer: {
      cik: extractTag(xml, 'issuerCik'),
      name: decodeEntities(extractTag(xml, 'issuerName')),
      ticker: extractTag(xml, 'issuerTradingSymbol'),
    },

    owners: [],
    nonDerivativeHoldings: [],
    derivativeHoldings: [],
    nonDerivativeTransactions: [],  // Form 5 may have transactions
    derivativeTransactions: [],

    persons: [],
    transactions: [],
    alerts: [],
  };

  // Parse owners
  const ownerBlocks = extractAllBlocks(xml, 'reportingOwner');
  for (const ownerXml of ownerBlocks) {
    const owner = {
      cik: extractTag(ownerXml, 'rptOwnerCik'),
      name: decodeEntities(extractTag(ownerXml, 'rptOwnerName')),
      isDirector: extractBool(ownerXml, 'isDirector'),
      isOfficer: extractBool(ownerXml, 'isOfficer'),
      isTenPercentOwner: extractBool(ownerXml, 'isTenPercentOwner'),
      officerTitle: decodeEntities(extractTag(ownerXml, 'officerTitle')),
    };
    result.owners.push(owner);
    if (owner.name) {
      const roleParts = [];
      if (owner.isOfficer && owner.officerTitle) roleParts.push(owner.officerTitle);
      else if (owner.isOfficer) roleParts.push('Officer');
      if (owner.isDirector) roleParts.push('Director');
      if (owner.isTenPercentOwner) roleParts.push('10%+ Owner');

      result.persons.push({
        name: owner.name,
        role: roleParts.join(', ') || 'Insider',
        cik: owner.cik,
      });
    }
  }

  // Parse holdings
  const ndhBlocks = extractAllBlocks(xml, 'nonDerivativeHolding');
  for (const hXml of ndhBlocks) {
    result.nonDerivativeHoldings.push({
      securityTitle: extractTag(hXml, 'securityTitle'),
      sharesOwned: extractNumber(hXml, 'sharesOwnedFollowingTransaction'),
      ownershipType: extractTag(hXml, 'directOrIndirectOwnership'),
    });
  }

  const dhBlocks = extractAllBlocks(xml, 'derivativeHolding');
  for (const hXml of dhBlocks) {
    result.derivativeHoldings.push({
      securityTitle: extractTag(hXml, 'securityTitle'),
      exercisePrice: extractNumber(hXml, 'conversionOrExercisePrice'),
      expirationDate: extractTag(hXml, 'expirationDate'),
      sharesOwned: extractNumber(hXml, 'sharesOwnedFollowingTransaction'),
    });
  }

  // Form 5 may have transactions
  const ndtBlocks = extractAllBlocks(xml, 'nonDerivativeTransaction');
  for (const txXml of ndtBlocks) {
    const code = extractTag(txXml, 'transactionCode');
    const shares = extractNumber(txXml, 'transactionShares');
    const price = extractNumber(txXml, 'transactionPricePerShare');
    const tx = {
      securityTitle: extractTag(txXml, 'securityTitle'),
      date: extractTag(txXml, 'transactionDate'),
      code,
      shares,
      pricePerShare: price,
      value: (shares && price) ? Math.round(shares * price * 100) / 100 : null,
      acquiredDisposed: extractTag(txXml, 'transactionAcquiredDisposedCode'),
      sharesAfter: extractNumber(txXml, 'sharesOwnedFollowingTransaction'),
    };
    result.nonDerivativeTransactions.push(tx);
    result.transactions.push(tx);
  }

  // Alerts
  if (isForm3) {
    result.alerts.push({
      type: 'NEW_INSIDER',
      severity: 'MEDIUM',
      message: `New insider filing. ${result.persons.map(p => `${p.name} (${p.role})`).join('; ')} at ${result.issuer.name} (${result.issuer.ticker || 'N/A'}).`,
    });
  }

  return result;
}

module.exports = { parseForm3 };
