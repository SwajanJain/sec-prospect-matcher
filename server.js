const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
const cluster = require('cluster');
const os = require('os');
const LinearMatcher = require('./LinearMatcher');
const AdaptiveMatcher = require('./AdaptiveMatcher');
const DatabaseMatcher = require('./DatabaseMatcher');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('.'));
app.use(express.json());

// Global variable to track current matcher instance for stop & export functionality
let currentMatcher = null;

const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit per file
        files: 10000, // Allow up to 10,000 files
        fieldSize: 100 * 1024 * 1024, // 100MB field size
        fields: 20000 // Increase field limit
    }
});

class ProspectMatcher {
    constructor() {
        this.prospects = [];
        this.matches = [];
    }

    async loadProspects(filePath) {
        return new Promise((resolve, reject) => {
            const prospects = [];
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => {
                    const prospectId = row.prospect_id || row['prospect_id'] || row['Prospect ID'] || row['prospectId'] || row.id || row.ID;
                    const prospectName = row.prospect_name || row['prospect_name'] || row['Prospect Name'] || row.name || row.Name;
                    const companyName = row.company_name || row['company_name'] || row['Company Name'] || row.company || row.Company || '';

                    // Company can be blank; we still want to track name-only matches.
                    if (prospectId && prospectName) {
                        prospects.push({
                            id: prospectId.toString().trim(),
                            name: prospectName.toString().trim(),
                            company: companyName.toString().trim()
                        });
                    }
                })
                .on('end', () => {
                    this.prospects = prospects;
                    resolve(prospects);
                })
                .on('error', reject);
        });
    }

    normalizeText(text) {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    tokenizeWithBoundaries(text) {
        // Extract words with word boundaries - prevents substring matches
        const normalized = this.normalizeText(text);
        return normalized.split(/\s+/).filter(token => token.length > 1);
    }

    normalizeCompany(company) {
        // Remove common legal suffixes and normalize
        const normalized = this.normalizeText(company);
        return normalized
            .replace(/\b(inc|incorporated|corp|corporation|llc|ltd|limited|plc|co|company|technologies|tech|holdings|group)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    checkExactCompanyMatch(prospect, text, debugMode = false) {
        const originalCompany = this.normalizeCompany(prospect.company);
        const rawCompany = prospect.company.toLowerCase().trim();

        if (debugMode) {
            console.log(`  🔍 EXACT Company Check: "${prospect.company}" -> normalized: "${originalCompany}"`);
        }

        // Try multiple variations for exact matching
        const companyVariations = [
            originalCompany,                    // Normalized without suffixes
            rawCompany,                        // Original lowercase
            prospect.company.toLowerCase(),     // Original case-insensitive
        ];

        // Remove duplicates
        const uniqueVariations = [...new Set(companyVariations)].filter(v => v.length > 2);

        for (const variation of uniqueVariations) {
            const exactMatches = this.findTokenWithWordBoundary(text, variation);
            if (exactMatches.length > 0) {
                if (debugMode) {
                    console.log(`  ✅ EXACT company match found: "${variation}"`);
                }
                return {
                    matched: true,
                    matchedText: variation,
                    positions: exactMatches.map(m => m.position)
                };
            }
        }

        if (debugMode) {
            console.log(`  ❌ NO EXACT company match found for any variation`);
            console.log(`    Tried: [${uniqueVariations.join('", "')}]`);
        }

        return null;
    }

    findTokenWithWordBoundary(text, token) {
        // Improved word boundary search that prevents false positives
        const matches = [];
        const lowerText = text.toLowerCase();
        const lowerToken = token.toLowerCase().trim();
        const tokenLength = lowerToken.length;

        // Quick pre-check - if token not in text at all, return early
        if (!lowerText.includes(lowerToken)) {
            return matches;
        }

        // Minimum token length to avoid matching very short strings
        if (tokenLength < 2) {
            return matches;
        }

        let startPos = 0;
        while (true) {
            const pos = lowerText.indexOf(lowerToken, startPos);
            if (pos === -1) break;

            // Get characters before and after the token
            const beforeChar = pos > 0 ? lowerText[pos - 1] : '';
            const afterChar = pos + tokenLength < text.length ? lowerText[pos + tokenLength] : '';

            // Strict word boundary check - must be complete word
            const isStrictWordBoundary = this.isStrictWordBoundary(beforeChar, afterChar, lowerToken);

            if (isStrictWordBoundary) {
                // Additional validation: ensure the found token is actually the word we want
                const foundWord = text.slice(pos, pos + tokenLength);
                if (this.isExactWordMatch(foundWord, token)) {
                    matches.push({
                        position: pos,
                        text: foundWord
                    });
                }
            }

            startPos = pos + 1;
        }

        return matches;
    }

    isStrictWordBoundary(beforeChar, afterChar, token) {
        // Define word boundary characters more precisely
        const wordBoundaryChars = /[\s\.,;:!?\-\(\)\[\]{}"\'/\\|~`@#$%^&*+=<>]/;
        const isNumberChar = /[0-9]/;
        const isLetterChar = /[a-zA-Z]/;

        // Check if character before is a word boundary
        const beforeIsBoundary = !beforeChar || wordBoundaryChars.test(beforeChar) ||
                                 (isNumberChar.test(beforeChar) && isLetterChar.test(token[0]));

        // Check if character after is a word boundary
        const afterIsBoundary = !afterChar || wordBoundaryChars.test(afterChar) ||
                                (isLetterChar.test(token[token.length - 1]) && isNumberChar.test(afterChar));

        return beforeIsBoundary && afterIsBoundary;
    }

    isExactWordMatch(foundWord, searchToken) {
        // Case-insensitive exact match with trimming
        const normalizedFound = foundWord.toLowerCase().trim();
        const normalizedSearch = searchToken.toLowerCase().trim();

        // Must be exact match - no partial matches allowed
        return normalizedFound === normalizedSearch;
    }

    findTokenPositionsWithBoundary(lowerText, token) {
        const positions = [];
        const lowerToken = (token || '').toLowerCase().trim();
        const tokenLength = lowerToken.length;

        if (!lowerToken || tokenLength < 2) return positions;

        let startPos = 0;
        while (true) {
            const pos = lowerText.indexOf(lowerToken, startPos);
            if (pos === -1) break;

            const beforeChar = pos > 0 ? lowerText[pos - 1] : '';
            const afterChar = pos + tokenLength < lowerText.length ? lowerText[pos + tokenLength] : '';

            if (this.isStrictWordBoundary(beforeChar, afterChar, lowerToken)) {
                positions.push(pos);
            }

            startPos = pos + 1;
        }

        return positions;
    }

    extractNameComponents(fullName) {
        const tokens = this.tokenizeWithBoundaries(fullName);

        if (tokens.length === 0) return { first: '', last: '', isValid: false };
        if (tokens.length === 1) return { first: tokens[0], last: '', isValid: false };

        const first = tokens[0];
        const last = tokens[tokens.length - 1];

        return { first, last, isValid: true };
    }

    checkStrictNameMatch(nameComponents, text) {
        if (!nameComponents.isValid) return false;

        const firstMatches = this.findTokenWithWordBoundary(text, nameComponents.first);
        const lastMatches = this.findTokenWithWordBoundary(text, nameComponents.last);

        // Must have BOTH first AND last name
        if (firstMatches.length === 0 || lastMatches.length === 0) {
            return false;
        }

        // Find closest proximity between first and last name - much closer now
        let bestMatch = null;
        let minDistance = Infinity;

        for (const firstMatch of firstMatches) {
            for (const lastMatch of lastMatches) {
                const distance = Math.abs(firstMatch.position - lastMatch.position);
                if (distance < minDistance && distance <= 40) { // Strict proximity - first/last name must be very close
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

    buildProspectIndex() {
        // Build inverted index: token -> prospects
        const nameToProspects = new Map(); // first name -> prospects
        const lastNameToProspects = new Map(); // last name -> prospects
        const companyToProspects = new Map(); // exact company names -> prospects

        for (const prospect of this.prospects) {
            // Index name components
            const nameComponents = this.extractNameComponents(prospect.name);
            if (nameComponents.isValid) {
                if (!nameToProspects.has(nameComponents.first)) {
                    nameToProspects.set(nameComponents.first, []);
                }
                if (!lastNameToProspects.has(nameComponents.last)) {
                    lastNameToProspects.set(nameComponents.last, []);
                }
                nameToProspects.get(nameComponents.first).push(prospect);
                lastNameToProspects.get(nameComponents.last).push(prospect);
            }

            // Index exact company variations for faster lookup
            const normalizedCompany = this.normalizeCompany(prospect.company);
            const rawCompany = prospect.company.toLowerCase().trim();

            const companyVariations = [
                normalizedCompany,
                rawCompany,
                prospect.company.toLowerCase()
            ];

            // Remove duplicates and short names
            const uniqueVariations = [...new Set(companyVariations)].filter(v => v.length > 2);

            for (const variation of uniqueVariations) {
                if (!companyToProspects.has(variation)) companyToProspects.set(variation, []);
                companyToProspects.get(variation).push(prospect);
            }
        }

        // Build frequency-based priority maps for faster filtering
        const nameFrequency = new Map();
        const companyFrequency = new Map();

        // Calculate frequencies for smart pre-filtering
        for (const [token, prospects] of nameToProspects) {
            nameFrequency.set(token, prospects.length);
        }
        for (const [token, prospects] of companyToProspects) {
            companyFrequency.set(token, prospects.length);
        }

        return {
            nameToProspects,
            lastNameToProspects,
            companyToProspects,
            nameFrequency,
            companyFrequency
        };
    }

    tokenizeWithPositions(text) {
        const normalized = this.normalizeText(text);
        const tokens = new Map(); // token -> [positions]

        // Use regex to find word boundaries and positions
        const regex = /\b\w{2,}\b/g;
        let match;

        while ((match = regex.exec(normalized)) !== null) {
            const word = match[0];
            const position = match.index;

            if (!tokens.has(word)) tokens.set(word, []);
            tokens.get(word).push(position);
        }

        return tokens;
    }

    extractContext(text, position, contextSize = 50) {
        const start = Math.max(0, position - contextSize);
        const end = Math.min(text.length, position + contextSize);
        return text.substring(start, end).replace(/\s+/g, ' ').trim();
    }

    checkProximityMatch(prospect, originalText, debugMode = false) {
        const nameComponents = this.extractNameComponents(prospect.name);

        if (debugMode) {
            console.log(`\n🔍 DEBUG: Checking prospect "${prospect.name}" at "${prospect.company}"`);
            console.log(`Name components: first="${nameComponents.first}", last="${nameComponents.last}", valid=${nameComponents.isValid}`);
        }

        // Check strict name matching (requires BOTH first AND last very near)
        const nameMatchResult = this.checkStrictNameMatch(nameComponents, originalText);

        // Check EXACT company matching
        const companyMatchResult = this.checkExactCompanyMatch(prospect, originalText, debugMode);

        if (debugMode) {
            if (nameMatchResult) {
                console.log(`  ✅ Name MATCH: "${nameMatchResult.firstText}" + "${nameMatchResult.lastText}" (distance: ${nameMatchResult.distance} chars)`);
            } else {
                console.log(`  ❌ Name NOT matched - requires both first AND last name within 40 chars`);
            }

            if (companyMatchResult) {
                console.log(`  ✅ Company EXACT MATCH: "${companyMatchResult.matchedText}"`);
            } else {
                console.log(`  ❌ Company NOT matched - requires EXACT company name match`);
            }
        }

        const matches = [];

        // Type 1: Name + Company proximity match (highest confidence)
        if (nameMatchResult && companyMatchResult) {
            let bestProximityMatch = null;
            let minDistance = 2000 + 1;

            const namePos = Math.min(nameMatchResult.firstPos, nameMatchResult.lastPos);
            for (const companyPos of companyMatchResult.positions) {
                const distance = Math.abs(namePos - companyPos);
                if (distance <= 2000 && distance < minDistance) {
                    minDistance = distance;

                    bestProximityMatch = {
                        match: true,
                        matchType: 'Name (First+Last) + Company (EXACT)',
                        distance,
                        namePos,
                        companyPos,
                        nameMatches: { [`${nameMatchResult.firstText} ${nameMatchResult.lastText}`]: [nameMatchResult.firstPos, nameMatchResult.lastPos] },
                        companyMatches: { [companyMatchResult.matchedText]: companyMatchResult.positions },
                        baseConfidence: 98, // Highest confidence for exact matches
                        companyScore: 100
                    };

                    if (debugMode && originalText) {
                        bestProximityMatch.nameContext = this.extractContext(originalText, namePos);
                        bestProximityMatch.companyContext = this.extractContext(originalText, companyPos);
                    }
                }
            }

            if (bestProximityMatch) {
                matches.push(bestProximityMatch);
                if (debugMode) {
                    console.log(`  ✅ PROXIMITY MATCH: Distance ${bestProximityMatch.distance} chars, Name+Company`);
                }
            }
        }

        // Type 2: Name-only match - requires BOTH first AND last very near
        if (nameMatchResult) {
            const nameOnlyMatch = {
                match: true,
                matchType: 'Name Only (First+Last)',
                distance: nameMatchResult.distance,
                namePos: nameMatchResult.firstPos,
                companyPos: null,
                nameMatches: { [`${nameMatchResult.firstText} ${nameMatchResult.lastText}`]: [nameMatchResult.firstPos, nameMatchResult.lastPos] },
                companyMatches: {},
                baseConfidence: 85, // High confidence for name matches
                companyScore: 0
            };

            if (debugMode && originalText) {
                nameOnlyMatch.nameContext = this.extractContext(originalText, nameMatchResult.firstPos);
                nameOnlyMatch.companyContext = 'N/A - Name only match';
            }

            matches.push(nameOnlyMatch);
            if (debugMode) {
                console.log(`  ✅ NAME-ONLY MATCH (both first and last name very close)`);
            }
        }

        // NOTE: Removed company-only matches as requested

        if (matches.length === 0) {
            if (debugMode) {
                console.log(`  ❌ NO MATCHES: Missing valid name match (first+last within 40 chars)`);
            }
            return false;
        }

        // Return the highest confidence match
        const bestMatch = matches.reduce((best, current) => {
            let currentScore = current.baseConfidence;

            // Small penalty for distance (names must be very close)
            if (current.distance > 0) {
                currentScore -= Math.floor(current.distance / 10);
            }

            let bestScore = best.baseConfidence;
            if (best.distance > 0) {
                bestScore -= Math.floor(best.distance / 10);
            }

            return currentScore > bestScore ? current : best;
        });

        if (debugMode) {
            let finalConfidence = bestMatch.baseConfidence;
            if (bestMatch.distance > 0) {
                finalConfidence -= Math.floor(bestMatch.distance / 10);
            }
            finalConfidence = Math.max(0, finalConfidence);

            console.log(`  🏆 BEST MATCH: ${bestMatch.matchType} (confidence: ${finalConfidence})`);
        }

        return bestMatch;
    }

    async processFileOptimized(filePath, filename, index, debugMode = false) {
        return new Promise((resolve) => {
            try {
                // Check file size first
                const stats = fs.statSync(filePath);
                const fileSizeBytes = stats.size;
                const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
                const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB threshold

                if (debugMode) {
                    console.log(`\n📄 PROCESSING FILE: ${filename}`);
                    console.log(`File size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
                }

                // Use streaming for large files, synchronous read for small files
                if (fileSizeBytes > LARGE_FILE_THRESHOLD) {
                    this.processLargeFileStreaming(filePath, filename, index, debugMode, resolve);
                } else {
                    const content = fs.readFileSync(filePath, 'utf8');
                    this.processFileContent(content, filename, index, debugMode, resolve);
                }

            } catch (error) {
                console.error(`Error processing file ${filePath}:`, error);
                resolve({
                    matches: [],
                    candidatesChecked: 0,
                    totalTokens: 0
                });
            }
        });
    }

    processFileContent(content, filename, index, debugMode, resolve) {
        try {
            // Intelligent candidate pre-filtering with memory optimization
            const candidateProspects = this.findCandidatesOptimized(content, index, debugMode);

            if (debugMode) {
                console.log(`\n🎯 CANDIDATES FOUND: ${candidateProspects.size}`);
            }

            // Apply strict matching to candidates
            const matches = [];
            for (const prospect of candidateProspects) {
                const prospectDebugMode = debugMode && (prospect.name.includes('Brian Collins') || prospect.name.includes('John Schlaack'));

                const proximityResult = this.checkProximityMatch(prospect, content, prospectDebugMode);
                if (proximityResult) {
                    const secUrl = this.createSECUrl(filename);
                    // Simplified confidence calculation for exact matching
                    let confidence = proximityResult.baseConfidence;

                    // Small penalty for distance
                    if (proximityResult.distance > 0) {
                        confidence -= Math.floor(proximityResult.distance / 10);
                    }

                    confidence = Math.max(0, confidence);
                    const match = {
                        prospect_id: prospect.id,
                        prospect_name: prospect.name,
                        company_name: prospect.company,
                        sec_filing: filename,
                        sec_url: secUrl || `file://${path.resolve(filename)}`,
                        match_date: new Date().toISOString().split('T')[0],
                        match_type: proximityResult.matchType,
                        distance: proximityResult.distance,
                        confidence: confidence
                    };

                    // Add debug info for audit trail
                    if (debugMode || prospectDebugMode) {
                        match.debug_name_context = proximityResult.nameContext;
                        match.debug_company_context = proximityResult.companyContext;
                    }

                    matches.push(match);

                    if (prospectDebugMode) {
                        console.log(`\n🎉 MATCH ADDED:`);
                        console.log(`   Prospect: ${prospect.name}`);
                        console.log(`   Company: ${prospect.company}`);
                        console.log(`   Type: ${match.match_type}`);
                        console.log(`   Distance: ${proximityResult.distance} chars`);
                        console.log(`   Confidence: ${confidence}`);
                    }
                }
            }

            resolve({
                matches,
                candidatesChecked: candidateProspects.size,
                totalTokens: content.length
            });

        } catch (error) {
            console.error('Error in processFileContent:', error);
            resolve({
                matches: [],
                candidatesChecked: 0,
                totalTokens: 0
            });
        }
    }

    processLargeFileStreaming(filePath, filename, index, debugMode, resolve) {
        try {
            if (debugMode) {
                console.log(`📊 STREAMING LARGE FILE: ${filename}`);
            }

            const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
            const OVERLAP_SIZE = 10000; // 10KB overlap for matching across boundaries

            let accumulatedContent = '';
            let chunkIndex = 0;
            let totalProcessed = 0;
            const candidateProspects = new Set();
            const matches = [];

            const stream = fs.createReadStream(filePath, {
                encoding: 'utf8',
                highWaterMark: CHUNK_SIZE
            });

            stream.on('data', (chunk) => {
                // Accumulate chunk with previous overlap
                const fullChunk = accumulatedContent + chunk;
                const normalized = this.normalizeText(fullChunk);

                // Find candidates in this chunk using optimized method
                const chunkCandidates = this.findCandidatesOptimized(fullChunk, index, false);
                chunkCandidates.forEach(p => candidateProspects.add(p));

                // Keep overlap for next chunk to handle boundary matches
                if (fullChunk.length > OVERLAP_SIZE) {
                    accumulatedContent = fullChunk.slice(-OVERLAP_SIZE);
                } else {
                    accumulatedContent = fullChunk;
                }

                totalProcessed += chunk.length;
                chunkIndex++;

                if (debugMode && chunkIndex % 10 === 0) {
                    console.log(`   Processed ${chunkIndex} chunks, ${(totalProcessed / 1024 / 1024).toFixed(1)}MB`);
                }
            });

            stream.on('end', () => {
                if (debugMode) {
                    console.log(`✅ Streaming complete. Found ${candidateProspects.size} candidates`);
                }

                // Now that we have all candidates, we need the full content for proximity matching
                // For large files, we'll use a more memory-efficient approach
                this.processLargeFileCandidates(filePath, filename, candidateProspects, debugMode, totalProcessed, resolve);
            });

            stream.on('error', (error) => {
                console.error(`Streaming error for ${filePath}:`, error);
                resolve({
                    matches: [],
                    candidatesChecked: 0,
                    totalTokens: 0
                });
            });

        } catch (error) {
            console.error(`Error in processLargeFileStreaming for ${filePath}:`, error);
            resolve({
                matches: [],
                candidatesChecked: 0,
                totalTokens: 0
            });
        }
    }

    processLargeFileCandidates(filePath, filename, candidateProspects, debugMode, totalTokens, resolve) {
        // For final matching, we need the content - but only if we found candidates
        if (candidateProspects.size === 0) {
            resolve({
                matches: [],
                candidatesChecked: 0,
                totalTokens: totalTokens
            });
            return;
        }

        try {
            if (debugMode) {
                console.log(`🔍 Final matching for ${candidateProspects.size} candidates`);
            }

            const NAME_WINDOW = 40;
            const COMPANY_WINDOW = 2000;
            const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
            const OVERLAP_SIZE = 500; // Overlap for multi-word matches across boundaries

            const candidateStates = [];
            for (const prospect of candidateProspects) {
                const nameComponents = this.extractNameComponents(prospect.name);
                const normalizedCompany = this.normalizeCompany(prospect.company || '');
                const rawCompany = (prospect.company || '').toLowerCase().trim();

                const companyVariations = [
                    normalizedCompany,
                    rawCompany,
                    (prospect.company || '').toLowerCase().trim()
                ];

                const uniqueCompanyVariations = [...new Set(companyVariations)].filter(v => v.length > 2);

                candidateStates.push({
                    prospect,
                    nameComponents,
                    companyVariations: uniqueCompanyVariations,
                    firstPositions: [],
                    lastPositions: [],
                    namePositions: [],
                    companyPositions: [],
                    bestNameMatch: null,
                    bestNameCompany: null
                });
            }

            const prunePositions = (positions, minPos) => {
                while (positions.length > 0 && positions[0] < minPos) {
                    positions.shift();
                }
            };

            const updateBestNameCompany = (state, namePos, companyPos) => {
                const distance = Math.abs(namePos - companyPos);
                if (!state.bestNameCompany || distance < state.bestNameCompany.distance) {
                    state.bestNameCompany = { distance, namePos, companyPos };
                }
            };

            const recordNameMatch = (state, firstPos, lastPos) => {
                const distance = Math.abs(firstPos - lastPos);
                if (!state.bestNameMatch || distance < state.bestNameMatch.distance) {
                    state.bestNameMatch = { distance, firstPos, lastPos };
                }

                const namePos = Math.min(firstPos, lastPos);
                state.namePositions.push(namePos);
                prunePositions(state.namePositions, namePos - COMPANY_WINDOW);
                prunePositions(state.companyPositions, namePos - COMPANY_WINDOW);

                for (const companyPos of state.companyPositions) {
                    updateBestNameCompany(state, namePos, companyPos);
                }
            };

            const handleNameToken = (state, tokenType, position) => {
                if (tokenType === 'first') {
                    state.firstPositions.push(position);
                    prunePositions(state.firstPositions, position - NAME_WINDOW);
                    prunePositions(state.lastPositions, position - NAME_WINDOW);

                    for (const lastPos of state.lastPositions) {
                        if (Math.abs(position - lastPos) <= NAME_WINDOW) {
                            recordNameMatch(state, position, lastPos);
                        }
                    }
                } else {
                    state.lastPositions.push(position);
                    prunePositions(state.firstPositions, position - NAME_WINDOW);
                    prunePositions(state.lastPositions, position - NAME_WINDOW);

                    for (const firstPos of state.firstPositions) {
                        if (Math.abs(position - firstPos) <= NAME_WINDOW) {
                            recordNameMatch(state, firstPos, position);
                        }
                    }
                }
            };

            const handleCompanyPosition = (state, position) => {
                state.companyPositions.push(position);
                prunePositions(state.companyPositions, position - COMPANY_WINDOW);
                prunePositions(state.namePositions, position - COMPANY_WINDOW);

                for (const namePos of state.namePositions) {
                    updateBestNameCompany(state, namePos, position);
                }
            };

            let processedChars = 0;
            let overlap = '';

            const stream = fs.createReadStream(filePath, {
                encoding: 'utf8',
                highWaterMark: CHUNK_SIZE
            });

            stream.on('data', (chunk) => {
                const searchText = overlap + chunk;
                const lowerSearchText = searchText.toLowerCase();
                const baseOffset = processedChars - overlap.length;
                const overlapLength = overlap.length;

                for (const state of candidateStates) {
                    const events = [];
                    if (!state.nameComponents.isValid) {
                        continue;
                    }

                    const firstToken = state.nameComponents.first.toLowerCase();
                    const lastToken = state.nameComponents.last.toLowerCase();

                    const firstPositions = this.findTokenPositionsWithBoundary(lowerSearchText, firstToken);
                    for (const pos of firstPositions) {
                        if (pos + firstToken.length <= overlapLength) continue;
                        events.push({ pos: baseOffset + pos, type: 'first' });
                    }

                    const lastPositions = this.findTokenPositionsWithBoundary(lowerSearchText, lastToken);
                    for (const pos of lastPositions) {
                        if (pos + lastToken.length <= overlapLength) continue;
                        events.push({ pos: baseOffset + pos, type: 'last' });
                    }

                    if (state.companyVariations.length > 0) {
                        const companyPositions = new Set();
                        for (const variation of state.companyVariations) {
                            const positions = this.findTokenPositionsWithBoundary(lowerSearchText, variation);
                            for (const pos of positions) {
                                if (pos + variation.length <= overlapLength) continue;
                                companyPositions.add(baseOffset + pos);
                            }
                        }

                        for (const pos of companyPositions) {
                            events.push({ pos, type: 'company' });
                        }
                    }

                    if (events.length === 0) continue;
                    events.sort((a, b) => a.pos - b.pos);

                    for (const event of events) {
                        if (event.type === 'first') {
                            handleNameToken(state, 'first', event.pos);
                        } else if (event.type === 'last') {
                            handleNameToken(state, 'last', event.pos);
                        } else {
                            handleCompanyPosition(state, event.pos);
                        }
                    }
                }

                if (searchText.length > OVERLAP_SIZE) {
                    overlap = searchText.slice(-OVERLAP_SIZE);
                } else {
                    overlap = searchText;
                }

                processedChars += chunk.length;
            });

            stream.on('end', () => {
                const matches = [];

                for (const state of candidateStates) {
                    const secUrl = this.createSECUrl(filename);

                    if (state.bestNameCompany && state.bestNameCompany.distance <= COMPANY_WINDOW) {
                        let confidence = 98;
                        if (state.bestNameCompany.distance > 0) {
                            confidence -= Math.floor(state.bestNameCompany.distance / 10);
                        }
                        confidence = Math.max(0, confidence);

                        matches.push({
                            prospect_id: state.prospect.id,
                            prospect_name: state.prospect.name,
                            company_name: state.prospect.company,
                            sec_filing: filename,
                            sec_url: secUrl || `file://${path.resolve(filePath)}`,
                            match_date: new Date().toISOString().split('T')[0],
                            match_type: 'Name (First+Last) + Company (EXACT)',
                            distance: state.bestNameCompany.distance,
                            confidence: confidence
                        });
                    } else if (state.bestNameMatch) {
                        let confidence = 85;
                        if (state.bestNameMatch.distance > 0) {
                            confidence -= Math.floor(state.bestNameMatch.distance / 10);
                        }
                        confidence = Math.max(0, confidence);

                        matches.push({
                            prospect_id: state.prospect.id,
                            prospect_name: state.prospect.name,
                            company_name: state.prospect.company,
                            sec_filing: filename,
                            sec_url: secUrl || `file://${path.resolve(filePath)}`,
                            match_date: new Date().toISOString().split('T')[0],
                            match_type: 'Name Only (First+Last)',
                            distance: state.bestNameMatch.distance,
                            confidence: confidence
                        });
                    }
                }

                resolve({
                    matches,
                    candidatesChecked: candidateProspects.size,
                    totalTokens: totalTokens
                });
            });

            stream.on('error', (error) => {
                console.error(`Streaming error for ${filePath}:`, error);
                resolve({
                    matches: [],
                    candidatesChecked: 0,
                    totalTokens: totalTokens
                });
            });

        } catch (error) {
            console.error(`Error in processLargeFileCandidates:`, error);
            resolve({
                matches: [],
                candidatesChecked: 0,
                totalTokens: totalTokens
            });
        }
    }

    findCandidatesOptimized(content, index, debugMode = false) {
        const candidateProspects = new Set();
        const normalized = this.normalizeText(content);

        // Early exit optimization - quick content scan
        const contentLength = content.length;
        if (contentLength === 0) return candidateProspects;

        // Memory-optimized token extraction with frequency-based prioritization
        const contentTokens = new Set();

        // Fast tokenization - extract only alphanumeric sequences
        const tokenRegex = /[a-zA-Z]{2,}/g;
        let match;
        while ((match = tokenRegex.exec(normalized)) !== null) {
            contentTokens.add(match[0]);
        }

        if (debugMode) {
            console.log(`📊 Content tokens extracted: ${contentTokens.size}, Content length: ${(contentLength / 1024).toFixed(1)}KB`);
        }

        // CRITICAL FIX: Multi-token validation for accurate candidate selection
        // Instead of single-token matching, validate ALL name components are present

        const validatedCandidates = new Set();
        let nameValidated = 0;
        let companyValidated = 0;

        // Validate each prospect by checking ALL name/company tokens are present
        for (const prospect of this.prospects) {
            let isValidCandidate = false;

            // Check name match - require ALL name components to be present
            const nameComponents = this.extractNameComponents(prospect.name);
            if (nameComponents.isValid) {
                const hasFirst = contentTokens.has(nameComponents.first.toLowerCase());
                const hasLast = contentTokens.has(nameComponents.last.toLowerCase());

                if (hasFirst && hasLast) {
                    isValidCandidate = true;
                    nameValidated++;
                    if (debugMode) {
                        console.log(`✅ NAME CANDIDATE: ${prospect.name} (${nameComponents.first} + ${nameComponents.last})`);
                    }
                }
            }

            // Check company match - require significant company name components
            if (!isValidCandidate && prospect.company && prospect.company.length > 3) {
                const companyTokens = this.extractSignificantTokens(prospect.company);
                const matchingTokens = companyTokens.filter(token =>
                    token.length > 3 && contentTokens.has(token.toLowerCase())
                );

                // Require at least half of significant tokens to match (minimum 1)
                const requiredMatches = Math.max(1, Math.floor(companyTokens.length / 2));
                if (matchingTokens.length >= requiredMatches) {
                    isValidCandidate = true;
                    companyValidated++;
                    if (debugMode) {
                        console.log(`✅ COMPANY CANDIDATE: ${prospect.name} via "${prospect.company}" (${matchingTokens.length}/${companyTokens.length} tokens: ${matchingTokens.join(', ')})`);
                    }
                }
            }

            if (isValidCandidate) {
                validatedCandidates.add(prospect);
            }
        }

        if (debugMode) {
            console.log(`🎯 MULTI-TOKEN VALIDATION: ${validatedCandidates.size} validated candidates`);
            console.log(`   Names: ${nameValidated}, Companies: ${companyValidated}`);
            console.log(`   Previous single-token approach would have been much higher (less accurate)`);
        }

        return validatedCandidates;
    }

    // Helper method to extract significant tokens from company names
    extractSignificantTokens(companyName) {
        if (!companyName) return [];

        // Common words to ignore in company matching
        const stopWords = new Set(['inc', 'llc', 'corp', 'corporation', 'company', 'co', 'ltd', 'limited',
                                   'the', 'and', 'or', 'of', 'for', 'group', 'services', 'service']);

        const tokens = companyName.toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Remove punctuation
            .split(/\s+/)
            .filter(token => token.length > 2 && !stopWords.has(token));

        return tokens;
    }

    createSECUrl(filename) {
        // SEC filename format: 0000000000-00-000000.txt
        // Example: 0000950170-25-113358.txt
        const match = filename.match(/^(\d{10})-(\d{2})-(\d{6})\.txt$/);
        if (match) {
            const [, cik, year, sequence] = match;
            // Remove leading zeros from CIK for the URL path
            const numericCik = parseInt(cik, 10);
            // Keep the original format for accession number (with dashes removed)
            const accessionNumber = `${cik}${year}${sequence}`;

            // For newer filings (2025), try SEC search page instead of direct archive
            const currentYear = new Date().getFullYear();
            const filingYear = 2000 + parseInt(year);

            if (filingYear >= currentYear) {
                // Recent filings: use search page (always accessible)
                return `https://www.sec.gov/search-filings?cik=${numericCik}`;
            } else {
                // Older filings: try direct archive URL
                return `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionNumber}.txt`;
            }
        }
        return null;
    }

    async processMatchingOptimized(secFiles, socket, debugMode = false, resumeData = null) {
        console.log(`Building inverted index for ${this.prospects.length} prospects...`);
        if (socket) socket.emit('status', 'Building search index...');

        const index = this.buildProspectIndex();
        console.log(`Index built: ${index.companyToProspects.size} company tokens`);

        // Initialize processing state
        let allMatches = [];
        let processedFiles = 0;
        let totalCandidatesChecked = 0;
        let totalProcessingTime = 0;
        const overallStartTime = Date.now();
        const INCREMENTAL_SAVE_INTERVAL = 50; // Save every 50 files
        const CHECKPOINT_INTERVAL = 100; // Save checkpoint every 100 files
        let lastSaveCount = 0;

        // Generate session ID for checkpoints
        const sessionId = `session_${new Date().toISOString().replace(/[:.]/g, '-')}_${Date.now()}`;

        // Handle resume from checkpoint
        if (resumeData) {
            allMatches = resumeData.currentMatches || [];
            processedFiles = resumeData.processedFiles || 0;
            lastSaveCount = allMatches.length;
            secFiles = resumeData.remainingFiles || secFiles;
            console.log(`🔄 Resuming from checkpoint: ${processedFiles} files already processed, ${allMatches.length} matches found`);
            if (socket) {
                socket.emit('status', `🔄 Resuming from checkpoint: ${processedFiles} files processed, ${allMatches.length} matches found`);
            }
        }

        const totalFiles = (resumeData?.totalFiles || secFiles.length);
        const originalProcessedCount = processedFiles;

        if (socket) {
            socket.emit('status', `Starting to process ${totalFiles} SEC filings...`);
            // Send initial progress
            socket.emit('progress', {
                progress: 0,
                current: 0,
                total: totalFiles,
                file: 'Initializing...',
                matches: 0,
                candidates: 0,
                tokens: 0,
                processingTime: 0,
                avgProcessingTime: 0
            });
        }

        for (let i = 0; i < secFiles.length; i++) {
            const secFile = secFiles[i];
            const startTime = Date.now();

            // Calculate current position in overall processing
            const currentFileNumber = originalProcessedCount + i + 1;

            // Emit current file status
            if (socket) {
                socket.emit('status', `Processing file ${currentFileNumber}/${totalFiles}: ${secFile.originalname}`);
            }

            const fileDebugMode = debugMode && secFile.originalname.includes('0001104659-25-088238');
            const result = await this.processFileOptimized(secFile.path, secFile.originalname, index, fileDebugMode);

            allMatches.push(...result.matches);
            totalCandidatesChecked += result.candidatesChecked;
            processedFiles++;

            const actualProcessedFiles = originalProcessedCount + processedFiles;
            const progress = Math.floor((actualProcessedFiles / totalFiles) * 100);
            const processingTime = Date.now() - startTime;
            totalProcessingTime += processingTime;
            const avgProcessingTime = Math.round(totalProcessingTime / processedFiles);

            // Calculate overall elapsed time
            const overallElapsed = Date.now() - overallStartTime;
            const overallAvgTimePerFile = Math.round(overallElapsed / processedFiles);

            // Incremental save every 50 files
            if (actualProcessedFiles % INCREMENTAL_SAVE_INTERVAL === 0 || actualProcessedFiles === totalFiles) {
                if (allMatches.length > lastSaveCount) {
                    await this.saveIncrementalMatches(allMatches, actualProcessedFiles, totalFiles, socket);
                    lastSaveCount = allMatches.length;
                }
            }

            // Checkpoint save every 100 files
            if (actualProcessedFiles % CHECKPOINT_INTERVAL === 0) {
                await this.saveCheckpoint(sessionId, actualProcessedFiles, totalFiles, secFiles, allMatches, socket);
            }

            if (socket) {
                const progressData = {
                    progress,
                    current: actualProcessedFiles,
                    total: totalFiles,
                    file: secFile.originalname,
                    matches: allMatches.length,
                    candidates: result.candidatesChecked,
                    tokens: result.totalTokens,
                    processingTime,
                    avgProcessingTime: overallAvgTimePerFile, // Use overall average for better ETA
                    filesRemaining: totalFiles - actualProcessedFiles,
                    overallElapsed: overallElapsed
                };

                console.log('Sending progress data:', progressData); // Debug log
                socket.emit('progress', progressData);
            }

            console.log(`File ${currentFileNumber}/${totalFiles}: ${secFile.originalname} - ${result.matches.length} matches from ${result.candidatesChecked} candidates (${processingTime}ms)`);
        }

        console.log(`\nOptimized processing complete:`);
        console.log(`- Files processed: ${processedFiles}`);
        console.log(`- Total matches found: ${allMatches.length}`);
        console.log(`- Efficiency: ${((totalCandidatesChecked / (this.prospects.length * secFiles.length)) * 100).toFixed(2)}% of naive approach`);

        const deduplicatedMatches = this.deduplicateMatches(allMatches);
        console.log(`- After deduplication: ${deduplicatedMatches.length} unique matches`);

        // Clean up checkpoint on successful completion
        try {
            await ProspectMatcher.deleteCheckpoint(sessionId);
        } catch (error) {
            console.log('No checkpoint to clean up');
        }

        this.matches = deduplicatedMatches;
        return deduplicatedMatches;
    }

    deduplicateMatches(matches) {
        const seen = new Map();

        for (const match of matches) {
            const key = `${match.prospect_id}:${match.sec_filing}`;
            const existing = seen.get(key);

            if (!existing || match.confidence > existing.confidence) {
                seen.set(key, match);
            }
        }

        return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
    }

    async exportToCsv(outputPath, includeDebugInfo = false) {
        const headers = [
            { id: 'prospect_id', title: 'Prospect ID' },
            { id: 'prospect_name', title: 'Prospect Name' },
            { id: 'company_name', title: 'Company Name' },
            { id: 'sec_filing', title: 'SEC Filing' },
            { id: 'sec_url', title: 'SEC URL' },
            { id: 'match_date', title: 'Match Date' },
            { id: 'match_type', title: 'Match Type' },
            { id: 'distance', title: 'Distance (chars)' },
            { id: 'confidence', title: 'Confidence Score' }
        ];

        if (includeDebugInfo && this.matches.some(m => m.debug_name_context)) {
            headers.push(
                { id: 'debug_name_context', title: 'Debug: Name Context' },
                { id: 'debug_company_context', title: 'Debug: Company Context' }
            );
        }

        const csvWriter = createCsvWriter({
            path: outputPath,
            header: headers
        });

        await csvWriter.writeRecords(this.matches);
        return this.matches.length;
    }

    async saveIncrementalMatches(matches, processedFiles, totalFiles, socket = null) {
        try {
            if (matches.length === 0) return;

            // Deduplicate matches before saving
            const deduplicatedMatches = this.deduplicateMatches(matches);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `incremental_matches_${processedFiles}_of_${totalFiles}_${timestamp}.csv`;
            const filepath = path.join('uploads', filename);

            // Temporarily set matches for export
            const originalMatches = this.matches;
            this.matches = deduplicatedMatches;

            await this.exportToCsv(filepath);

            // Restore original matches
            this.matches = originalMatches;

            console.log(`💾 Incremental save: ${deduplicatedMatches.length} matches saved to ${filename}`);

            if (socket) {
                socket.emit('status', `💾 Auto-saved ${deduplicatedMatches.length} matches (files ${processedFiles}/${totalFiles})`);
            }

        } catch (error) {
            console.error('Error saving incremental matches:', error);
            if (socket) {
                socket.emit('status', `⚠️ Warning: Failed to save incremental backup`);
            }
        }
    }

    async saveCheckpoint(sessionId, processedFiles, totalFiles, secFiles, currentMatches, socket = null) {
        try {
            const checkpointData = {
                sessionId,
                processedFiles,
                totalFiles,
                currentMatches: this.deduplicateMatches(currentMatches),
                remainingFiles: secFiles.slice(processedFiles).map(f => ({
                    originalname: f.originalname,
                    path: f.path,
                    size: f.size
                })),
                prospects: this.prospects,
                startTime: new Date().toISOString(),
                checkpointTime: new Date().toISOString()
            };

            const checkpointPath = path.join('uploads', `checkpoint_${sessionId}.json`);
            await fs.promises.writeFile(checkpointPath, JSON.stringify(checkpointData, null, 2));

            console.log(`💾 Checkpoint saved: ${processedFiles}/${totalFiles} files processed`);
            if (socket) {
                socket.emit('status', `💾 Checkpoint saved at file ${processedFiles}/${totalFiles}`);
            }

        } catch (error) {
            console.error('Error saving checkpoint:', error);
            if (socket) {
                socket.emit('status', `⚠️ Warning: Failed to save checkpoint`);
            }
        }
    }

    async loadCheckpoint(sessionId) {
        try {
            const checkpointPath = path.join('uploads', `checkpoint_${sessionId}.json`);
            const checkpointData = JSON.parse(await fs.promises.readFile(checkpointPath, 'utf8'));

            // Restore matcher state
            this.prospects = checkpointData.prospects;
            this.matches = checkpointData.currentMatches;

            console.log(`🔄 Checkpoint loaded: resuming from ${checkpointData.processedFiles}/${checkpointData.totalFiles}`);
            return checkpointData;

        } catch (error) {
            console.error('Error loading checkpoint:', error);
            return null;
        }
    }

    static async listAvailableCheckpoints() {
        try {
            const files = await fs.promises.readdir('uploads');
            const checkpointFiles = files.filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'));

            const checkpoints = await Promise.all(
                checkpointFiles.map(async (filename) => {
                    try {
                        const filepath = path.join('uploads', filename);
                        const data = JSON.parse(await fs.promises.readFile(filepath, 'utf8'));
                        return {
                            sessionId: data.sessionId,
                            processedFiles: data.processedFiles,
                            totalFiles: data.totalFiles,
                            matches: data.currentMatches.length,
                            checkpointTime: data.checkpointTime,
                            filename
                        };
                    } catch {
                        return null;
                    }
                })
            );

            return checkpoints.filter(c => c !== null).sort((a, b) =>
                new Date(b.checkpointTime) - new Date(a.checkpointTime)
            );

        } catch (error) {
            console.error('Error listing checkpoints:', error);
            return [];
        }
    }

    static async deleteCheckpoint(sessionId) {
        try {
            const checkpointPath = path.join('uploads', `checkpoint_${sessionId}.json`);
            await fs.promises.unlink(checkpointPath);
            console.log(`🗑️ Checkpoint deleted: ${sessionId}`);
            return true;
        } catch (error) {
            console.error('Error deleting checkpoint:', error);
            return false;
        }
    }

    async processMatchingParallel(secFiles, socket, debugMode = false, resumeData = null) {
        console.log(`Building inverted index for ${this.prospects.length} prospects...`);
        if (socket) socket.emit('status', 'Building search index...');

        const index = this.buildProspectIndex();
        console.log(`Index built: ${index.companyToProspects.size} company tokens`);

        // Initialize processing state
        let allMatches = [];
        let processedFiles = 0;
        let totalCandidatesChecked = 0;
        let totalProcessingTime = 0;
        const overallStartTime = Date.now();
        const INCREMENTAL_SAVE_INTERVAL = 50;
        const CHECKPOINT_INTERVAL = 100;
        let lastSaveCount = 0;

        const sessionId = `session_${new Date().toISOString().replace(/[:.]/g, '-')}_${Date.now()}`;

        // Handle resume from checkpoint
        let originalProcessedCount = 0;
        let totalFiles = secFiles.length;

        if (resumeData) {
            console.log(`Resuming from checkpoint with ${resumeData.currentMatches.length} existing matches...`);
            allMatches = resumeData.currentMatches || [];
            originalProcessedCount = resumeData.processedFiles || 0;
            processedFiles = 0;
            totalFiles = resumeData.totalFiles || secFiles.length;
            lastSaveCount = allMatches.length;

            if (socket) {
                socket.emit('status', `Resuming processing from file ${originalProcessedCount + 1}/${totalFiles}`);
            }
        }

        // Determine optimal number of workers
        const numCPUs = os.cpus().length;
        const maxWorkers = Math.min(numCPUs, secFiles.length, 8); // Limit to 8 workers
        const batchSize = Math.max(1, Math.floor(secFiles.length / maxWorkers));

        console.log(`Using ${maxWorkers} parallel workers with batch size ${batchSize}`);

        if (socket) {
            socket.emit('status', `Starting parallel processing with ${maxWorkers} workers...`);
        }

        // Create batches for parallel processing
        const batches = [];
        for (let i = 0; i < secFiles.length; i += batchSize) {
            batches.push(secFiles.slice(i, i + batchSize));
        }

        // Process batches in parallel using Promise.all with limited concurrency
        const processPromises = batches.map((batch, batchIndex) =>
            this.processBatch(batch, batchIndex, index, debugMode, socket, originalProcessedCount, totalFiles)
        );

        try {
            const batchResults = await Promise.all(processPromises);

            // Combine results from all batches
            for (const batchResult of batchResults) {
                allMatches.push(...batchResult.matches);
                totalCandidatesChecked += batchResult.candidatesChecked;
                processedFiles += batchResult.filesProcessed;
                totalProcessingTime += batchResult.processingTime;
            }

            // Incremental save and checkpoint logic
            const actualProcessedFiles = originalProcessedCount + processedFiles;

            if (actualProcessedFiles % INCREMENTAL_SAVE_INTERVAL === 0 || actualProcessedFiles === totalFiles) {
                if (allMatches.length > lastSaveCount) {
                    await this.saveIncrementalMatches(allMatches, actualProcessedFiles, totalFiles, socket);
                    lastSaveCount = allMatches.length;
                }
            }

            if (actualProcessedFiles % CHECKPOINT_INTERVAL === 0) {
                await this.saveCheckpoint(sessionId, actualProcessedFiles, totalFiles, secFiles, allMatches, socket);
            }

        } catch (error) {
            console.error('Error in parallel processing:', error);
            // Fallback to sequential processing
            console.log('Falling back to sequential processing...');
            return this.processMatchingOptimized(secFiles, socket, debugMode, resumeData);
        }

        console.log(`\nParallel processing complete:`);
        console.log(`- Files processed: ${processedFiles}`);
        console.log(`- Total matches found: ${allMatches.length}`);
        console.log(`- Efficiency: ${((totalCandidatesChecked / (this.prospects.length * secFiles.length)) * 100).toFixed(2)}% of naive approach`);
        console.log(`- Processing time: ${totalProcessingTime}ms (${Math.round(totalProcessingTime / processedFiles)}ms avg per file)`);

        const deduplicatedMatches = this.deduplicateMatches(allMatches);
        console.log(`- After deduplication: ${deduplicatedMatches.length} unique matches`);

        // Clean up checkpoint on successful completion
        try {
            await ProspectMatcher.deleteCheckpoint(sessionId);
        } catch (error) {
            console.log('No checkpoint to clean up');
        }

        this.matches = deduplicatedMatches;
        return deduplicatedMatches;
    }

    async processBatch(fileBatch, batchIndex, index, debugMode, socket, originalProcessedCount, totalFiles) {
        const batchStartTime = Date.now();
        let batchMatches = [];
        let batchCandidatesChecked = 0;
        let filesProcessed = 0;

        for (const secFile of fileBatch) {
            const startTime = Date.now();
            const fileDebugMode = debugMode && secFile.originalname.includes('0001104659-25-088238');
            const result = await this.processFileOptimized(secFile.path, secFile.originalname, index, fileDebugMode);

            batchMatches.push(...result.matches);
            batchCandidatesChecked += result.candidatesChecked;
            filesProcessed++;

            const processingTime = Date.now() - startTime;
            const currentFileNumber = originalProcessedCount + (batchIndex * fileBatch.length) + filesProcessed;

            // Emit progress updates (less frequent to avoid overwhelming the client)
            if (socket && filesProcessed % 5 === 0) { // Update every 5 files per batch
                const progress = Math.floor((currentFileNumber / totalFiles) * 100);
                socket.emit('progress', {
                    progress,
                    current: currentFileNumber,
                    total: totalFiles,
                    file: secFile.originalname,
                    matches: batchMatches.length,
                    candidates: result.candidatesChecked,
                    processingTime,
                    batchIndex: batchIndex
                });
            }

            console.log(`Batch ${batchIndex}: File ${currentFileNumber}/${totalFiles}: ${secFile.originalname} - ${result.matches.length} matches (${processingTime}ms)`);
        }

        const batchProcessingTime = Date.now() - batchStartTime;
        console.log(`Batch ${batchIndex} completed: ${filesProcessed} files, ${batchMatches.length} matches in ${batchProcessingTime}ms`);

        return {
            matches: batchMatches,
            candidatesChecked: batchCandidatesChecked,
            filesProcessed: filesProcessed,
            processingTime: batchProcessingTime
        };
    }
}

io.on('connection', (socket) => {
    console.log('Client connected for real-time updates');
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

app.post('/match', upload.fields([
    { name: 'prospects', maxCount: 1 },
    { name: 'secFiles', maxCount: 10000 }
]), async (req, res) => {
    const socket = Array.from(io.sockets.sockets.values())[0];

    try {
        const prospectsFile = req.files['prospects']?.[0];
        const secFiles = req.files['secFiles'] || [];

        if (!prospectsFile || secFiles.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please provide both prospects CSV and SEC files'
            });
        }

        console.log(`Processing ${secFiles.length} SEC files against prospects...`);

        const matcher = new ProspectMatcher();
        currentMatcher = matcher; // Track for stop & export functionality

        if (socket) socket.emit('status', 'Loading prospects...');
        await matcher.loadProspects(prospectsFile.path);
        console.log(`Loaded ${matcher.prospects.length} prospects`);

        if (matcher.prospects.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid prospects found in CSV. Expected columns: prospect_id, prospect_name, company_name'
            });
        }

        const debugMode = secFiles.some(f => f.originalname.includes('0001104659-25-088238'));

        if (socket) socket.emit('status', debugMode ? 'Starting DEBUG matching process...' : 'Starting parallel matching process...');
        const matches = await matcher.processMatchingParallel(secFiles, socket, debugMode);
        console.log(`Found ${matches.length} matches`);

        if (socket) socket.emit('status', 'Generating CSV file...');
        const outputPath = path.join('uploads', `matches_${Date.now()}.csv`);
        await matcher.exportToCsv(outputPath, debugMode);

        if (socket) socket.emit('complete', { matches: matches.length });

        // Cleanup
        [prospectsFile, ...secFiles].forEach(file => {
            try {
                if (file && file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (error) {
                console.error('Error deleting temporary file:', error);
            }
        });

        res.json({
            success: true,
            message: `Matching completed successfully!`,
            matches: matches.length,
            downloadUrl: `/download/${path.basename(outputPath)}`
        });

        // Clear the current matcher reference
        currentMatcher = null;

    } catch (error) {
        console.error('Matching error:', error);
        if (socket) socket.emit('error', error.message);
        res.status(500).json({
            success: false,
            error: 'Error processing files: ' + error.message
        });

        // Clear the current matcher reference
        currentMatcher = null;
    }
});

// LINEAR MATCHING ENDPOINT - GPT-5's Optimized Approach
app.post('/match-linear', upload.fields([
    { name: 'prospects', maxCount: 1 },
    { name: 'secFiles', maxCount: 10000 }
]), async (req, res) => {
    const socket = Array.from(io.sockets.sockets.values())[0];

    try {
        const prospectsFile = req.files['prospects']?.[0];
        const secFiles = req.files['secFiles'] || [];

        if (!prospectsFile || secFiles.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please provide both prospects CSV and SEC files'
            });
        }

        console.log(`\n🚀 LINEAR MATCHING: Processing ${secFiles.length} SEC files against prospects...`);

        const linearMatcher = new LinearMatcher();
        currentMatcher = linearMatcher; // Track for stop & export functionality

        if (socket) socket.emit('status', 'Loading prospects for linear matching...');
        await linearMatcher.loadProspects(prospectsFile.path);
        console.log(`Loaded ${linearMatcher.prospects.length} prospects`);

        if (linearMatcher.prospects.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid prospects found in CSV. Expected columns: prospect_id, prospect_name, company_name'
            });
        }

        const debugMode = secFiles.some(f => f.originalname.includes('0001104659-25-088238')) ||
                          secFiles.length < 10; // Enable debug for small datasets

        if (socket) {
            socket.emit('status',
                debugMode ?
                'Starting LINEAR matching with debug mode...' :
                'Starting LINEAR matching process...'
            );
        }

        // Use linear matching algorithm
        const matches = await linearMatcher.processMatchingLinear(secFiles, socket, debugMode);

        console.log(`\n🎉 LINEAR MATCHING COMPLETE:`);
        console.log(`- Total matches found: ${matches.length}`);

        // Break down by match type
        const matchStats = {
            'Name + Company': matches.filter(m => m.match_type === 'Name + Company').length,
            'Name Only': matches.filter(m => m.match_type === 'Name Only').length,
            'Company Only': matches.filter(m => m.match_type === 'Company Only').length
        };

        console.log(`- Match breakdown: Name+Company: ${matchStats['Name + Company']}, Name Only: ${matchStats['Name Only']}, Company Only: ${matchStats['Company Only']}`);

        if (socket) socket.emit('status', 'Generating CSV file...');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = path.join('uploads', `linear_matches_${timestamp}.csv`);
        await linearMatcher.exportToCsv(outputPath, debugMode);

        if (socket) {
            socket.emit('complete', {
                matches: matches.length,
                matchStats: matchStats,
                message: 'Linear matching completed successfully!'
            });
        }

        // Cleanup uploaded files
        [prospectsFile, ...secFiles].forEach(file => {
            try {
                if (file && file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (error) {
                console.error('Error deleting temporary file:', error);
            }
        });

        res.json({
            success: true,
            message: `Linear matching completed successfully!`,
            matches: matches.length,
            matchStats: matchStats,
            algorithm: 'Linear Aho-Corasick',
            downloadUrl: `/download/${path.basename(outputPath)}`
        });

        // Clear the current matcher reference
        currentMatcher = null;

    } catch (error) {
        console.error('Linear matching error:', error);
        if (socket) socket.emit('error', error.message);
        res.status(500).json({
            success: false,
            error: 'Error processing files with linear matcher: ' + error.message
        });

        // Clear the current matcher reference
        currentMatcher = null;
    }
});

// ADAPTIVE MATCHING ENDPOINT - Strict validation to prevent false positives
app.post('/match-adaptive', upload.fields([
    { name: 'prospects', maxCount: 1 },
    { name: 'secFiles', maxCount: 10000 }
]), async (req, res) => {
    const socket = Array.from(io.sockets.sockets.values())[0];

    try {
        const prospectsFile = req.files['prospects']?.[0];
        const secFiles = req.files['secFiles'] || [];

        if (!prospectsFile || secFiles.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please provide both prospects CSV and SEC files'
            });
        }

        console.log(`\n🛡️  ADAPTIVE MATCHING: Processing ${secFiles.length} SEC files with strict validation...`);

        const adaptiveMatcher = new AdaptiveMatcher();
        currentMatcher = adaptiveMatcher; // Track for stop & export functionality

        if (socket) socket.emit('status', 'Loading prospects for adaptive matching...');
        await adaptiveMatcher.loadProspects(prospectsFile.path);
        console.log(`Loaded ${adaptiveMatcher.prospects.length} prospects`);

        if (adaptiveMatcher.prospects.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid prospects found in CSV. Expected columns: prospect_id, prospect_name, company_name'
            });
        }

        const debugMode = secFiles.some(f => f.originalname.includes('0001104659-25-088238')) ||
                          secFiles.length < 10; // Enable debug for small datasets

        if (socket) {
            socket.emit('status',
                debugMode ?
                'Starting ADAPTIVE matching with debug mode...' :
                'Starting ADAPTIVE matching with strict validation...'
            );
        }

        // Use adaptive matching algorithm (same as linear but with extra validation)
        const matches = await adaptiveMatcher.processMatchingLinear(secFiles, socket, debugMode);

        console.log(`\n🎉 ADAPTIVE MATCHING COMPLETE:`);
        console.log(`- Total matches found: ${matches.length}`);
        console.log(`- Note: Matches filtered with adaptive rules (space boundaries, context checks)`);

        // Break down by match type
        const matchStats = {
            'Name + Company': matches.filter(m => m.match_type === 'Name + Company').length,
            'Name Only': matches.filter(m => m.match_type === 'Name Only').length,
            'Company Only': matches.filter(m => m.match_type === 'Company Only').length
        };

        console.log(`- Match breakdown: Name+Company: ${matchStats['Name + Company']}, Name Only: ${matchStats['Name Only']}, Company Only: ${matchStats['Company Only']}`);

        if (socket) socket.emit('status', 'Generating CSV file...');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = path.join('uploads', `adaptive_matches_${timestamp}.csv`);
        await adaptiveMatcher.exportToCsv(outputPath, debugMode);

        if (socket) {
            socket.emit('complete', {
                matches: matches.length,
                matchStats: matchStats,
                message: 'Adaptive matching completed successfully!'
            });
        }

        // Cleanup uploaded files
        [prospectsFile, ...secFiles].forEach(file => {
            try {
                if (file && file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (error) {
                console.error('Error deleting temporary file:', error);
            }
        });

        res.json({
            success: true,
            message: `Adaptive matching completed successfully!`,
            matches: matches.length,
            matchStats: matchStats,
            algorithm: 'Adaptive Aho-Corasick with Strict Validation',
            downloadUrl: `/download/${path.basename(outputPath)}`
        });

        // Clear the current matcher reference
        currentMatcher = null;

    } catch (error) {
        console.error('Adaptive matching error:', error);
        if (socket) socket.emit('error', error.message);
        res.status(500).json({
            success: false,
            error: 'Error processing files with adaptive matcher: ' + error.message
        });

        // Clear the current matcher reference
        currentMatcher = null;
    }
});

// AUTO-CHUNKED LINEAR MATCHING - Handles large prospect datasets automatically
app.post('/match-linear-chunked', upload.fields([
    { name: 'prospects', maxCount: 1 },
    { name: 'secFiles', maxCount: 10000 }
]), async (req, res) => {
    const socket = Array.from(io.sockets.sockets.values())[0];

    try {
        const prospectsFile = req.files['prospects']?.[0];
        const secFiles = req.files['secFiles'] || [];

        if (!prospectsFile || secFiles.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please upload both prospects CSV file and SEC filing files'
            });
        }

        console.log(`📦 AUTO-CHUNKED LINEAR MATCHING: Processing ${secFiles.length} SEC files...`);
        if (socket) {
            socket.emit('status', 'Loading prospects for auto-chunked processing...');
        }

        // Create linear matcher
        const linearMatcher = new LinearMatcher();
        currentMatcher = linearMatcher;

        // Load prospects
        await linearMatcher.loadProspects(prospectsFile.path);
        console.log(`📋 Loaded ${linearMatcher.prospects.length} prospects for auto-chunked processing`);

        if (socket) {
            socket.emit('status', `Loaded ${linearMatcher.prospects.length} prospects. Starting auto-chunked processing...`);
        }

        // Use the new chunked processing method
        const matches = await linearMatcher.processMatchingLinearChunked(secFiles, socket, true);

        // Calculate match statistics
        const matchStats = {
            'Name + Company': 0,
            'Name Only': 0,
            'Company Only': 0
        };

        matches.forEach(match => {
            if (matchStats[match.match_type] !== undefined) {
                matchStats[match.match_type]++;
            }
        });

        // Export results
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = path.join('uploads', `linear_chunked_matches_${timestamp}.csv`);
        await linearMatcher.exportToCsv(outputPath, true);

        if (socket) {
            socket.emit('complete', {
                matches: matches.length,
                matchStats: matchStats,
                message: 'Auto-chunked linear matching completed successfully!'
            });
        }

        // Cleanup uploaded files
        [prospectsFile, ...secFiles].forEach(file => {
            try {
                if (file && file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (error) {
                console.error('Error deleting temporary file:', error);
            }
        });

        res.json({
            success: true,
            message: `Auto-chunked linear matching completed successfully!`,
            matches: matches.length,
            matchStats: matchStats,
            algorithm: 'Auto-Chunked Linear Aho-Corasick (15K chunks)',
            downloadUrl: `/download/${path.basename(outputPath)}`
        });

        // Clear the current matcher reference
        currentMatcher = null;

    } catch (error) {
        console.error('Auto-chunked linear matching error:', error);
        if (socket) socket.emit('error', error.message);
        res.status(500).json({
            success: false,
            error: 'Error processing files with auto-chunked linear matcher: ' + error.message
        });

        // Clear the current matcher reference
        currentMatcher = null;
    }
});

// DATABASE MATCHING ENDPOINT - Scalable approach for unlimited prospects
app.post('/match-database', upload.fields([
    { name: 'prospects', maxCount: 1 },
    { name: 'secFiles', maxCount: 10000 }
]), async (req, res) => {
    const socket = Array.from(io.sockets.sockets.values())[0];

    try {
        const prospectsFile = req.files['prospects']?.[0];
        const secFiles = req.files['secFiles'] || [];

        if (!prospectsFile || secFiles.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please upload both prospects CSV file and SEC filing files'
            });
        }

        console.log(`🗄️ DATABASE MATCHING: Processing ${secFiles.length} SEC files with scalable approach...`);

        console.log('🔧 Creating DatabaseMatcher instance...');
        // Create database matcher
        const databaseMatcher = new DatabaseMatcher();
        currentMatcher = databaseMatcher;

        console.log('🔧 Initializing SQLite database...');
        // Initialize SQLite database
        await databaseMatcher.initialize();
        console.log('✅ Database initialization complete');

        if (socket) {
            socket.emit('status', 'Indexing prospects in database...');
        }

        // Index all prospects in database (handles unlimited size)
        await databaseMatcher.indexProspects(prospectsFile.path, socket);
        console.log(`📊 Indexed ${databaseMatcher.totalProspects} prospects with variations`);

        if (socket) {
            socket.emit('status', `Processing ${secFiles.length} SEC files with database queries...`);
        }

        // Process SEC files using database-driven matching
        const totalMatches = await databaseMatcher.processSecFiles(secFiles, socket);

        console.log(`🎉 DATABASE MATCHING COMPLETE:`);
        console.log(`- Total prospects indexed: ${databaseMatcher.totalProspects}`);
        console.log(`- Total matches found: ${totalMatches}`);
        console.log(`- Memory usage: Constant (~500MB) regardless of prospect count`);

        if (socket) {
            socket.emit('complete', {
                matches: totalMatches,
                message: 'Database matching completed successfully!',
                algorithm: 'SQLite Database-First Architecture'
            });
        }

        // Cleanup uploaded files
        [prospectsFile, ...secFiles].forEach(file => {
            try {
                if (file && file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (error) {
                console.error('Error deleting temporary file:', error);
            }
        });

        res.json({
            success: true,
            message: `Database matching completed successfully!`,
            matches: totalMatches,
            algorithm: 'SQLite Database-First (Unlimited Scale)',
            scalability: `Handles ${databaseMatcher.totalProspects.toLocaleString()} prospects with constant memory`,
            downloadUrl: `/download-database-matches`
        });

        // Clean up database
        await databaseMatcher.cleanup();
        currentMatcher = null;

    } catch (error) {
        console.error('Database matching error:', error);
        if (socket) socket.emit('error', error.message);
        res.status(500).json({
            success: false,
            error: 'Error processing files with database matcher: ' + error.message
        });

        // Clean up database and current matcher reference
        if (currentMatcher) {
            try {
                await currentMatcher.cleanup();
            } catch (e) {
                console.error('Error cleaning up database:', e);
            }
        }
        currentMatcher = null;
    }
});

// Download database matches
app.get('/download-database-matches', (req, res) => {
    const filepath = path.join(__dirname, 'database_matches.csv');

    if (fs.existsSync(filepath)) {
        const filename = `database_matches_${Date.now()}.csv`;
        res.download(filepath, filename, (err) => {
            if (err) {
                console.error('Database matches download error:', err);
                res.status(500).json({ error: 'Download failed' });
            } else {
                console.log(`📄 Database matches downloaded: ${filename}`);
                // Clean up file after download
                setTimeout(() => {
                    try {
                        fs.unlinkSync(filepath);
                    } catch (e) {
                        console.error('Error deleting database matches file:', e);
                    }
                }, 5000);
            }
        });
    } else {
        res.status(404).json({ error: 'Database matches file not found' });
    }
});

app.post('/stop-export', async (req, res) => {
    try {
        if (!currentMatcher) {
            return res.status(400).json({
                success: false,
                error: 'No processing currently in progress'
            });
        }

        // Get current matches from the matcher
        const currentMatches = currentMatcher.matches || [];
        const deduplicatedMatches = currentMatcher.deduplicateMatches(currentMatches);

        if (deduplicatedMatches.length === 0) {
            return res.status(200).json({
                success: false,
                error: 'No matches found yet to export'
            });
        }

        // Create export filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `stopped_export_${deduplicatedMatches.length}_matches_${timestamp}.csv`;
        const filepath = path.join('uploads', filename);

        // Temporarily set matches for export
        const originalMatches = currentMatcher.matches;
        currentMatcher.matches = deduplicatedMatches;

        // Export to CSV
        await currentMatcher.exportToCsv(filepath);

        // Restore original matches
        currentMatcher.matches = originalMatches;

        console.log(`🛑 Stop & Export: ${deduplicatedMatches.length} matches exported to ${filename}`);

        res.json({
            success: true,
            message: `Processing stopped and ${deduplicatedMatches.length} matches exported successfully`,
            matches: deduplicatedMatches.length,
            downloadUrl: `/download/${filename}`
        });

        // Clear the current matcher reference
        currentMatcher = null;

    } catch (error) {
        console.error('Stop & Export error:', error);
        res.status(500).json({
            success: false,
            error: 'Error during stop & export: ' + error.message
        });
    }
});

// Checkpoint management endpoints
app.get('/checkpoints', async (req, res) => {
    try {
        const checkpoints = await ProspectMatcher.listAvailableCheckpoints();
        res.json({
            success: true,
            checkpoints
        });
    } catch (error) {
        console.error('Error listing checkpoints:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list checkpoints'
        });
    }
});

app.post('/resume/:sessionId', upload.fields([
    { name: 'prospects', maxCount: 1 },
    { name: 'secFiles', maxCount: 10000 }
]), async (req, res) => {
    const socket = Array.from(io.sockets.sockets.values())[0];

    try {
        const { sessionId } = req.params;

        const matcher = new ProspectMatcher();
        currentMatcher = matcher;

        // Load checkpoint data
        const resumeData = await matcher.loadCheckpoint(sessionId);
        if (!resumeData) {
            return res.status(404).json({
                success: false,
                error: 'Checkpoint not found'
            });
        }

        console.log(`Resuming processing from checkpoint: ${sessionId}`);
        if (socket) {
            socket.emit('status', `Loading checkpoint ${sessionId}...`);
        }

        const debugMode = false;
        const matches = await matcher.processMatchingParallel([], socket, debugMode, resumeData);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `matches_resumed_${matches.length}_${timestamp}.csv`;
        const outputPath = path.join('uploads', filename);

        await matcher.exportToCsv(outputPath, true);

        if (socket) {
            socket.emit('complete', {
                matches: matches.length,
                message: 'Resume processing completed successfully!'
            });
        }

        res.json({
            success: true,
            message: `Resume processing completed successfully!`,
            matches: matches.length,
            downloadUrl: `/download/${filename}`
        });

        currentMatcher = null;

    } catch (error) {
        console.error('Resume processing error:', error);
        if (socket) socket.emit('error', error.message);
        res.status(500).json({
            success: false,
            error: 'Error during resume processing: ' + error.message
        });

        currentMatcher = null;
    }
});

app.delete('/checkpoints/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const success = await ProspectMatcher.deleteCheckpoint(sessionId);

        if (success) {
            res.json({
                success: true,
                message: 'Checkpoint deleted successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Checkpoint not found'
            });
        }
    } catch (error) {
        console.error('Error deleting checkpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete checkpoint'
        });
    }
});

app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join('uploads', filename);

    if (fs.existsSync(filepath)) {
        res.download(filepath, (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            setTimeout(() => {
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    console.error('Error deleting file:', e);
                }
            }, 5000);
        });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Download individual chunk CSV files
app.get('/download-chunk/:chunkNumber', (req, res) => {
    const chunkNumber = req.params.chunkNumber;
    const LinearMatcher = require('./LinearMatcher');
    const chunkFile = path.join(__dirname, 'temp_chunks', `chunk_${chunkNumber}.csv`);

    if (fs.existsSync(chunkFile)) {
        const filename = `matches_chunk_${chunkNumber}.csv`;
        res.download(chunkFile, filename, (err) => {
            if (err) {
                console.error('Chunk download error:', err);
                res.status(500).json({ error: 'Download failed' });
            } else {
                console.log(`📄 Chunk ${chunkNumber} downloaded: ${filename}`);
            }
        });
    } else {
        res.status(404).json({ error: `Chunk ${chunkNumber} not found` });
    }
});

// Clean up chunk files when final CSV is downloaded
app.get('/cleanup-chunks', (req, res) => {
    const LinearMatcher = require('./LinearMatcher');
    const matcher = new LinearMatcher();
    matcher.cleanupChunkFiles();
    res.json({ message: 'Chunk files cleaned up' });
});

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

server.listen(PORT, () => {
    console.log(`🚀 SEC Prospect Matcher running at http://localhost:${PORT}`);
    console.log('📊 Upload your prospect CSV and SEC filing .txt files to start matching!');
});

module.exports = { app, ProspectMatcher };
