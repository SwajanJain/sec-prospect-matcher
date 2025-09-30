#!/usr/bin/env node

/**
 * Live Matches Extractor - Get current matches while processing is running
 * This extracts matches found so far from the running process
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function getCurrentMatches() {
    console.log('🔍 Extracting current matches from running process...');

    try {
        // Method 1: Check if temp chunk files exist
        const tempDir = path.join(__dirname, 'temp_chunks');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            if (files.length > 0) {
                console.log(`📁 Found ${files.length} chunk files in progress`);
                return await extractFromChunkFiles(tempDir, files);
            }
        }

        // Method 2: Extract from server memory (if accessible)
        console.log('📊 No chunk files found. Process may still be building first chunk.');
        console.log('💡 Matches will be available every ~50 files processed (~1-2 minutes)');

        return [];

    } catch (error) {
        console.error('❌ Error extracting matches:', error.message);
        return [];
    }
}

async function extractFromChunkFiles(tempDir, files) {
    const csvParser = require('csv-parser');
    let allMatches = [];

    for (const file of files) {
        if (file.endsWith('.csv')) {
            const filePath = path.join(tempDir, file);
            console.log(`📄 Reading ${file}...`);

            const fileMatches = await new Promise((resolve, reject) => {
                const matches = [];
                fs.createReadStream(filePath)
                    .pipe(csvParser())
                    .on('data', (row) => matches.push(row))
                    .on('end', () => resolve(matches))
                    .on('error', reject);
            });

            allMatches = allMatches.concat(fileMatches);
            console.log(`   ✅ ${fileMatches.length} matches found`);
        }
    }

    return allMatches;
}

async function saveCurrentMatches(matches) {
    if (matches.length === 0) {
        console.log('📭 No matches found yet. Check again in a few minutes.');
        return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `current_matches_${timestamp}.csv`;
    const filepath = path.join(__dirname, filename);

    // Create CSV content
    const headers = ['prospect_id', 'prospect_name', 'company_name', 'sec_filing', 'sec_url', 'match_type', 'confidence', 'match_date', 'context_snippets'];
    let csvContent = headers.join(',') + '\\n';

    matches.forEach(match => {
        const row = headers.map(header => {
            const value = match[header] || '';
            // Escape commas and quotes in CSV
            return `"${value.toString().replace(/"/g, '""')}"`;
        });
        csvContent += row.join(',') + '\\n';
    });

    fs.writeFileSync(filepath, csvContent);

    console.log(`\\n🎉 SUCCESS! Current matches saved:`);
    console.log(`📁 File: ${filename}`);
    console.log(`📊 Matches: ${matches.length}`);
    console.log(`💾 Size: ${(csvContent.length / 1024).toFixed(1)}KB`);

    return filepath;
}

// CLI Usage
if (require.main === module) {
    console.log('🚀 Live Matches Extractor');
    console.log('==========================\\n');

    getCurrentMatches()
        .then(matches => saveCurrentMatches(matches))
        .then(filepath => {
            if (filepath) {
                console.log(`\\n✅ Download ready: ${filepath}`);
                console.log('💡 Run this script again in a few minutes for updated results!');
            }
        })
        .catch(error => {
            console.error('❌ Extraction failed:', error);
            process.exit(1);
        });
}

module.exports = { getCurrentMatches, saveCurrentMatches };