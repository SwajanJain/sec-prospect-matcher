/**
 * Alma News filing classification helpers.
 *
 * Output label taxonomy (simple on purpose):
 * - wealth_event: liquidity/capacity/ownership/IPO/M&A signals
 * - career_influential_event: role/board/leadership and influence triggers
 * - other: context or low-signal filings for gift officers
 */

function normalizeFilingType(filingType) {
    return (filingType || '').toString().trim().toUpperCase();
}

function classifyFilingType(filingTypeRaw) {
    const filingType = normalizeFilingType(filingTypeRaw);

    // Tier: Wealth / liquidity / capacity signals
    if (
        filingType === '4' ||
        filingType === '4/A' ||
        filingType === '5' ||
        filingType === '5/A' ||
        filingType === '144' ||
        filingType === 'SC 13D' ||
        filingType === 'SCHEDULE 13D' ||
        filingType === 'SCHEDULE 13D/A' ||
        filingType === 'SC 13D/A' ||
        filingType === 'SC 13G' ||
        filingType === 'SC 13G/A' ||
        filingType === 'SCHEDULE 13G' ||
        filingType === 'SCHEDULE 13G/A' ||
        filingType === 'DEF 14A' ||
        filingType === 'DEFM14A' ||
        filingType === 'DEFA14A' ||
        filingType === 'PRE 14A' ||
        filingType === 'S-1' ||
        filingType === 'S-1/A' ||
        filingType === 'F-1' ||
        filingType === 'F-1/A' ||
        filingType === 'S-4' ||
        filingType === 'S-4/A' ||
        filingType === 'F-4' ||
        filingType === 'F-4/A' ||
        filingType.startsWith('424B') || // prospectus variants around offerings
        filingType === 'FWP'
    ) {
        return 'wealth_event';
    }

    // Tier: Career / influential relationship triggers
    if (
        filingType === '8-K' ||
        filingType === '8-K/A' ||
        filingType === '3' ||
        filingType === '3/A' ||
        filingType === 'D' ||
        filingType === 'D/A'
    ) {
        return 'career_influential_event';
    }

    // Everything else is mostly context / low signal for gift officers.
    return 'other';
}

module.exports = {
    classifyFilingType,
    normalizeFilingType
};

