/**
 * Signal Classifier
 *
 * Classifies every SEC filing match into:
 *   1. Signal Tier (1 = push alert, 2 = profile enrichment, 3 = relationship trigger)
 *   2. Fundraising Dimension (Liquidity / Capacity / Propensity)
 *   3. Gift Officer Action (what should the gift officer do)
 *
 * Based on the frameworks from Deep Research Reports 1 & 2.
 */

const { normalizeFormType } = require('./parsers/header-parser');

/**
 * Classify a parsed filing into signal tiers and dimensions.
 *
 * @param {object} parsedFiling - Output from parseFiling()
 * @returns {object} Classification result
 */
function classifySignal(parsedFiling) {
  const formType = parsedFiling.normalizedType;
  const transactions = parsedFiling.transactions || [];
  const alerts = parsedFiling.alerts || [];

  const classification = {
    tier: 3,                    // Default: Tier 3
    tierLabel: 'Tier 3: Network/Engagement Signal',
    dimensions: [],             // liquidity, capacity, propensity
    giftOfficerAction: '',
    urgency: 'LOW',             // LOW, MEDIUM, HIGH
    summary: '',
  };

  // --- TIER 1: Liquidity Triggers (Real-Time Push Notifications) ---
  // "Can they write a check today?"

  if (formType === 'FORM4') {
    const codes = transactions.map(t => t.code);

    // Code S = Sale = Cash in hand
    if (codes.includes('S')) {
      classification.tier = 1;
      classification.tierLabel = 'Tier 1: Liquidity Event';
      classification.dimensions.push('liquidity');
      classification.urgency = 'HIGH';
      classification.giftOfficerAction = 'Call now. Prospect just received cash from stock sale.';
    }

    // Code G = Gift = Philanthropy signal (STRONGEST)
    if (codes.includes('G')) {
      classification.tier = 1;
      classification.tierLabel = 'Tier 1: Philanthropy Signal';
      classification.dimensions.push('propensity');
      classification.urgency = 'HIGH';
      classification.giftOfficerAction = 'Highest priority. Prospect just gifted stock — active philanthropic intent.';
    }

    // Code M = Exercise (often paired with S)
    if (codes.includes('M') && !codes.includes('S')) {
      classification.tier = 2;
      classification.tierLabel = 'Tier 2: Wealth Event';
      classification.dimensions.push('capacity');
      classification.urgency = 'MEDIUM';
      classification.giftOfficerAction = 'Option exercise detected. Watch for follow-up sale (Form 4 Code S).';
    }

    // Code P = Purchase
    if (codes.includes('P')) {
      classification.tier = 2;
      classification.tierLabel = 'Tier 2: Confidence Signal';
      classification.dimensions.push('capacity');
      classification.urgency = 'MEDIUM';
      classification.giftOfficerAction = 'Open market purchase — prospect has capital and is investing more.';
    }

    // Code A = Award/Grant
    if (codes.includes('A') && !codes.includes('S') && !codes.includes('G')) {
      classification.tier = 2;
      classification.tierLabel = 'Tier 2: Future Wealth Pipeline';
      classification.dimensions.push('capacity');
      classification.urgency = 'LOW';
      classification.giftOfficerAction = 'New equity grant. Future wealth pipeline — note for long-term cultivation.';
    }

    // Code F = Tax withholding (vesting event)
    if (codes.includes('F') && codes.length === 1) {
      classification.tier = 2;
      classification.tierLabel = 'Tier 2: Vesting Event';
      classification.dimensions.push('capacity');
      classification.urgency = 'LOW';
      classification.giftOfficerAction = 'RSU vesting occurred. Shares withheld for taxes.';
    }

    // M+S same-day = pure liquidity
    if (codes.includes('M') && codes.includes('S')) {
      classification.tier = 1;
      classification.tierLabel = 'Tier 1: Same-Day Sale';
      classification.dimensions.push('liquidity');
      classification.urgency = 'HIGH';
      classification.giftOfficerAction = 'Same-day option exercise + sale. Pure cash event. Call now.';
    }
  }

  else if (formType === 'FORM144') {
    classification.tier = 1;
    classification.tierLabel = 'Tier 1: Upcoming Liquidity';
    classification.dimensions.push('liquidity');
    classification.urgency = 'HIGH';
    classification.giftOfficerAction = 'Prospect is about to sell stock. Schedule outreach for when sale completes.';
  }

  // --- TIER 2: Capacity Indicators (Profile Enrichment) ---
  // "What's their ceiling for a gift?"

  else if (formType === 'FORM3') {
    classification.tier = 2;
    classification.tierLabel = 'Tier 2: New Insider Appointment';
    classification.dimensions.push('capacity');
    classification.urgency = 'MEDIUM';
    classification.giftOfficerAction = 'Congratulatory outreach. New insider role = career milestone + wealth signal.';
  }

  else if (formType === 'FORM5') {
    classification.tier = 2;
    classification.tierLabel = 'Tier 2: Annual Ownership Update';
    classification.dimensions.push('capacity');
    classification.urgency = 'LOW';
    classification.giftOfficerAction = 'Year-end ownership update. Review for unreported transactions.';
  }

  else if (formType === 'DEF14A' || formType === 'DEFA14A' || formType === 'DEFC14A' || formType === 'DEFM14A' || formType === 'PRE14A' || formType === 'PREM14A') {
    classification.tier = 2;
    classification.tierLabel = 'Tier 2: Compensation & Wealth Baseline';
    classification.dimensions.push('capacity');
    classification.urgency = 'LOW';
    classification.giftOfficerAction = 'Update estimated net worth from compensation disclosure. Check "All Other Comp" for UHNW lifestyle indicators.';
  }

  else if (formType === 'SC13D' || formType === 'SC13G') {
    classification.tier = 2;
    classification.tierLabel = 'Tier 2: Large Ownership Position';
    classification.dimensions.push('capacity');
    classification.urgency = 'MEDIUM';
    classification.giftOfficerAction = '5%+ ownership stake = major concentrated wealth.';
  }

  else if (formType === '13FHR' || formType === '13FNT') {
    classification.tier = 2;
    classification.tierLabel = 'Tier 2: Fund Manager (AUM)';
    classification.dimensions.push('capacity');
    classification.urgency = 'LOW';
    classification.giftOfficerAction = 'Tag as "Investment Professional." AUM ≠ personal wealth. Estimate from management fees (~2% of AUM).';
  }

  // --- TIER 3: Network / Engagement Signals ---
  // "What's a good reason to reach out?"

  else if (formType === '8K') {
    const isPersonnel = (parsedFiling.isPersonnelEvent === true);
    const isMA = (parsedFiling.isMAEvent === true);

    if (isPersonnel) {
      classification.tier = 1;
      classification.tierLabel = 'Tier 1: Executive Departure/Appointment';
      classification.dimensions.push('liquidity', 'capacity');
      classification.urgency = 'HIGH';
      classification.giftOfficerAction = 'Departure = hidden liquidity (severance, accelerated vesting). Appointment = congratulations + cultivation.';
    } else if (isMA) {
      classification.tier = 1;
      classification.tierLabel = 'Tier 1: M&A Event';
      classification.dimensions.push('liquidity');
      classification.urgency = 'HIGH';
      classification.giftOfficerAction = 'M&A event may trigger cashout for insiders. Monitor for follow-up Form 4 sales.';
    } else {
      classification.tier = 3;
      classification.tierLabel = 'Tier 3: Corporate Event';
      classification.urgency = 'LOW';
      classification.giftOfficerAction = 'Engagement trigger. Use as conversation starter.';
    }
  }

  else if (formType === 'FORMD') {
    classification.tier = 3;
    classification.tierLabel = 'Tier 3: Private Fundraising';
    classification.dimensions.push('capacity');
    classification.urgency = 'LOW';
    classification.giftOfficerAction = 'Company raised private funding. Officers are accredited investors. Wealth trajectory signal.';
  }

  else if (formType === 'S1' || formType === 'F1') {
    classification.tier = 1;
    classification.tierLabel = 'Tier 1: IPO Filing';
    classification.dimensions.push('liquidity');
    classification.urgency = 'HIGH';
    classification.giftOfficerAction = 'IPO filing. Paper wealth may soon become liquid. Monitor for lockup expiration.';
  }

  else if (formType === 'S4') {
    classification.tier = 2;
    classification.tierLabel = 'Tier 2: Merger Registration';
    classification.dimensions.push('liquidity');
    classification.urgency = 'MEDIUM';
    classification.giftOfficerAction = 'Merger/acquisition registration. Prospect may receive payout.';
  }

  else if (formType === 'SCTO' || formType === 'SC13E3') {
    classification.tier = 1;
    classification.tierLabel = 'Tier 1: Tender Offer / Going Private';
    classification.dimensions.push('liquidity');
    classification.urgency = 'HIGH';
    classification.giftOfficerAction = 'Buyout event. Shareholders may receive premium cash payout.';
  }

  // Default for any other type
  else {
    classification.tier = 3;
    classification.tierLabel = 'Tier 3: Other Filing';
    classification.urgency = 'LOW';
    classification.giftOfficerAction = 'Informational. Review for context.';
  }

  // Ensure dimensions isn't empty
  if (classification.dimensions.length === 0) {
    classification.dimensions.push('context');
  }

  // Build summary
  classification.summary = buildSummary(parsedFiling, classification);

  return classification;
}

/**
 * Build a human-readable summary for gift officers.
 */
function buildSummary(parsed, classification) {
  const parts = [];
  const formLabel = parsed.formType || parsed.normalizedType;
  const company = parsed.issuer?.name || parsed.filer?.name || parsed.subjectCompany?.name || 'Unknown company';

  parts.push(`[${formLabel}]`);
  parts.push(company);

  // Add transaction details for ownership forms
  if (parsed.transactions && parsed.transactions.length > 0) {
    for (const tx of parsed.transactions) {
      if (tx.code && tx.value) {
        parts.push(`${tx.codeLabel || tx.code}: $${tx.value.toLocaleString()}`);
      } else if (tx.code && tx.shares) {
        parts.push(`${tx.codeLabel || tx.code}: ${tx.shares.toLocaleString()} shares`);
      }
    }
  }

  // Add alerts summary
  if (parsed.alerts && parsed.alerts.length > 0) {
    const highAlerts = parsed.alerts.filter(a => a.severity === 'HIGH');
    if (highAlerts.length > 0) {
      parts.push(highAlerts[0].message);
    }
  }

  return parts.join(' | ');
}

module.exports = { classifySignal };
