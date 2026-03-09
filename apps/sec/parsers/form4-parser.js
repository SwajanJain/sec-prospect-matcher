/**
 * Form 4 Parser — Changes in Beneficial Ownership
 *
 * The single highest-value SEC filing for prospect research.
 * Contains structured XML with:
 *   - Owner identity (name, CIK, relationship)
 *   - Issuer/company info (name, CIK, ticker)
 *   - Transaction details (code, shares, price, date)
 *   - 10b5-1 plan indicator
 *   - Post-transaction holdings
 *   - Derivative table (options, RSUs)
 *
 * Transaction codes:
 *   S = Sale (liquidity event)
 *   P = Purchase (confidence signal)
 *   M = Option/warrant exercise (often paired with S for same-day sale)
 *   G = Gift of securities (philanthropy signal — strongest)
 *   A = Award/grant (future wealth pipeline)
 *   F = Tax withholding (vesting event indicator)
 *   C = Conversion of derivative
 *   D = Disposition to issuer
 *   J = Other acquisition/disposition
 */

const { extractTag, extractAllBlocks, extractNumber, extractBool, extractEmbeddedXml, decodeEntities } = require('./xml-utils');

const TRANSACTION_CODE_LABELS = {
  S: 'Sale (open market)',
  P: 'Purchase (open market)',
  M: 'Option/Warrant Exercise',
  G: 'Gift of Securities',
  A: 'Award/Grant',
  F: 'Tax Withholding',
  C: 'Conversion of Derivative',
  D: 'Disposition to Issuer',
  J: 'Other',
  I: 'Discretionary Transaction',
  W: 'Acquisition/Disposition by Will/Laws',
  Z: 'Deposit/Withdrawal from Voting Trust',
};

function parseForm4(rawContent, header) {
  const xml = extractEmbeddedXml(rawContent);
  if (!xml) {
    return { parseError: 'No embedded XML found in Form 4 filing', persons: [], transactions: [] };
  }

  const result = {
    formType: header.formType || '4',
    filedDate: header.filedDate,
    periodOfReport: extractTag(xml, 'periodOfReport') || header.periodOfReport,
    schemaVersion: extractTag(xml, 'schemaVersion'),

    // Issuer
    issuer: {
      cik: extractTag(xml, 'issuerCik'),
      name: decodeEntities(extractTag(xml, 'issuerName')),
      ticker: extractTag(xml, 'issuerTradingSymbol'),
    },

    // Reporting owners (can be multiple)
    owners: [],

    // 10b5-1 plan flag (added by 2023 SEC amendment)
    is10b5_1: extractBool(xml, 'aff10b5One'),

    // Transactions
    nonDerivativeTransactions: [],
    nonDerivativeHoldings: [],
    derivativeTransactions: [],
    derivativeHoldings: [],

    // Footnotes
    footnotes: [],

    // Computed fields
    persons: [],       // Names found in this filing (for matching)
    transactions: [],  // Flattened transaction summary
    alerts: [],        // Special signals detected
  };

  // Parse owners
  const ownerBlocks = extractAllBlocks(xml, 'reportingOwner');
  for (const ownerXml of ownerBlocks) {
    const owner = {
      cik: extractTag(ownerXml, 'rptOwnerCik'),
      name: decodeEntities(extractTag(ownerXml, 'rptOwnerName')),
      street1: extractTag(ownerXml, 'rptOwnerStreet1'),
      city: extractTag(ownerXml, 'rptOwnerCity'),
      state: extractTag(ownerXml, 'rptOwnerState'),
      zip: extractTag(ownerXml, 'rptOwnerZipCode'),
      isDirector: extractBool(ownerXml, 'isDirector'),
      isOfficer: extractBool(ownerXml, 'isOfficer'),
      isTenPercentOwner: extractBool(ownerXml, 'isTenPercentOwner'),
      isOther: extractBool(ownerXml, 'isOther'),
      officerTitle: decodeEntities(extractTag(ownerXml, 'officerTitle')),
      otherText: decodeEntities(extractTag(ownerXml, 'otherText')),
    };
    result.owners.push(owner);
    if (owner.name) {
      result.persons.push({
        name: owner.name,
        role: describeRole(owner),
        cik: owner.cik,
      });
    }
  }

  // Parse non-derivative transactions
  const ndtBlocks = extractAllBlocks(xml, 'nonDerivativeTransaction');
  for (const txXml of ndtBlocks) {
    const tx = parseTransaction(txXml);
    result.nonDerivativeTransactions.push(tx);
    result.transactions.push(tx);
  }

  // Parse non-derivative holdings (positions reported without transaction)
  const ndhBlocks = extractAllBlocks(xml, 'nonDerivativeHolding');
  for (const hXml of ndhBlocks) {
    result.nonDerivativeHoldings.push({
      securityTitle: extractTag(hXml, 'securityTitle'),
      sharesOwned: extractNumber(hXml, 'sharesOwnedFollowingTransaction'),
      ownershipType: extractTag(hXml, 'directOrIndirectOwnership'),
    });
  }

  // Parse derivative transactions
  const dtBlocks = extractAllBlocks(xml, 'derivativeTransaction');
  for (const txXml of dtBlocks) {
    const tx = parseDerivativeTransaction(txXml);
    result.derivativeTransactions.push(tx);
  }

  // Parse derivative holdings
  const dhBlocks = extractAllBlocks(xml, 'derivativeHolding');
  for (const hXml of dhBlocks) {
    result.derivativeHoldings.push({
      securityTitle: extractTag(hXml, 'securityTitle'),
      exercisePrice: extractNumber(hXml, 'conversionOrExercisePrice'),
      exerciseDate: extractTag(hXml, 'exerciseDate'),
      expirationDate: extractTag(hXml, 'expirationDate'),
      sharesUnderlyingDerivative: extractNumber(hXml, 'underlyingSecurity')
        ? extractNumber(hXml, 'sharesOwnedFollowingTransaction')
        : null,
      sharesOwned: extractNumber(hXml, 'sharesOwnedFollowingTransaction'),
      ownershipType: extractTag(hXml, 'directOrIndirectOwnership'),
    });
  }

  // Parse footnotes
  const fnBlocks = extractAllBlocks(xml, 'footnote');
  // Also try by regex since footnotes have id attributes
  const fnRegex = /<footnote\s+id="(F\d+)">([\s\S]*?)<\/footnote>/g;
  let fnMatch;
  while ((fnMatch = fnRegex.exec(xml)) !== null) {
    result.footnotes.push({
      id: fnMatch[1],
      text: decodeEntities(fnMatch[2].trim()),
    });
  }

  // Detect special signals
  detectAlerts(result);

  return result;
}

function parseTransaction(txXml) {
  const code = extractTag(txXml, 'transactionCode');
  const shares = extractNumber(txXml, 'transactionShares');
  const price = extractNumber(txXml, 'transactionPricePerShare');
  const acquiredDisposed = extractTag(txXml, 'transactionAcquiredDisposedCode');

  return {
    securityTitle: extractTag(txXml, 'securityTitle'),
    date: extractTag(txXml, 'transactionDate'),
    code,
    codeLabel: TRANSACTION_CODE_LABELS[code] || code,
    shares,
    pricePerShare: price,
    value: (shares && price) ? Math.round(shares * price * 100) / 100 : null,
    acquiredDisposed,  // A = acquired, D = disposed
    sharesAfter: extractNumber(txXml, 'sharesOwnedFollowingTransaction'),
    ownershipType: extractTag(txXml, 'directOrIndirectOwnership'),
  };
}

function parseDerivativeTransaction(txXml) {
  const code = extractTag(txXml, 'transactionCode');
  const shares = extractNumber(txXml, 'transactionShares');
  const price = extractNumber(txXml, 'transactionPricePerShare');

  return {
    securityTitle: extractTag(txXml, 'securityTitle'),
    exercisePrice: extractNumber(txXml, 'conversionOrExercisePrice'),
    date: extractTag(txXml, 'transactionDate'),
    code,
    codeLabel: TRANSACTION_CODE_LABELS[code] || code,
    shares,
    pricePerShare: price,
    value: (shares && price) ? Math.round(shares * price * 100) / 100 : null,
    acquiredDisposed: extractTag(txXml, 'transactionAcquiredDisposedCode'),
    exerciseDate: extractTag(txXml, 'exerciseDate'),
    expirationDate: extractTag(txXml, 'expirationDate'),
    underlyingSecurityTitle: extractTag(txXml, 'underlyingSecurityTitle'),
    underlyingShares: extractNumber(txXml, 'underlyingSecurityShares'),
    sharesAfter: extractNumber(txXml, 'sharesOwnedFollowingTransaction'),
    ownershipType: extractTag(txXml, 'directOrIndirectOwnership'),
  };
}

function describeRole(owner) {
  const parts = [];
  if (owner.isOfficer && owner.officerTitle) parts.push(owner.officerTitle);
  else if (owner.isOfficer) parts.push('Officer');
  if (owner.isDirector) parts.push('Director');
  if (owner.isTenPercentOwner) parts.push('10%+ Owner');
  if (owner.isOther && owner.otherText) parts.push(owner.otherText);
  return parts.join(', ') || 'Insider';
}

function detectAlerts(result) {
  const txCodes = result.transactions.map(t => t.code);
  const txDates = result.transactions.map(t => t.date);

  // Philanthropy signal: Code G (gift of securities)
  const giftTxs = result.transactions.filter(t => t.code === 'G');
  if (giftTxs.length > 0) {
    const totalGiftValue = giftTxs.reduce((sum, t) => sum + (t.value || 0), 0);
    result.alerts.push({
      type: 'PHILANTHROPY_SIGNAL',
      severity: 'HIGH',
      message: `Stock gift detected (Code G). ${giftTxs.length} gift transaction(s) totaling ${formatDollar(totalGiftValue)}.`,
    });
  }

  // Same-day sale: M + S on the same date
  const exerciseDates = result.transactions.filter(t => t.code === 'M').map(t => t.date);
  const saleDates = result.transactions.filter(t => t.code === 'S').map(t => t.date);
  const sameDaySaleDates = exerciseDates.filter(d => d && saleDates.includes(d));
  if (sameDaySaleDates.length > 0) {
    // Calculate net proceeds: sale value - exercise cost
    const saleValue = result.transactions
      .filter(t => t.code === 'S' && sameDaySaleDates.includes(t.date))
      .reduce((sum, t) => sum + (t.value || 0), 0);
    result.alerts.push({
      type: 'SAME_DAY_SALE',
      severity: 'HIGH',
      message: `Same-day option exercise + sale detected. Sale proceeds: ${formatDollar(saleValue)}.`,
    });
  }

  // Large sale
  const saleTxs = result.transactions.filter(t => t.code === 'S');
  const totalSaleValue = saleTxs.reduce((sum, t) => sum + (t.value || 0), 0);
  if (totalSaleValue > 100000) {
    result.alerts.push({
      type: 'LARGE_SALE',
      severity: totalSaleValue > 1000000 ? 'HIGH' : 'MEDIUM',
      message: `Stock sale totaling ${formatDollar(totalSaleValue)}.`,
    });
  }

  // 10b5-1 plan
  if (result.is10b5_1) {
    result.alerts.push({
      type: '10B5_1_PLAN',
      severity: 'INFO',
      message: 'Trade executed under a pre-planned 10b5-1 trading arrangement. May indicate recurring future sales.',
    });
  }

  // Large purchase (confidence signal)
  const purchaseTxs = result.transactions.filter(t => t.code === 'P');
  const totalPurchaseValue = purchaseTxs.reduce((sum, t) => sum + (t.value || 0), 0);
  if (totalPurchaseValue > 100000) {
    result.alerts.push({
      type: 'LARGE_PURCHASE',
      severity: 'MEDIUM',
      message: `Open market purchase totaling ${formatDollar(totalPurchaseValue)}. Confidence signal.`,
    });
  }
}

function formatDollar(amount) {
  if (amount == null || amount === 0) return '$0';
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

module.exports = { parseForm4, TRANSACTION_CODE_LABELS };
