/**
 * Form D Parser — Regulation D Private Offering Notice
 *
 * Signals:
 *   - Company just raised private funding (wealth trajectory)
 *   - Officers listed are deemed accredited investors (implicit wealth confirmation)
 *   - Offering amount shows scale of fundraising
 *
 * Form D has XML structure for newer filings.
 */

const { extractTag, extractAllBlocks, extractNumber, extractEmbeddedXml, decodeEntities, extractEmbeddedHtml, stripHtml } = require('./xml-utils');

function parseFormD(rawContent, header) {
  const result = {
    formType: header.formType,
    filedDate: header.filedDate,

    issuer: {
      name: null,
      cik: header.filer?.cik || null,
      stateOfIncorporation: null,
      yearOfIncorporation: null,
      entityType: null,
    },

    offering: {
      industryGroup: null,
      investmentFundType: null,
      revenueRange: null,
      federalExemptions: [],
      isAmendment: (header.formType || '').includes('/A'),
      dateOfFirstSale: null,
      totalOfferingAmount: null,
      totalAmountSold: null,
      totalRemaining: null,
      hasNonAccreditedInvestors: false,
      numberOfInvestors: null,
    },

    // Officers/directors listed on Form D (accredited investors)
    relatedPersons: [],

    persons: [],
    transactions: [],
    alerts: [],
  };

  const xml = extractEmbeddedXml(rawContent);
  if (xml) {
    // Issuer
    result.issuer.name = decodeEntities(extractTag(xml, 'entityName')) || header.filer?.name;
    result.issuer.stateOfIncorporation = extractTag(xml, 'stateOrCountryOfIncorporation');
    result.issuer.yearOfIncorporation = extractTag(xml, 'yearOfIncorporation');
    result.issuer.entityType = extractTag(xml, 'entityType');

    // Offering details
    result.offering.industryGroup = extractTag(xml, 'industryGroupType');
    result.offering.investmentFundType = extractTag(xml, 'investmentFundType');
    result.offering.revenueRange = extractTag(xml, 'revenueRange');
    result.offering.dateOfFirstSale = extractTag(xml, 'dateOfFirstSale');
    result.offering.totalOfferingAmount = extractNumber(xml, 'totalOfferingAmount');
    result.offering.totalAmountSold = extractNumber(xml, 'totalAmountSold');
    result.offering.totalRemaining = extractNumber(xml, 'totalRemaining');

    // Federal exemptions
    const exemptionBlocks = extractAllBlocks(xml, 'federalExemption');
    // Also try extracting from exemptionsExclusions block
    const exemptionSection = xml.match(/<federalExemptionsExclusions>([\s\S]*?)<\/federalExemptionsExclusions>/);
    if (exemptionSection) {
      const items = exemptionSection[1].match(/<item>([\s\S]*?)<\/item>/g);
      if (items) {
        result.offering.federalExemptions = items.map(i => i.replace(/<\/?item>/g, '').trim());
      }
    }

    // Related persons (officers, directors, promoters)
    const personBlocks = extractAllBlocks(xml, 'relatedPersonInfo');
    for (const pXml of personBlocks) {
      const nameBlock = pXml.match(/<relatedPersonName>([\s\S]*?)<\/relatedPersonName>/);
      let firstName = '', lastName = '';
      if (nameBlock) {
        firstName = extractTag(nameBlock[1], 'firstName') || '';
        lastName = extractTag(nameBlock[1], 'lastName') || '';
      }
      const fullName = `${firstName} ${lastName}`.trim();

      const relationships = [];
      if (pXml.includes('<relatedPersonRelationshipList>')) {
        const relBlock = pXml.match(/<relatedPersonRelationshipList>([\s\S]*?)<\/relatedPersonRelationshipList>/);
        if (relBlock) {
          if (/executive/i.test(relBlock[1])) relationships.push('Executive Officer');
          if (/director/i.test(relBlock[1])) relationships.push('Director');
          if (/promoter/i.test(relBlock[1])) relationships.push('Promoter');
        }
      }

      if (fullName) {
        result.relatedPersons.push({
          name: fullName,
          relationships,
          city: extractTag(pXml, 'city'),
          state: extractTag(pXml, 'stateOrCountry'),
        });
        result.persons.push({
          name: fullName,
          role: relationships.join(', ') || 'Related Person',
          cik: null,
        });
      }
    }
  } else {
    // Fallback to header data
    result.issuer.name = header.filer?.name;
  }

  // Synthetic transaction for uniform handling
  if (result.offering.totalOfferingAmount || result.offering.totalAmountSold) {
    result.transactions.push({
      code: 'FORM_D',
      codeLabel: 'Private Offering (Reg D)',
      value: result.offering.totalOfferingAmount || result.offering.totalAmountSold,
      date: result.offering.dateOfFirstSale || result.filedDate,
    });
  }

  // Alerts
  const amount = result.offering.totalOfferingAmount || result.offering.totalAmountSold;
  if (amount) {
    result.alerts.push({
      type: 'PRIVATE_FUNDRAISING',
      severity: amount > 10000000 ? 'HIGH' : 'MEDIUM',
      message: `Private offering: $${amount.toLocaleString()} raised by ${result.issuer.name || 'Unknown issuer'}.`,
    });
  }

  if (result.relatedPersons.length > 0) {
    result.alerts.push({
      type: 'ACCREDITED_INVESTORS',
      severity: 'INFO',
      message: `${result.relatedPersons.length} officer(s)/director(s) listed (deemed accredited investors).`,
    });
  }

  return result;
}

module.exports = { parseFormD };
