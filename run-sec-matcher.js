#!/usr/bin/env node

/**
 * SEC Filing Matcher — Entry Point
 *
 * Runs the intelligent filing-aware matcher against:
 *   - Phillips Academy prospect list (17,152 prospects)
 *   - SEC Filings folder (6,719 filings)
 *
 * Outputs a CSV with enriched matches sorted by signal tier.
 */

const UnifiedMatcher = require('./UnifiedMatcher');
const path = require('path');
const fs = require('fs');

// --- Configuration ---
const PROSPECTS_CSV = '/Users/swajanjain/Downloads/Prospect Data.csv';
const SEC_FILINGS_FOLDER = '/Users/swajanjain/Downloads/Matched SEC Filings';
const OUTPUT_FOLDER = path.join(__dirname, 'matches');
// Set to a number to process only first N filings (for testing), or null for all
const MAX_FILES = process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : null;

function makeProgressBar(current, total, width) {
  const ratio = current / total;
  const filled = Math.round(width * ratio);
  const empty = width - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

async function main() {
  console.log('UNIFIED MATCHER — Structured Parsing + Adaptive Validation');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Prospects CSV:     ${PROSPECTS_CSV}`);
  console.log(`SEC Filings:       ${SEC_FILINGS_FOLDER}`);
  console.log(`Output folder:     ${OUTPUT_FOLDER}`);
  if (MAX_FILES) console.log(`Max files:         ${MAX_FILES} (testing mode)`);
  console.log('');

  // Validate inputs
  if (!fs.existsSync(PROSPECTS_CSV)) {
    console.error(`Error: Prospects CSV not found: ${PROSPECTS_CSV}`);
    process.exit(1);
  }
  if (!fs.existsSync(SEC_FILINGS_FOLDER)) {
    console.error(`Error: SEC Filings folder not found: ${SEC_FILINGS_FOLDER}`);
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });

  const matcher = new UnifiedMatcher();

  // Step 1: Load prospects
  console.log('Loading prospects...');
  const count = await matcher.loadProspects(PROSPECTS_CSV);
  console.log(`Loaded ${count} prospects.`);
  console.log('');

  // Show sample
  console.log('Sample prospects:');
  matcher.prospects.slice(0, 5).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name}${p.company ? ` (${p.company})` : ''}`);
  });
  console.log('');

  // Step 2: Process filings
  const startTime = Date.now();
  console.log('Processing filings...\n');

  const results = await matcher.processFilings(SEC_FILINGS_FOLDER, {
    maxFiles: MAX_FILES,
    progressCallback: (progress) => {
      const pct = ((progress.current / progress.total) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const bar = makeProgressBar(progress.current, progress.total, 30);
      process.stderr.write(`\r  ${bar} ${progress.current}/${progress.total} (${pct}%) | ${progress.matches} matches | ${elapsed}s  `);
    },
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stderr.write('\n');
  console.log(`\nCompleted in ${duration} seconds.`);

  // Step 3: Print stats
  matcher.printStats();

  // Step 4: Export to CSV
  if (results.length > 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const debugPath = path.join(OUTPUT_FOLDER, `sec_matches_debug_${timestamp}.csv`);
    const clientPath = path.join(OUTPUT_FOLDER, `sec_matches_client_${timestamp}.csv`);

    console.log(`\nExporting ${results.length} results to CSV...`);
    await matcher.exportToCsv(debugPath);
    console.log(`Debug CSV (44 fields):  ${debugPath}`);
    await matcher.exportClientCsv(clientPath);
    console.log(`Client CSV (16 fields): ${clientPath}`);

    // Show top 10 Tier 1 results
    const tier1 = results.filter(r => r.signal_tier === 1).sort((a, b) => (b.total_value || 0) - (a.total_value || 0));
    if (tier1.length > 0) {
      console.log(`\nTop Tier 1 matches (highest priority):`);
      console.log('-'.repeat(80));
      tier1.slice(0, 10).forEach((r, i) => {
        const conf = r.match_confidence != null ? `${r.match_confidence}%` : 'N/A';
        const verified = r.company_verified ? 'verified' : 'unverified';
        console.log(`  ${i + 1}. ${r.prospect_name} | ${r.form_type} | ${r.issuer_name || 'N/A'} (${r.issuer_ticker || 'N/A'})`);
        console.log(`     ${r.signal_tier_label} | ${r.transaction_summary || 'N/A'}`);
        console.log(`     Confidence: ${conf} | Company: ${verified} | Method: ${r.match_method}`);
        if (r.total_value) console.log(`     Value: $${r.total_value.toLocaleString()}`);
        console.log(`     Action: ${r.gift_officer_action}`);
        console.log('');
      });
    }
  } else {
    console.log('\nNo matches found.');
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
