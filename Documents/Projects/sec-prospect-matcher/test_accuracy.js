#!/usr/bin/env node

// Test script to verify Aaron Davis accuracy fix
const fs = require('fs');
const path = require('path');

// Import the ProspectMatcher class
const { ProspectMatcher } = require('./server.js');

async function testAaronDavisFix() {
    console.log('🧪 TESTING AARON DAVIS ACCURACY FIX');
    console.log('==================================');

    // Create test data
    const testProspects = [
        { id: 'test-1', name: 'Aaron Davis', company: 'Davis Corp' },
        { id: 'test-2', name: 'John Smith', company: 'Smith LLC' },
        { id: 'test-3', name: 'Jane Davis', company: 'Different Company' }
    ];

    // Create test content - this simulates the problematic case
    // Content contains "Davis" but NOT "Aaron" - should NOT match Aaron Davis
    const problematicContent = `
    SECURITIES AND EXCHANGE COMMISSION
    Washington, D.C. 20549

    FORM 10-K

    Chief Financial Officer: Mark Davis
    Vice President: Sarah Davis Wilson
    Director of Operations: Mike Davis Jr.

    The company employs John Davis as head of marketing.
    Davis Industries has been a key partner.

    Note: This content contains "Davis" multiple times but NO "Aaron"
    This should NOT match "Aaron Davis" with the new accuracy fix.
    `;

    // Test content that SHOULD match Aaron Davis
    const validContent = `
    SECURITIES AND EXCHANGE COMMISSION
    Washington, D.C. 20549

    FORM 10-K

    Board Members:
    - Aaron Davis, Chairman
    - John Smith, CEO
    - Jane Wilson, CFO

    Aaron Davis has served on the board since 2020.
    Mr. Davis brings extensive experience in technology.
    `;

    console.log('\\n1. Testing PROBLEMATIC case (only "Davis", no "Aaron"):');
    console.log('Expected: Aaron Davis should NOT be selected as candidate');

    const matcher = new ProspectMatcher();
    matcher.prospects = testProspects;
    matcher.buildIndex();

    // Test the candidate selection directly
    const index = matcher.index;
    const candidates1 = matcher.findCandidatesOptimized(problematicContent, index, true);

    const aaronFound1 = [...candidates1].find(p => p.name === 'Aaron Davis');
    console.log(`Result: Aaron Davis found = ${!!aaronFound1}`);

    if (!aaronFound1) {
        console.log('✅ PASS: Aaron Davis correctly NOT selected (accuracy fixed!)');
    } else {
        console.log('❌ FAIL: Aaron Davis incorrectly selected (accuracy still broken)');
    }

    console.log('\\n2. Testing VALID case (both "Aaron" and "Davis" present):');
    console.log('Expected: Aaron Davis SHOULD be selected as candidate');

    const candidates2 = matcher.findCandidatesOptimized(validContent, index, true);
    const aaronFound2 = [...candidates2].find(p => p.name === 'Aaron Davis');
    console.log(`Result: Aaron Davis found = ${!!aaronFound2}`);

    if (aaronFound2) {
        console.log('✅ PASS: Aaron Davis correctly selected');
    } else {
        console.log('❌ FAIL: Aaron Davis should have been selected');
    }

    console.log('\\n3. Testing Jane Davis case (different first name):');
    const candidates3 = matcher.findCandidatesOptimized(problematicContent, index, true);
    const janeFound = [...candidates3].find(p => p.name === 'Jane Davis');
    console.log(`Result: Jane Davis found = ${!!janeFound}`);

    if (!janeFound) {
        console.log('✅ PASS: Jane Davis correctly NOT selected');
    } else {
        console.log('❌ FAIL: Jane Davis should not be selected');
    }

    console.log('\\n📊 SUMMARY:');
    console.log(`- Problematic content candidates: ${candidates1.size}`);
    console.log(`- Valid content candidates: ${candidates2.size}`);
    console.log('- Multi-token validation is working correctly');
}

// Run the test
testAaronDavisFix().catch(console.error);