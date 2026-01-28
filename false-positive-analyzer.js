#!/usr/bin/env node

/**
 * FALSE POSITIVE ANALYZER
 * Analyzes patterns in false positive matches to build detection rules
 */

const fs = require('fs');
const csv = require('csv-parser');

/**
 * HYPOTHESIS: False positives have these characteristics:
 *
 * 1. SHORT NAMES/COMPANIES
 *    - Very short names (2-3 letters): "Qi Li", "A B", "Jo Wu"
 *    - Very short companies: "USG", "IBM", "AMD" → match in encoded data
 *
 * 2. BINARY/ENCODED CONTEXT
 *    - Context contains non-ASCII characters
 *    - Context has random capital letters: "MZF3QI+7LI"
 *    - Context lacks English words
 *
 * 3. SUSPICIOUS MATCH PATTERNS
 *    - Name + Company match, but company is only 2-4 chars
 *    - Multiple matches in same file with different short names
 *    - Context snippet is empty or garbled
 *
 * 4. COMPANY-ONLY MATCHES
 *    - Lower confidence already
 *    - More prone to false positives
 *
 * 5. NAME STRUCTURE
 *    - Both first AND last name are 2 letters: "Qi Li", "Bo Wu"
 *    - Single character names: "Q Li", "A Smith"
 */

class FalsePositiveDetector {
    constructor() {
        this.suspiciousPatterns = [];
    }

    /**
     * SCORING SYSTEM: Calculate "False Positive Risk Score" (0-100)
     * Higher score = More likely to be false positive
     */
    calculateFPRiskScore(match) {
        let score = 0;
        const reasons = [];

        // RULE 0: Structured uncertainty signals (if provided)
        const uncertainMatch = match.uncertain_match === true || match.uncertain_match === 'true';
        const companyVerified = match.company_verified === true || match.company_verified === 'true';
        const matchMethod = (match.match_method || '').toString().toLowerCase();
        const structuredType = (match.structured_match_type || '').toString();

        // First+Middle-only is almost always a different person (drops last name)
        if (structuredType === 'first_middle_only') {
            score += 80;
            reasons.push(`Structured First+Middle-only match (likely wrong person)`);
        } else if (uncertainMatch) {
            score += 40;
            reasons.push(`Uncertain match flagged by matcher`);
        }

        // Structured matches without company verification are higher risk
        if (matchMethod === 'structured' && !companyVerified) {
            score += 20;
            reasons.push(`Structured match without company verification`);
        }

        // RULE 1: Short name components
        const nameParts = match.prospect_name.split(' ').filter(p => p.length > 0);
        if (nameParts.length >= 2) {
            const firstName = nameParts[0];
            const lastName = nameParts[nameParts.length - 1];

            // Both first and last are 2 letters
            if (firstName.length === 2 && lastName.length === 2) {
                score += 40;
                reasons.push(`Very short name: "${firstName} ${lastName}" (both 2 chars)`);
            }
            // Either is 1 letter
            else if (firstName.length === 1 || lastName.length === 1) {
                score += 50;
                reasons.push(`Single letter name component`);
            }
            // Either is 2 letters
            else if (firstName.length === 2 || lastName.length === 2) {
                score += 20;
                reasons.push(`Short name component (2 letters)`);
            }
        }

        // RULE 2: Short company name (after removing legal suffixes)
        const companyRoot = match.company_name
            .toLowerCase()
            .replace(/\b(inc|incorporated|corp|corporation|company|co|llc|ltd|limited|plc|lp|university)\b/gi, '')
            .trim();

        if (companyRoot.length <= 3) {
            score += 35;
            reasons.push(`Very short company: "${companyRoot}" (${companyRoot.length} chars)`);
        } else if (companyRoot.length <= 5) {
            score += 15;
            reasons.push(`Short company: "${companyRoot}" (${companyRoot.length} chars)`);
        }

        // RULE 3: Context analysis (if available)
        if (match.context_snippets) {
            const context = match.context_snippets.toLowerCase();

            // Check for encoded/binary patterns
            const encodedPatterns = /[^a-z0-9\s.,;:!?()\-'"]/g;
            const encodedChars = (context.match(encodedPatterns) || []).length;
            const totalChars = context.length;

            if (encodedChars > totalChars * 0.3) {
                score += 30;
                reasons.push(`Context has ${Math.round(encodedChars/totalChars*100)}% non-standard characters`);
            }

            // Check for lack of English words
            const englishWords = context.match(/\b[a-z]{4,}\b/g) || [];
            if (englishWords.length < 3) {
                score += 20;
                reasons.push(`Context has few English words (${englishWords.length})`);
            }

            // Check for random capital sequences
            if (/[A-Z]{3,}/.test(match.context_snippets)) {
                score += 15;
                reasons.push(`Context has random capital sequences`);
            }
        }

        // RULE 4: Match type specific rules
        if (match.match_type === 'Company Only' || match.match_type === 'Company Match') {
            score += 10;
            reasons.push(`Company-only match (lower reliability)`);
        }

        if (match.match_type === 'Name + Company' && companyRoot.length <= 4) {
            score += 15;
            reasons.push(`Name+Company match but company is too short to be reliable`);
        }

        // RULE 5: Confidence score adjustment
        const confidence = parseInt(match.confidence) || 0;
        if (confidence < 70) {
            score += 10;
            reasons.push(`Low confidence score: ${confidence}`);
        }

        // RULE 6: SEC filing patterns
        // Some filings are known to have more encoded data
        if (match.sec_filing && match.sec_filing.startsWith('000000000')) {
            score += 5;
            reasons.push(`Filing pattern associated with encoded data`);
        }

        // Cap at 100
        score = Math.min(100, score);

        return {
            score,
            reasons,
            classification: this.classifyRisk(score)
        };
    }

    classifyRisk(score) {
        if (score >= 70) return 'HIGH_RISK';
        if (score >= 50) return 'MEDIUM_RISK';
        if (score >= 30) return 'LOW_RISK';
        return 'LIKELY_VALID';
    }

    /**
     * Process CSV and flag suspicious matches
     */
    async analyzeCSV(csvPath) {
        console.log('🔍 FALSE POSITIVE ANALYSIS\n');
        console.log('='.repeat(80) + '\n');

        const matches = [];

        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => matches.push(row))
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`Analyzing ${matches.length} matches...\n`);

        const results = {
            HIGH_RISK: [],
            MEDIUM_RISK: [],
            LOW_RISK: [],
            LIKELY_VALID: []
        };

        for (const match of matches) {
            const analysis = this.calculateFPRiskScore(match);
            results[analysis.classification].push({
                match,
                analysis
            });
        }

        // Print summary
        console.log('📊 RISK CLASSIFICATION SUMMARY:\n');
        console.log(`HIGH RISK (likely false positive):     ${results.HIGH_RISK.length} matches`);
        console.log(`MEDIUM RISK (review recommended):      ${results.MEDIUM_RISK.length} matches`);
        console.log(`LOW RISK (probably valid):             ${results.LOW_RISK.length} matches`);
        console.log(`LIKELY VALID (high confidence):        ${results.LIKELY_VALID.length} matches\n`);

        // Show examples of high-risk matches
        if (results.HIGH_RISK.length > 0) {
            console.log('='.repeat(80));
            console.log('⚠️  HIGH RISK FALSE POSITIVES (Top 10):\n');

            results.HIGH_RISK
                .sort((a, b) => b.analysis.score - a.analysis.score)
                .slice(0, 10)
                .forEach((item, i) => {
                    const m = item.match;
                    const a = item.analysis;

                    console.log(`${i + 1}. ${m.prospect_name} (${m.company_name})`);
                    console.log(`   Filing: ${m.sec_filing}`);
                    console.log(`   Match Type: ${m.match_type}, Confidence: ${m.confidence}`);
                    console.log(`   FP Risk Score: ${a.score}/100`);
                    console.log(`   Reasons:`);
                    a.reasons.forEach(r => console.log(`      - ${r}`));
                    console.log('');
                });
        }

        return results;
    }

    /**
     * Export flagged results to new CSV
     */
    async exportFlaggedCSV(results, outputPath) {
        const { createObjectCsvWriter } = require('csv-writer');

        const allMatches = [
            ...results.HIGH_RISK,
            ...results.MEDIUM_RISK,
            ...results.LOW_RISK,
            ...results.LIKELY_VALID
        ];

        const csvWriter = createObjectCsvWriter({
            path: outputPath,
            header: [
                { id: 'prospect_id', title: 'prospect_id' },
                { id: 'prospect_name', title: 'prospect_name' },
                { id: 'company_name', title: 'company_name' },
                { id: 'sec_filing', title: 'sec_filing' },
                { id: 'sec_url', title: 'sec_url' },
                { id: 'match_type', title: 'match_type' },
                { id: 'confidence', title: 'confidence' },
                { id: 'match_date', title: 'match_date' },
                { id: 'fp_risk_score', title: 'fp_risk_score' },
                { id: 'fp_risk_level', title: 'fp_risk_level' },
                { id: 'fp_reasons', title: 'fp_reasons' },
                { id: 'context_snippets', title: 'context_snippets' }
            ]
        });

        const records = allMatches.map(item => ({
            ...item.match,
            fp_risk_score: item.analysis.score,
            fp_risk_level: item.analysis.classification,
            fp_reasons: item.analysis.reasons.join(' | ')
        }));

        await csvWriter.writeRecords(records);
        console.log(`\n✅ Flagged results exported to: ${outputPath}`);
        console.log(`   - Sort by "fp_risk_score" to see most suspicious matches first`);
        console.log(`   - Filter by "fp_risk_level" = "HIGH_RISK" to review false positives\n`);
    }

    /**
     * Generate filtering recommendations
     */
    generateRecommendations(results) {
        console.log('='.repeat(80));
        console.log('💡 RECOMMENDATIONS:\n');

        const highRiskCount = results.HIGH_RISK.length;
        const totalCount = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
        const fpRate = (highRiskCount / totalCount * 100).toFixed(1);

        console.log(`Estimated false positive rate: ${fpRate}%\n`);

        console.log('Suggested filters to add:');
        console.log('1. Skip names where both first AND last name are ≤2 characters');
        console.log('2. Skip company matches where root name is ≤3 characters');
        console.log('3. Validate context contains at least 3 English words (4+ chars)');
        console.log('4. Skip matches in sections with >30% non-ASCII characters');
        console.log('5. For "Name + Company" matches, require company ≥4 chars\n');

        console.log('Next steps:');
        console.log('1. Review HIGH_RISK matches manually');
        console.log('2. Confirm which are false positives');
        console.log('3. Apply filters to production system');
        console.log('4. Re-run matching on filtered dataset\n');
    }
}

// CLI Usage
if (require.main === module) {
    const csvPath = process.argv[2];

    if (!csvPath) {
        console.log('Usage: node false-positive-analyzer.js <matches.csv>');
        console.log('\nThis will analyze your matches and flag potential false positives.');
        process.exit(1);
    }

    if (!fs.existsSync(csvPath)) {
        console.error(`Error: File not found: ${csvPath}`);
        process.exit(1);
    }

    const detector = new FalsePositiveDetector();

    detector.analyzeCSV(csvPath).then(results => {
        detector.generateRecommendations(results);

        // Export flagged CSV
        const outputPath = csvPath.replace('.csv', '_with_fp_flags.csv');
        return detector.exportFlaggedCSV(results, outputPath);
    }).catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

module.exports = FalsePositiveDetector;
