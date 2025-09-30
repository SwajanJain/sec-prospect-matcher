#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

/**
 * Split a large prospect CSV into smaller batches for processing
 * Usage: node split_prospects.js <input_file.csv> <batch_size>
 */

async function splitProspectFile(inputFile, batchSize = 10000) {
    console.log(`🔨 Splitting ${inputFile} into batches of ${batchSize} prospects...`);

    if (!fs.existsSync(inputFile)) {
        console.error(`❌ Error: File ${inputFile} not found`);
        process.exit(1);
    }

    // Create batches directory
    const batchDir = path.join(path.dirname(inputFile), 'prospect_batches');
    if (!fs.existsSync(batchDir)) {
        fs.mkdirSync(batchDir, { recursive: true });
    }

    let currentBatch = [];
    let batchNumber = 1;
    let totalRows = 0;
    let headers = null;

    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csvParser())
            .on('headers', (headerList) => {
                headers = headerList;
                console.log(`📋 CSV Headers detected: ${headerList.join(', ')}`);
            })
            .on('data', async (row) => {
                // Validate required columns
                const prospectId = row.prospect_id || row['prospect_id'] || row.id;
                const prospectName = row.prospect_name || row['prospect_name'] || row.name;
                const companyName = row.company_name || row['company_name'] || row.company;

                if (!prospectId || !prospectName || !companyName) {
                    console.warn(`⚠️  Skipping row ${totalRows + 1}: Missing required fields`);
                    return;
                }

                currentBatch.push({
                    prospect_id: prospectId.toString().trim(),
                    prospect_name: prospectName.toString().trim(),
                    company_name: companyName.toString().trim()
                });

                totalRows++;

                // Write batch when it reaches the size limit
                if (currentBatch.length >= batchSize) {
                    await writeBatch(currentBatch, batchNumber, batchDir);
                    console.log(`✅ Created batch ${batchNumber}: ${currentBatch.length} prospects`);
                    currentBatch = [];
                    batchNumber++;
                }
            })
            .on('end', async () => {
                // Write remaining prospects in the last batch
                if (currentBatch.length > 0) {
                    await writeBatch(currentBatch, batchNumber, batchDir);
                    console.log(`✅ Created final batch ${batchNumber}: ${currentBatch.length} prospects`);
                }

                console.log(`\n🎉 Splitting completed!`);
                console.log(`📊 Total prospects processed: ${totalRows}`);
                console.log(`📁 Total batches created: ${batchNumber}`);
                console.log(`📂 Batch files location: ${batchDir}`);
                console.log(`\n💡 Process each batch separately for optimal performance!`);

                resolve({
                    totalRows,
                    totalBatches: batchNumber,
                    batchDir
                });
            })
            .on('error', reject);
    });
}

async function writeBatch(prospects, batchNumber, batchDir) {
    const filename = `prospects_batch_${batchNumber.toString().padStart(3, '0')}.csv`;
    const filepath = path.join(batchDir, filename);

    const csvWriter = createObjectCsvWriter({
        path: filepath,
        header: [
            { id: 'prospect_id', title: 'prospect_id' },
            { id: 'prospect_name', title: 'prospect_name' },
            { id: 'company_name', title: 'company_name' }
        ]
    });

    await csvWriter.writeRecords(prospects);
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log(`
📋 Usage: node split_prospects.js <input_file.csv> [batch_size]

Example:
  node split_prospects.js prospects_132k.csv 10000

Options:
  input_file.csv  - Path to your large prospect CSV file
  batch_size      - Number of prospects per batch (default: 10000)

The script will create a 'prospect_batches' directory with smaller CSV files.
        `);
        process.exit(1);
    }

    const inputFile = args[0];
    const batchSize = parseInt(args[1]) || 10000;

    splitProspectFile(inputFile, batchSize)
        .then((result) => {
            console.log(`\n🚀 Ready to process ${result.totalBatches} batches with the SEC matcher!`);
        })
        .catch((error) => {
            console.error(`❌ Error splitting file:`, error.message);
            process.exit(1);
        });
}

module.exports = { splitProspectFile };