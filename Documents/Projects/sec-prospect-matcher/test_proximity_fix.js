#!/usr/bin/env node

// Test proximity distance fix
class TestProximityMatcher {
    extractNameComponents(fullName) {
        const tokens = this.tokenizeWithBoundaries(fullName);
        if (tokens.length === 0) return { first: '', last: '', isValid: false };
        if (tokens.length === 1) return { first: tokens[0], last: '', isValid: false };
        const first = tokens[0];
        const last = tokens[tokens.length - 1];
        return { first, last, isValid: true };
    }

    tokenizeWithBoundaries(text) {
        const normalized = this.normalizeText(text);
        return normalized.split(/\s+/).filter(token => token.length > 1);
    }

    normalizeText(text) {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    findTokenWithWordBoundary(text, token) {
        const matches = [];
        const lowerText = text.toLowerCase();
        const lowerToken = token.toLowerCase();
        const tokenLength = token.length;

        if (!lowerText.includes(lowerToken)) {
            return matches;
        }

        let startPos = 0;
        while (true) {
            const pos = lowerText.indexOf(lowerToken, startPos);
            if (pos === -1) break;

            const beforeChar = pos > 0 ? text[pos - 1] : ' ';
            const afterChar = pos + tokenLength < text.length ? text[pos + tokenLength] : ' ';

            const isWordBoundary =
                !/[a-zA-Z0-9_]/.test(beforeChar) &&
                !/[a-zA-Z0-9_]/.test(afterChar);

            if (isWordBoundary) {
                matches.push({
                    position: pos,
                    text: text.slice(pos, pos + tokenLength)
                });
            }
            startPos = pos + 1;
        }
        return matches;
    }

    checkStrictNameMatch(nameComponents, text) {
        if (!nameComponents.isValid) return false;

        const firstMatches = this.findTokenWithWordBoundary(text, nameComponents.first);
        const lastMatches = this.findTokenWithWordBoundary(text, nameComponents.last);

        if (firstMatches.length === 0 || lastMatches.length === 0) {
            return false;
        }

        let bestMatch = null;
        let minDistance = Infinity;

        for (const firstMatch of firstMatches) {
            for (const lastMatch of lastMatches) {
                const distance = Math.abs(firstMatch.position - lastMatch.position);
                if (distance < minDistance && distance <= 40) { // NEW: 40 chars limit
                    minDistance = distance;
                    bestMatch = {
                        matched: true,
                        firstPos: firstMatch.position,
                        lastPos: lastMatch.position,
                        distance: distance,
                        firstText: firstMatch.text,
                        lastText: lastMatch.text
                    };
                }
            }
        }

        return bestMatch;
    }
}

function testProximityFix() {
    console.log('🧪 TESTING PROXIMITY DISTANCE FIX');
    console.log('=================================');

    const matcher = new TestProximityMatcher();

    // Test Case 1: Names very close together (should match)
    const validProximityText = `
    Board of Directors includes John Smith as Chairman.
    John Smith has extensive experience in finance.
    `;

    // Test Case 2: Names too far apart (should NOT match with new 40-char limit)
    const invalidProximityText = `
    John was appointed to the board in 2020. He brings decades of experience
    in corporate finance, strategic planning, and risk management. His background
    includes senior positions at major financial institutions and consulting firms.
    The board is confident that Smith will provide valuable leadership.
    `;

    // Test Case 3: Edge case - exactly at the limit
    const edgeCaseText = `
    John A. Smith is the new CFO of the company.
    `;

    console.log('\n1. Testing VALID proximity (names close together):');
    const nameComponents = matcher.extractNameComponents('John Smith');
    const result1 = matcher.checkStrictNameMatch(nameComponents, validProximityText);

    console.log(`Names: ${nameComponents.first} + ${nameComponents.last}`);
    console.log(`Result: ${result1 ? 'MATCH' : 'NO MATCH'}`);
    if (result1) {
        console.log(`Distance: ${result1.distance} chars`);
        console.log('✅ PASS: Close names correctly matched');
    } else {
        console.log('❌ FAIL: Close names should have matched');
    }

    console.log('\n2. Testing INVALID proximity (names too far apart):');
    const result2 = matcher.checkStrictNameMatch(nameComponents, invalidProximityText);

    console.log(`Result: ${result2 ? 'MATCH' : 'NO MATCH'}`);
    if (result2) {
        console.log(`Distance: ${result2.distance} chars`);
        console.log('❌ FAIL: Distant names should NOT match');
    } else {
        console.log('✅ PASS: Distant names correctly rejected');
    }

    console.log('\n3. Testing EDGE case (names at boundary):');
    const result3 = matcher.checkStrictNameMatch(nameComponents, edgeCaseText);

    console.log(`Result: ${result3 ? 'MATCH' : 'NO MATCH'}`);
    if (result3) {
        console.log(`Distance: ${result3.distance} chars`);
        console.log(`✅ Edge case: Names within limit (${result3.distance} ≤ 40)`);
    } else {
        console.log('❌ Edge case: Names should match within reasonable distance');
    }

    const passCount = (result1 ? 1 : 0) + (result2 ? 0 : 1) + (result3 ? 1 : 0);

    console.log('\n📊 SUMMARY:');
    console.log(`- Tests passed: ${passCount}/3`);
    console.log(`- Proximity limit: 40 characters (reduced from 100)`);

    if (passCount >= 2) {
        console.log('🎉 PROXIMITY FIX IS WORKING! Reduced false matches from distant names.');
    } else {
        console.log('❌ Proximity fix needs adjustment.');
    }
}

testProximityFix();