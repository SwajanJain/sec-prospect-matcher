#!/usr/bin/env node
/**
 * Converts the debug CSV (44 fields) into a client-ready CSV (18 fields).
 *
 * Field design principles:
 *   - Every field earns its column by serving a distinct purpose
 *   - Numeric fields (Tier, Confidence, Value) stay separate for sorting/filtering
 *   - Merged fields combine ONLY non-redundant info
 *   - No field repeats what another field already says
 */

const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

const INPUT = '/Users/swajanjain/Documents/Projects/sec-prospect-matcher/matches/sec_matches_debug_2026-01-29T12-50-32.csv';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT = `/Users/swajanjain/Documents/Projects/sec-prospect-matcher/matches/sec_matches_client_${timestamp}.csv`;

// ---------------------------------------------------------------------------
// Transaction type extraction — turns verbose lot-by-lot detail into a
// clean summary like "Option exercise + sale (6 transactions)"
// ---------------------------------------------------------------------------
function summarizeTransaction(rawSummary, flags) {
  if (!rawSummary) return flags.length ? '[' + flags.join('] [') + ']' : '';

  const parts = rawSummary.split(' | ');

  // For single-part transactions that are already clean, keep as-is
  // (Form 144 "Intent to Sell..." or Form D "Private Offering...")
  if (parts.length === 1) {
    let result = rawSummary;
    if (flags.length) result += ' [' + flags.join('] [') + ']';
    return result;
  }

  // Extract transaction types from each part
  const typeMap = {
    'option/warrant exercise': 'Option exercise',
    'sale (open market)': 'Open market sale',
    'sale (10b5-1)': 'Sale (10b5-1)',
    'purchase (open market)': 'Open market purchase',
    'award/grant': 'Stock award',
    'gift/donation': 'Gift/donation',
    'conversion': 'Conversion',
    'acquisition': 'Acquisition',
    'disposition': 'Disposition',
  };

  const seenTypes = [];
  for (const part of parts) {
    const lower = part.toLowerCase().trim();
    let matched = false;
    for (const [pattern, label] of Object.entries(typeMap)) {
      if (lower.startsWith(pattern)) {
        if (!seenTypes.includes(label)) seenTypes.push(label);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Fallback: grab text before first digit
      const m = part.match(/^([A-Za-z/() -]+)/);
      const fallback = m ? m[1].trim() : part.slice(0, 30);
      if (!seenTypes.includes(fallback)) seenTypes.push(fallback);
    }
  }

  let result = seenTypes.join(' + ');
  if (parts.length > 2) result += ` (${parts.length} transactions)`;
  if (flags.length) result += ' [' + flags.join('] [') + ']';
  return result;
}

// ---------------------------------------------------------------------------
// Match Quality — one-line trust signal for ops triage
//   "Verified — Company confirmed"         → send to client
//   "Review Needed — No company on prospect" → ops checks manually
//   "Likely Wrong Person — ..."             → probably skip
//   "Unverified Mention"                    → name appeared, no proof
// ---------------------------------------------------------------------------
function buildMatchQuality(r) {
  if (r['Mention Only'] === 'true') {
    return 'Unverified Mention — Name appeared without corroboration';
  }
  if (r['Uncertain Match'] === 'true') {
    return 'Likely Wrong Person — ' + (r['Uncertain Reason'] || 'Uncertain name match');
  }
  if (r['Company Verified'] === 'true') {
    return 'Verified — Company confirmed in filing';
  }

  const verdict = r['Match Verdict'] || '';
  if (verdict === 'LIKELY_FALSE_POSITIVE') {
    const reason = !r['Prospect Company'] ? 'Common name, no company to verify' : 'Company mismatch';
    return 'Likely Wrong Person — ' + reason;
  }

  // NEEDS_REVIEW
  if (!r['Prospect Company'] || r['Prospect Company'].trim() === '') {
    return 'Review Needed — No company on prospect to verify';
  }
  return 'Review Needed — Company not confirmed in filing';
}

// ---------------------------------------------------------------------------
// Notes — extra context that isn't already in Transaction or Action.
// Pulls [INFO] alerts (educational institutions, officer counts, 10b5-1 details)
// and proxy NEO counts from [MEDIUM] alerts. Skips [HIGH] alerts that just
// repeat the transaction dollar amounts.
// ---------------------------------------------------------------------------
function buildNotes(r) {
  const alerts = r['Alerts'] || '';
  if (!alerts) return '';

  const items = alerts.split(' | ');
  const notes = [];

  for (const item of items) {
    const trimmed = item.trim();

    // Always include [INFO] items — they have unique context
    if (trimmed.startsWith('[INFO]')) {
      notes.push(trimmed.replace(/^\[INFO\]\s*/, ''));
      continue;
    }

    // Include [MEDIUM] proxy items that mention NEOs
    if (trimmed.startsWith('[MEDIUM]') && trimmed.includes('NEO(s)')) {
      notes.push(trimmed.replace(/^\[MEDIUM\]\s*/, ''));
      continue;
    }

    // Include [HIGH] items for 8-K departures/appointments (unique context)
    if (trimmed.startsWith('[HIGH]') && /depart|appoint|election/i.test(trimmed)) {
      // But only if there's a specific person mentioned beyond the prospect
      if (/Mentioned:/.test(trimmed)) {
        notes.push(trimmed.replace(/^\[HIGH\]\s*/, ''));
      }
      continue;
    }

    // Skip [HIGH] items that just repeat dollar amounts — redundant with Transaction + Value
  }

  return notes.join('. ').replace(/\.\./g, '.').replace(/\.\s*\./g, '.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const rows = [];

fs.createReadStream(INPUT)
  .pipe(csv())
  .on('data', row => rows.push(row))
  .on('end', async () => {
    console.log(`Read ${rows.length} rows from debug CSV`);

    const clientRows = rows.map(r => {
      // --- Signal: clean categorical label for scanning/filtering ---
      const signal = (r['Signal Category'] || '').replace(/^Tier \d:\s*/, '');

      // --- Transaction: summarized event + flag tags ---
      const flags = [];
      if (r['10b5-1 Plan'] === 'true') flags.push('10b5-1');
      if (r['Same-Day Sale'] === 'true') flags.push('Same-Day Sale');
      if (r['Philanthropy Signal'] === 'true') flags.push('Philanthropy');
      const transaction = summarizeTransaction(r['Transaction Summary'], flags);

      // --- Action: gift officer recommendation only (no signal label, no alerts) ---
      const action = r['Gift Officer Action'] || '';

      // --- Filed Date: YYYYMMDD → YYYY-MM-DD ---
      let filedDate = r['Filed Date'] || '';
      if (filedDate.length === 8) {
        filedDate = filedDate.slice(0, 4) + '-' + filedDate.slice(4, 6) + '-' + filedDate.slice(6, 8);
      }

      return {
        signal_tier: r['Signal Tier'],
        confidence: r['Confidence'],
        match_quality: buildMatchQuality(r),
        prospect_name: r['Prospect Name'],
        prospect_company: r['Prospect Company'] || '',
        team_name: r['Team Name'] || '',
        prospect_id: r['Prospect ID'],
        signal: signal,
        form_type: r['Form Type'],
        issuer_name: r['Issuer/Company'] || '',
        ticker: r['Ticker'] || '',
        filed_date: filedDate,
        filer_role: r['Filing Person Role'] || '',
        transaction: transaction,
        value: r['Total Value ($)'] || '',
        action: action,
        notes: buildNotes(r),
        accession_number: r['Accession Number'] || '',
      };
    });

    const writer = createObjectCsvWriter({
      path: OUTPUT,
      header: [
        { id: 'signal_tier', title: 'Signal Tier' },
        { id: 'confidence', title: 'Confidence' },
        { id: 'match_quality', title: 'Match Quality' },
        { id: 'prospect_name', title: 'Prospect Name' },
        { id: 'prospect_company', title: 'Prospect Company' },
        { id: 'team_name', title: 'Team Name' },
        { id: 'prospect_id', title: 'Prospect ID' },
        { id: 'signal', title: 'Signal' },
        { id: 'form_type', title: 'Form Type' },
        { id: 'issuer_name', title: 'Issuer/Company' },
        { id: 'ticker', title: 'Ticker' },
        { id: 'filed_date', title: 'Filed Date' },
        { id: 'filer_role', title: 'Filer Role' },
        { id: 'transaction', title: 'Transaction' },
        { id: 'value', title: 'Value ($)' },
        { id: 'action', title: 'Action' },
        { id: 'notes', title: 'Notes' },
        { id: 'accession_number', title: 'Accession Number' },
      ],
    });

    await writer.writeRecords(clientRows);
    console.log(`Client CSV (18 fields): ${OUTPUT}`);
  });
