#!/usr/bin/env node

/**
 * ADAPTIVE MATCHING RULES
 *
 * Core Insight: NOT all names/companies should be matched the same way!
 *
 * STRATEGY:
 * - Short/ambiguous patterns → STRICT matching (exact, isolated words)
 * - Long/unique patterns → FLEXIBLE matching (allow variations)
 *
 * This prevents false positives while maintaining recall for valid matches.
 */

class AdaptiveMatchingRules {
    /**
     * Classify name/company and return appropriate matching strategy
     */

    /**
     * RULE 1: NAME CLASSIFICATION
     *
     * Based on name structure, determine strictness level
     */
    classifyName(fullName) {
        const normalized = fullName.toLowerCase().trim();
        const parts = normalized.split(/\s+/).filter(p => p.length > 0);

        if (parts.length < 2) {
            return {
                type: 'INVALID',
                strictness: 'SKIP',
                reason: 'Name must have at least first and last name'
            };
        }

        const firstName = parts[0];
        const lastName = parts[parts.length - 1];
        const middleParts = parts.slice(1, -1);

        // CASE 1: Both first AND last are very short (≤2 chars)
        // Example: "Qi Li", "Bo Wu", "An Li"
        if (firstName.length <= 2 && lastName.length <= 2) {
            return {
                type: 'VERY_SHORT_NAME',
                strictness: 'VERY_STRICT',
                reason: 'Both first and last name are ≤2 characters',
                matchingRules: {
                    requireExactMatch: true,              // Must be "qi li" exactly
                    requireWordBoundaries: true,          // Must have spaces around
                    allowMiddleInitial: false,            // NO "qi x li" - too risky
                    requireEnglishContext: true,          // Must be surrounded by English words
                    minContextWords: 5,                   // At least 5 English words nearby
                    blockEncodedSections: true            // Skip if in encoded data
                },
                patterns: [
                    {
                        text: `${firstName} ${lastName}`,
                        regex: `\\b${this.escapeRegex(firstName)}\\s+${this.escapeRegex(lastName)}\\b`,
                        type: 'exact_only'
                    }
                ]
            };
        }

        // CASE 2: Either first OR last is short (≤2 chars), other is longer
        // Example: "An-Chen Li" → "An Li", "Li Zhang"
        else if (firstName.length <= 2 || lastName.length <= 2) {
            return {
                type: 'SHORT_NAME',
                strictness: 'STRICT',
                reason: 'One name component is ≤2 characters',
                matchingRules: {
                    requireExactMatch: true,              // Must match exactly
                    requireWordBoundaries: true,          // Must be isolated word
                    allowMiddleInitial: false,            // Be conservative
                    requireEnglishContext: true,          // Need English words nearby
                    minContextWords: 3,
                    blockEncodedSections: true
                },
                patterns: [
                    {
                        text: `${firstName} ${lastName}`,
                        regex: `\\b${this.escapeRegex(firstName)}\\s+${this.escapeRegex(lastName)}\\b`,
                        type: 'exact_only'
                    }
                ]
            };
        }

        // CASE 3: Both first AND last are 3 characters
        // Example: "Min Lee", "Bob Kim"
        else if (firstName.length === 3 && lastName.length === 3) {
            return {
                type: 'MEDIUM_SHORT_NAME',
                strictness: 'MODERATE',
                reason: 'Both names are 3 characters',
                matchingRules: {
                    requireExactMatch: true,
                    requireWordBoundaries: true,
                    allowMiddleInitial: true,             // Allow "bob j kim"
                    requireEnglishContext: true,
                    minContextWords: 2,
                    blockEncodedSections: true
                },
                patterns: [
                    {
                        text: `${firstName} ${lastName}`,
                        regex: `\\b${this.escapeRegex(firstName)}\\s+${this.escapeRegex(lastName)}\\b`,
                        type: 'exact'
                    },
                    {
                        text: `${firstName} ${lastName}`,
                        regex: `\\b${this.escapeRegex(firstName)}\\s+[a-z]\\.?\\s+${this.escapeRegex(lastName)}\\b`,
                        type: 'with_middle_initial'
                    }
                ]
            };
        }

        // CASE 4: Normal length names (≥4 chars each)
        // Example: "John Smith", "Maria Garcia"
        else {
            return {
                type: 'NORMAL_NAME',
                strictness: 'FLEXIBLE',
                reason: 'Both names are ≥4 characters',
                matchingRules: {
                    requireExactMatch: false,             // Can be flexible
                    requireWordBoundaries: true,
                    allowMiddleInitial: true,
                    requireEnglishContext: false,         // Not strictly needed
                    minContextWords: 0,
                    blockEncodedSections: true            // Still block encoded
                },
                patterns: [
                    {
                        text: `${firstName} ${lastName}`,
                        regex: `\\b${this.escapeRegex(firstName)}\\s+${this.escapeRegex(lastName)}\\b`,
                        type: 'exact'
                    },
                    {
                        text: `${firstName} ${lastName}`,
                        regex: `\\b${this.escapeRegex(firstName)}\\s+[a-z]\\.?\\s+${this.escapeRegex(lastName)}\\b`,
                        type: 'with_middle_initial'
                    }
                ]
            };
        }
    }

    /**
     * RULE 2: COMPANY CLASSIFICATION
     */
    classifyCompany(companyName) {
        // Remove common legal suffixes
        const root = companyName
            .toLowerCase()
            .replace(/\b(inc|incorporated|corp|corporation|company|co|llc|ltd|limited|plc|lp|university|college)\b/gi, '')
            .trim();

        const words = root.split(/\s+/).filter(w => w.length > 0);

        // CASE 1: Very short root (≤3 chars total)
        // Example: "USG Corporation" → "USG", "IBM Inc" → "IBM"
        if (root.length <= 3) {
            return {
                type: 'VERY_SHORT_COMPANY',
                strictness: 'VERY_STRICT',
                reason: `Company root "${root}" is only ${root.length} characters`,
                matchingRules: {
                    requireExactMatch: true,
                    requireWordBoundaries: true,
                    requireUpperCase: false,              // Allow both "USG" and "usg" in normalized text
                    requireEnglishContext: true,
                    minContextWords: 5,                   // Need strong English context
                    blockEncodedSections: true,
                    skipMatching: false,                  // DON'T skip - just be very strict
                    requireFullNameMatch: true            // Also search for "USG Corporation", "USG Corp"
                },
                patterns: [
                    {
                        text: root,
                        regex: `\\b${this.escapeRegex(root)}\\b`,
                        type: 'exact_word'
                    },
                    // Also search for full company name if it has legal suffix
                    {
                        text: companyName.toLowerCase(),
                        regex: `\\b${this.escapeRegex(companyName.toLowerCase())}\\b`,
                        type: 'full_company_name'
                    }
                ]
            };
        }

        // CASE 2: Short root (4-5 chars)
        // Example: "Acme Corp" → "Acme"
        else if (root.length <= 5) {
            return {
                type: 'SHORT_COMPANY',
                strictness: 'STRICT',
                reason: `Company root "${root}" is ${root.length} characters`,
                matchingRules: {
                    requireExactMatch: true,
                    requireWordBoundaries: true,
                    requireUpperCase: false,
                    requireEnglishContext: true,
                    minContextWords: 3,
                    blockEncodedSections: true
                },
                patterns: [
                    {
                        text: root,
                        regex: `\\b${this.escapeRegex(root)}\\b`,
                        type: 'exact_word'
                    }
                ]
            };
        }

        // CASE 3: Single word company (any length)
        // Example: "Microsoft", "Amazon", "Stanford"
        else if (words.length === 1) {
            return {
                type: 'SINGLE_WORD_COMPANY',
                strictness: 'MODERATE',
                reason: 'Single word company name',
                matchingRules: {
                    requireExactMatch: true,
                    requireWordBoundaries: true,
                    requireUpperCase: false,
                    requireEnglishContext: false,
                    minContextWords: 0,
                    blockEncodedSections: true
                },
                patterns: [
                    {
                        text: root,
                        regex: `\\b${this.escapeRegex(root)}\\b`,
                        type: 'exact_word'
                    }
                ]
            };
        }

        // CASE 4: Multi-word company
        // Example: "Goldman Sachs", "JP Morgan Chase"
        else {
            return {
                type: 'MULTI_WORD_COMPANY',
                strictness: 'FLEXIBLE',
                reason: 'Multi-word company name (more unique)',
                matchingRules: {
                    requireExactMatch: true,              // All words in sequence
                    requireWordBoundaries: true,
                    requireUpperCase: false,
                    requireEnglishContext: false,
                    minContextWords: 0,
                    blockEncodedSections: true
                },
                patterns: [
                    {
                        text: root,
                        regex: `\\b${this.escapeRegex(root)}\\b`,
                        type: 'exact_phrase'
                    }
                ]
            };
        }
    }

    /**
     * RULE 3: CONTEXT VALIDATION
     *
     * Check if match appears in valid English context
     */
    validateContext(text, matchPosition, minWords = 3) {
        // Extract window around match
        const windowSize = 100;
        const start = Math.max(0, matchPosition - windowSize);
        const end = Math.min(text.length, matchPosition + windowSize);
        const context = text.slice(start, end);

        // Check 1: Count English words (4+ letters)
        const englishWords = context.match(/\b[a-z]{4,}\b/gi) || [];
        if (englishWords.length < minWords) {
            return {
                valid: false,
                reason: `Only ${englishWords.length} English words in context (need ${minWords})`
            };
        }

        // Check 2: Check for encoded/binary patterns
        const totalChars = context.length;
        const encodedChars = (context.match(/[^a-zA-Z0-9\s.,;:!?()\-'"]/g) || []).length;
        const encodedPercent = (encodedChars / totalChars) * 100;

        if (encodedPercent > 30) {
            return {
                valid: false,
                reason: `${encodedPercent.toFixed(0)}% non-standard characters in context`
            };
        }

        // Check 3: Look for random capital sequences (sign of encoded data)
        if (/[A-Z]{5,}/.test(context)) {
            return {
                valid: false,
                reason: 'Random capital sequences detected (likely encoded data)'
            };
        }

        return {
            valid: true,
            englishWords: englishWords.length,
            encodedPercent: encodedPercent.toFixed(1)
        };
    }

    /**
     * RULE 4: WORD BOUNDARY VALIDATION WITH SPACES
     *
     * The KEY insight: For ambiguous patterns, require ACTUAL SPACES
     */
    hasProperSpaceBoundaries(text, matchStart, matchEnd) {
        const beforeChar = matchStart > 0 ? text[matchStart - 1] : ' ';
        const afterChar = matchEnd < text.length ? text[matchEnd] : ' ';

        // For strict matching: MUST have space or start/end of string
        const beforeIsSpace = beforeChar === ' ' || beforeChar === '\n' || beforeChar === '\t' || matchStart === 0;
        const afterIsSpace = afterChar === ' ' || afterChar === '\n' || afterChar === '\t' || matchEnd === text.length;

        return {
            valid: beforeIsSpace && afterIsSpace,
            before: beforeIsSpace,
            after: afterIsSpace,
            beforeChar: beforeChar,
            afterChar: afterChar
        };
    }

    /**
     * RULE 5: COMBINED DECISION LOGIC
     *
     * Given a prospect and a match, decide if it's valid
     */
    validateMatch(prospect, matchData, fileContent) {
        const nameRules = this.classifyName(prospect.name);
        const companyRules = this.classifyCompany(prospect.company);

        const results = {
            nameAnalysis: nameRules,
            companyAnalysis: companyRules,
            validations: [],
            finalDecision: 'UNKNOWN'
        };

        // If name should be skipped, reject immediately
        if (nameRules.matchingRules.skipMatching) {
            results.finalDecision = 'REJECT';
            results.reason = 'Name pattern should be skipped entirely';
            return results;
        }

        // Validate name match (if it was a name match)
        if (matchData.type === 'name' || matchData.type === 'name+company') {
            const nameValidation = this.validateNameMatch(
                matchData.nameMatchPosition,
                fileContent,
                nameRules
            );
            results.validations.push({ type: 'name', ...nameValidation });
        }

        // Validate company match (if it was a company match)
        if (matchData.type === 'company' || matchData.type === 'name+company') {
            // Skip if company is too short
            if (companyRules.matchingRules.skipMatching) {
                results.finalDecision = 'REJECT';
                results.reason = 'Company name too short and ambiguous';
                return results;
            }

            const companyValidation = this.validateCompanyMatch(
                matchData.companyMatchPosition,
                fileContent,
                companyRules
            );
            results.validations.push({ type: 'company', ...companyValidation });
        }

        // Final decision: ALL validations must pass
        const allValid = results.validations.every(v => v.valid);
        results.finalDecision = allValid ? 'ACCEPT' : 'REJECT';
        results.reason = allValid
            ? 'All validation checks passed'
            : results.validations.filter(v => !v.valid).map(v => v.reason).join('; ');

        return results;
    }

    validateNameMatch(position, fileContent, nameRules) {
        const validation = { valid: true, checks: [] };

        // Check 1: Word boundaries (spaces)
        if (nameRules.matchingRules.requireExactMatch) {
            const spaceBoundary = this.hasProperSpaceBoundaries(
                fileContent,
                position.start,
                position.end
            );

            if (!spaceBoundary.valid) {
                validation.valid = false;
                validation.reason = `No proper space boundaries (before: "${spaceBoundary.beforeChar}", after: "${spaceBoundary.afterChar}")`;
                return validation;
            }
            validation.checks.push('Space boundaries: PASS');
        }

        // Check 2: English context
        if (nameRules.matchingRules.requireEnglishContext) {
            const contextCheck = this.validateContext(
                fileContent,
                position.start,
                nameRules.matchingRules.minContextWords
            );

            if (!contextCheck.valid) {
                validation.valid = false;
                validation.reason = contextCheck.reason;
                return validation;
            }
            validation.checks.push(`English context: PASS (${contextCheck.englishWords} words)`);
        }

        // Check 3: Block encoded sections
        if (nameRules.matchingRules.blockEncodedSections) {
            const context = this.validateContext(fileContent, position.start, 0);
            if (context.encodedPercent && parseFloat(context.encodedPercent) > 20) {
                validation.valid = false;
                validation.reason = `In encoded section (${context.encodedPercent}% non-standard chars)`;
                return validation;
            }
            validation.checks.push('Not in encoded section: PASS');
        }

        return validation;
    }

    validateCompanyMatch(position, fileContent, companyRules) {
        const validation = { valid: true, checks: [] };

        // Similar validation as name, but with company-specific rules

        if (companyRules.matchingRules.requireWordBoundaries) {
            const spaceBoundary = this.hasProperSpaceBoundaries(
                fileContent,
                position.start,
                position.end
            );

            if (!spaceBoundary.valid) {
                validation.valid = false;
                validation.reason = 'No proper word boundaries for company name';
                return validation;
            }
            validation.checks.push('Word boundaries: PASS');
        }

        if (companyRules.matchingRules.requireEnglishContext) {
            const contextCheck = this.validateContext(
                fileContent,
                position.start,
                companyRules.matchingRules.minContextWords
            );

            if (!contextCheck.valid) {
                validation.valid = false;
                validation.reason = contextCheck.reason;
                return validation;
            }
            validation.checks.push(`English context: PASS`);
        }

        if (companyRules.matchingRules.blockEncodedSections) {
            const context = this.validateContext(fileContent, position.start, 0);
            if (context.encodedPercent && parseFloat(context.encodedPercent) > 20) {
                validation.valid = false;
                validation.reason = 'Company match in encoded section';
                return validation;
            }
            validation.checks.push('Not in encoded section: PASS');
        }

        return validation;
    }

    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

// Export for use in main matcher
module.exports = AdaptiveMatchingRules;

// Demo/Testing
if (require.main === module) {
    const rules = new AdaptiveMatchingRules();

    console.log('🎯 ADAPTIVE MATCHING RULES - Examples\n');
    console.log('='.repeat(80) + '\n');

    const testCases = [
        { name: 'Qi Li', company: 'Stanford University' },
        { name: 'Dawn Meyerriecks', company: 'USG Corporation' },
        { name: 'John Smith', company: 'Goldman Sachs Group Inc' },
        { name: 'An-Chen Li', company: 'MIT' },
        { name: 'Elizabeth Warren', company: 'Microsoft Corporation' }
    ];

    testCases.forEach((test, i) => {
        console.log(`Test ${i + 1}: ${test.name} at ${test.company}\n`);

        const nameAnalysis = rules.classifyName(test.name);
        console.log(`Name Classification: ${nameAnalysis.type} (${nameAnalysis.strictness})`);
        console.log(`Reason: ${nameAnalysis.reason}`);
        console.log(`Matching Rules:`);
        Object.entries(nameAnalysis.matchingRules).forEach(([key, value]) => {
            console.log(`  - ${key}: ${value}`);
        });

        console.log('');

        const companyAnalysis = rules.classifyCompany(test.company);
        console.log(`Company Classification: ${companyAnalysis.type} (${companyAnalysis.strictness})`);
        console.log(`Reason: ${companyAnalysis.reason}`);
        console.log(`Matching Rules:`);
        Object.entries(companyAnalysis.matchingRules).forEach(([key, value]) => {
            console.log(`  - ${key}: ${value}`);
        });

        console.log('\n' + '='.repeat(80) + '\n');
    });
}
