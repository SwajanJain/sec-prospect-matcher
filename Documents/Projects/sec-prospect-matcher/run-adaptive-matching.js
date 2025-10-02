#!/usr/bin/env node

/**
 * Run Adaptive Matching from terminal
 */

const AdaptiveMatcher = require('./AdaptiveMatcher');
const path = require('path');
const fs = require('fs');

const prospectsCSV = '/Users/swajanjain/Downloads/SEC-CMU - Sheet6.csv';
const secFilingsFolder = '/Users/swajanjain/Downloads/filings_sep_2025_matched';
const outputFolder = '/Users/swajanjain/Downloads';

console.log('🔥 NEW VERSION WITH ENHANCED VALIDATION:');
console.log('   ✅ 4000-char proximity check (was 500)');
console.log('   ✅ 140+ English word validation');
console.log('   ✅ Remarks column (why it matched)');
console.log('   ✅ Context column (where it was found)');
console.log('');

console.log('🛡️  ADAPTIVE MATCHING - Terminal Execution\n');
console.log('='.repeat(80));
console.log(`\n📋 Prospects CSV: ${prospectsCSV}`);
console.log(`📂 SEC Filings Folder: ${secFilingsFolder}`);
console.log(`📁 Output Folder: ${outputFolder}\n`);
console.log('='.repeat(80) + '\n');

async function runAdaptiveMatching() {
    try {
        // Check if files exist
        if (!fs.existsSync(prospectsCSV)) {
            console.error(`❌ Error: Prospects CSV not found: ${prospectsCSV}`);
            process.exit(1);
        }

        if (!fs.existsSync(secFilingsFolder)) {
            console.error(`❌ Error: SEC filings folder not found: ${secFilingsFolder}`);
            process.exit(1);
        }

        // Get all SEC filing files
        const allFiles = fs.readdirSync(secFilingsFolder);
        const secFiles = allFiles
            .filter(f => f.endsWith('.txt'))
            .map(f => ({
                path: path.join(secFilingsFolder, f),
                originalname: f
            }));

        console.log(`📊 Found ${secFiles.length} SEC filing files\n`);

        if (secFiles.length === 0) {
            console.error('❌ Error: No .txt files found in SEC filings folder');
            process.exit(1);
        }

        // Create adaptive matcher
        const matcher = new AdaptiveMatcher();

        // Load prospects
        console.log('🔄 Loading prospects...');
        await matcher.loadProspects(prospectsCSV);
        console.log(`✅ Loaded ${matcher.prospects.length} prospects\n`);

        if (matcher.prospects.length === 0) {
            console.error('❌ Error: No valid prospects found in CSV');
            console.log('Expected columns: prospect_id, prospect_name, company_name');
            process.exit(1);
        }

        // Show first few prospects for verification
        console.log('📋 Sample prospects:');
        matcher.prospects.slice(0, 5).forEach((p, i) => {
            console.log(`   ${i + 1}. ${p.name} (${p.company})`);
        });
        console.log('');

        // Enable debug mode for smaller datasets
        const debugMode = secFiles.length < 500;

        console.log('🛡️  Starting ADAPTIVE MATCHING with strict validation...');
        console.log('   - Space boundary checks: ENABLED');
        console.log('   - English context validation: ENABLED');
        console.log('   - Encoded data blocking: ENABLED');
        console.log('   - Adaptive strictness levels: ENABLED\n');
        console.log('='.repeat(80) + '\n');

        const startTime = Date.now();

        // Process matching with progress callback
        const matches = await matcher.processMatchingLinear(secFiles, {
            emit: (event, data) => {
                if (event === 'progress') {
                    // Show progress
                    if (data.current % 10 === 0 || data.current === data.total) {
                        const percent = ((data.current / data.total) * 100).toFixed(1);
                        console.log(`📊 Progress: ${data.current}/${data.total} files (${percent}%) - ${data.matches || 0} matches so far`);
                    }
                }
            }
        }, debugMode);

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        console.log('\n' + '='.repeat(80));
        console.log('\n🎉 ADAPTIVE MATCHING COMPLETE!\n');
        console.log(`⏱️  Time taken: ${duration} seconds`);
        console.log(`📊 Total matches found: ${matches.length}`);

        // Break down by match type
        const matchStats = {
            'Name + Company': matches.filter(m => m.match_type === 'Name + Company').length,
            'Name Only': matches.filter(m => m.match_type === 'Name Only').length,
            'Company Only': matches.filter(m => m.match_type === 'Company Only').length
        };

        console.log(`\n📈 Match Breakdown:`);
        console.log(`   - Name + Company: ${matchStats['Name + Company']}`);
        console.log(`   - Name Only: ${matchStats['Name Only']}`);
        console.log(`   - Company Only: ${matchStats['Company Only']}`);

        // Show unique prospects and filings matched
        const uniqueProspects = new Set(matches.map(m => m.prospect_id)).size;
        const uniqueFilings = new Set(matches.map(m => m.sec_filing)).size;

        console.log(`\n📋 Coverage:`);
        console.log(`   - Unique prospects matched: ${uniqueProspects}`);
        console.log(`   - Unique SEC filings matched: ${uniqueFilings}`);

        // Export to CSV
        console.log('\n💾 Exporting results to CSV...');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outputPath = path.join(outputFolder, `adaptive_matches_${timestamp}.csv`);

        await matcher.exportToCsv(outputPath, debugMode);

        console.log(`✅ Results saved to: ${outputPath}\n`);
        console.log('='.repeat(80));

        console.log('\n🛡️  ADAPTIVE VALIDATION SUMMARY:\n');
        console.log('False positives prevented by:');
        console.log('  ✓ Space boundary validation (blocks "&USG"MGC#8" type matches)');
        console.log('  ✓ English context requirements (blocks encoded data matches)');
        console.log('  ✓ Encoded section blocking (skips binary/garbage sections)');
        console.log('  ✓ Adaptive strictness (extra strict for short names/companies)\n');

        console.log('✨ Done!\n');

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runAdaptiveMatching();
