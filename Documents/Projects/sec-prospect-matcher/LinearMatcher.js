const AhoCorasick = require('ahocorasick');
const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
const csvParser = require('csv-parser');

/**
 * LINEAR PROSPECT MATCHER - Implements GPT-5's Aho-Corasick approach
 *
 * Key Advantages:
 * - O(files × content) complexity instead of O(prospects × files × content)
 * - Memory efficient with bitsets and streaming
 * - Single pass per file finds ALL prospects simultaneously
 * - Support for 3 match types: name, company, name+company
 */
class LinearMatcher {
    constructor() {
        this.prospects = [];
        this.automaton = null;
        this.patternMap = new Map(); // pattern -> {type: 'name'|'company', prospectIds: [...]}
        this.matches = [];
    }

    async loadProspects(filePath) {
        return new Promise((resolve, reject) => {
            const prospects = [];
            fs.createReadStream(filePath)
                .pipe(require('csv-parser')())
                .on('data', (row) => {
                    const prospectId = row.prospect_id || row['prospect_id'] || row.id;
                    const prospectName = row.prospect_name || row['prospect_name'] || row.name;
                    const companyName = row.company_name || row['company_name'] || row.company;

                    if (prospectId && prospectName && companyName) {
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

    /**
     * MEMORY-OPTIMIZED text normalization - reduces string allocations
     */
    normalizeText(text) {
        if (!text) return '';

        // Process in smaller chunks to reduce memory pressure
        const MAX_CHUNK_SIZE = 1024 * 1024; // 1MB chunks for normalization
        if (text.length > MAX_CHUNK_SIZE) {
            let result = '';
            for (let i = 0; i < text.length; i += MAX_CHUNK_SIZE) {
                const chunk = text.slice(i, i + MAX_CHUNK_SIZE);
                result += this.normalizeTextChunk(chunk);
                if (i > 0 && global.gc) global.gc(); // Trigger GC if available
            }
            return result;
        }

        return this.normalizeTextChunk(text);
    }

    normalizeTextChunk(text) {
        return text
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
            .replace(/[^\w\s]/g, ' ') // Remove punctuation
            .replace(/\s+/g, ' ') // Collapse spaces
            .trim();
    }

    /**
     * Generate name patterns: First + Last adjacent OR with single initial between
     * No partial matches (no individual words)
     */
    generateNamePatterns(fullName) {
        const variations = [];
        const normalized = this.normalizeText(fullName);
        const tokens = normalized.split(' ').filter(t => t.length > 0);

        if (tokens.length < 2) return []; // Need at least first and last name

        const firstName = tokens[0];
        const lastName = tokens[tokens.length - 1];

        if (firstName.length < 2 || lastName.length < 2) return [];

        // Pattern 1: Exact "First Last" (adjacent)
        variations.push({
            text: `${firstName} ${lastName}`,
            type: 'first_last_exact',
            firstName: firstName,
            lastName: lastName
        });

        // Pattern 2: "First Last" with single initial between (e.g., "Swajan K. Jain")
        // We'll store this metadata and check dynamically during matching
        variations.push({
            text: `${firstName} ${lastName}`,
            type: 'first_last_with_initial',
            firstName: firstName,
            lastName: lastName,
            allowInitial: true
        });

        return variations;
    }

    /**
     * Generate company patterns: Normalize root by stripping suffixes
     * Then match with word boundaries
     */
    generateCompanyPatterns(companyName) {
        const variations = [];
        const normalized = this.normalizeText(companyName);

        if (!normalized || normalized.length < 3) return [];

        // Remove common legal suffixes to get root company name
        const root = normalized
            .replace(/\b(inc|incorporated|corp|corporation|company|co|llc|ltd|limited|plc|lp|l p)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (root.length < 3) return [];

        // Main pattern: normalized root (matches "PNC" or "PNC Capital Markets")
        variations.push({
            text: root,
            type: 'company_root'
        });

        return variations;
    }

    /**
     * Build Aho-Corasick automaton with ALL patterns (names + companies)
     * This is the key optimization - we scan for ALL patterns in one pass
     */
    buildAutomaton() {
        console.log(`Building linear automaton for ${this.prospects.length} prospects...`);

        const allPatterns = [];
        this.patternMap.clear();

        for (const prospect of this.prospects) {
            // Generate name patterns (returns variation objects)
            const nameVariations = this.generateNamePatterns(prospect.name);
            nameVariations.forEach(variation => {
                const pattern = variation.text;
                if (!this.patternMap.has(pattern)) {
                    this.patternMap.set(pattern, {
                        type: 'name',
                        prospectIds: [],
                        variations: [] // Store variation metadata
                    });
                    allPatterns.push(pattern);
                }
                const patternInfo = this.patternMap.get(pattern);
                patternInfo.prospectIds.push(prospect.id);
                patternInfo.variations.push({
                    prospectId: prospect.id,
                    ...variation
                });
            });

            // Generate company patterns (returns variation objects)
            const companyVariations = this.generateCompanyPatterns(prospect.company);
            companyVariations.forEach(variation => {
                const pattern = variation.text;
                if (!this.patternMap.has(pattern)) {
                    this.patternMap.set(pattern, {
                        type: 'company',
                        prospectIds: [],
                        variations: []
                    });
                    allPatterns.push(pattern);
                }
                const patternInfo = this.patternMap.get(pattern);
                patternInfo.prospectIds.push(prospect.id);
                patternInfo.variations.push({
                    prospectId: prospect.id,
                    ...variation
                });
            });
        }

        // Build the automaton with all patterns
        this.automaton = new AhoCorasick(allPatterns);

        console.log(`Automaton built with ${allPatterns.length} total patterns`);
        console.log(`Pattern breakdown: ${this.getPatternStats()}`);

        return this.automaton;
    }

    getPatternStats() {
        let nameCount = 0;
        let companyCount = 0;

        for (const [pattern, info] of this.patternMap) {
            if (info.type === 'name') nameCount++;
            if (info.type === 'company') companyCount++;
        }

        return `Names: ${nameCount}, Companies: ${companyCount}`;
    }

    /**
     * Enhanced word boundary check (using my earlier fix)
     */
    hasValidWordBoundaries(text, match) {
        const { start, end } = match;
        const beforeChar = start > 0 ? text[start - 1] : '';
        const afterChar = end < text.length ? text[end] : '';

        // Word boundary characters
        const boundaryRegex = /[\s\.,;:!?\-\(\)\[\]{}"\'/\\|~`@#$%^&*+=<>]/;
        const isNumber = /[0-9]/;
        const isLetter = /[a-zA-Z]/;

        const beforeIsBoundary = !beforeChar || boundaryRegex.test(beforeChar) ||
                                (isNumber.test(beforeChar) && isLetter.test(text[start]));

        const afterIsBoundary = !afterChar || boundaryRegex.test(afterChar) ||
                               (isLetter.test(text[end - 1]) && isNumber.test(afterChar));

        return beforeIsBoundary && afterIsBoundary;
    }

    /**
     * LINEAR FILE PROCESSING - The core GPT-5 optimization
     * Process each file exactly once, finding all prospects simultaneously
     */
    async processFileLinear(filePath, filename, debugMode = false) {
        return new Promise((resolve) => {
            try {
                const stats = fs.statSync(filePath);
                const fileSizeBytes = stats.size;
                const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
                const OVERLAP_SIZE = 2000; // Overlap for boundary matches

                if (debugMode) {
                    console.log(`\n📄 LINEAR PROCESSING: ${filename}`);
                    console.log(`File size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
                }

                // Track hits per prospect in this file - LAZY INITIALIZATION for memory efficiency
                const prospectHits = new Map(); // prospect_id -> {nameHit: boolean, companyHit: boolean, contexts: [...]}

                let processedBytes = 0;
                let previousOverlap = '';

                // Stream processing
                const stream = fs.createReadStream(filePath, {
                    encoding: 'utf8',
                    highWaterMark: CHUNK_SIZE
                });

                stream.on('data', (chunk) => {
                    try {
                        const searchText = previousOverlap + chunk;
                        const normalizedText = this.normalizeText(searchText);

                        // CORE OPTIMIZATION: Find ALL patterns in ONE PASS
                        const matches = this.automaton.search(normalizedText);

                        // Process each match found
                        matches.forEach(([endIndex, matchedPatterns]) => {
                            // Note: Aho-Corasick returns [endIndex, [pattern1, pattern2, ...]]
                            matchedPatterns.forEach(pattern => {
                                const startIndex = endIndex - pattern.length + 1;
                                const patternInfo = this.patternMap.get(pattern);

                                if (!patternInfo) return;

                                // Enhanced boundary check
                                const matchInfo = {
                                    start: startIndex,
                                    end: endIndex + 1,
                                    pattern: pattern
                                };

                                if (!this.hasValidWordBoundaries(normalizedText, matchInfo)) {
                                    return; // Skip invalid boundary matches
                                }

                                // Record hits for each prospect's specific variation
                                patternInfo.variations.forEach(variation => {
                                    const prospectId = variation.prospectId;

                                    // LAZY INITIALIZATION: Create entry only when we find a match
                                    let hit = prospectHits.get(prospectId);
                                    if (!hit) {
                                        hit = {
                                            nameHit: false,
                                            companyHit: false,
                                            contexts: []
                                        };
                                        prospectHits.set(prospectId, hit);
                                    }

                                    // For name patterns, check if it's "First Last" with optional initial
                                    if (patternInfo.type === 'name' && variation.allowInitial) {
                                        // Check if match is "First Last" (exact adjacent)
                                        const matchText = normalizedText.slice(startIndex, endIndex + 1);
                                        const firstName = variation.firstName;
                                        const lastName = variation.lastName;

                                        // Build regex: \bFirst\s+(?:[a-z]\.?\s+)?Last\b
                                        const escapedFirst = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                        const escapedLast = lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                        const nameRegex = new RegExp(
                                            `\\b${escapedFirst}\\s+(?:[a-z]\\.?\\s+)?${escapedLast}\\b`,
                                            'i'
                                        );

                                        // Check if the pattern appears in the surrounding context
                                        const contextStart = Math.max(0, startIndex - 10);
                                        const contextEnd = Math.min(normalizedText.length, endIndex + 20);
                                        const contextText = normalizedText.slice(contextStart, contextEnd);

                                        if (!nameRegex.test(contextText)) {
                                            return; // Not a valid "First [Initial] Last" match
                                        }
                                    }

                                    // Record the match type
                                    if (patternInfo.type === 'name') {
                                        hit.nameHit = true;
                                    } else if (patternInfo.type === 'company') {
                                        hit.companyHit = true;
                                    }

                                    // AGGRESSIVE MEMORY OPTIMIZATION for massive datasets: Only 1 context, smaller size
                                    if (hit.contexts.length < 1) { // Max 1 context per prospect (reduced from 3)
                                        const contextStart = Math.max(0, startIndex - 20); // Reduced context size
                                        const contextEnd = Math.min(normalizedText.length, endIndex + 20);
                                        const context = normalizedText.slice(contextStart, contextEnd);

                                        hit.contexts.push({
                                            pattern: pattern,
                                            type: patternInfo.type,
                                            context: context.length > 60 ? context.slice(0, 60) + '...' : context, // Smaller context
                                            position: startIndex + processedBytes
                                        });
                                    }
                                });
                            });
                        });

                        // Prepare overlap for next chunk
                        if (searchText.length > OVERLAP_SIZE) {
                            previousOverlap = searchText.slice(-OVERLAP_SIZE);
                        }

                    } catch (error) {
                        console.error(`Memory error in chunk processing:`, error.message);
                        // Continue processing despite errors
                    }

                    processedBytes += chunk.length;
                });

                stream.on('end', () => {
                    // Generate matches based on hit combinations
                    const fileMatches = this.generateMatchResults(filename, prospectHits);

                    if (debugMode) {
                        console.log(`✅ Found ${fileMatches.length} matches in ${filename}`);
                        this.debugMatchStats(fileMatches);
                    }

                    resolve(fileMatches);
                });

                stream.on('error', (error) => {
                    console.error(`Error processing ${filePath}:`, error);
                    resolve([]);
                });

            } catch (error) {
                console.error(`Error in processFileLinear for ${filePath}:`, error);
                resolve([]);
            }
        });
    }

    /**
     * Generate the 3 types of matches based on hit patterns
     */
    generateMatchResults(filename, prospectHits) {
        const matches = [];

        for (const [prospectId, hits] of prospectHits) {
            const prospect = this.prospects.find(p => p.id === prospectId);
            if (!prospect) continue;

            const secUrl = this.createSECUrl(filename);
            const baseMatch = {
                prospect_id: prospectId,
                prospect_name: prospect.name,
                company_name: prospect.company,
                sec_filing: filename,
                sec_url: secUrl || `file://${path.resolve(filename)}`,
                match_date: new Date().toISOString().split('T')[0]
            };

            // Type 1: Name + Company Match (Highest Priority/Confidence)
            if (hits.nameHit && hits.companyHit) {
                matches.push({
                    ...baseMatch,
                    match_type: 'Name + Company',
                    confidence: 95,
                    contexts: hits.contexts.slice(0, 3) // Limit context for performance
                });
            }
            // Type 2: Name Only Match
            else if (hits.nameHit) {
                matches.push({
                    ...baseMatch,
                    match_type: 'Name Only',
                    confidence: 75,
                    contexts: hits.contexts.filter(c => c.type === 'name').slice(0, 2)
                });
            }
            // Type 3: Company Only Match - DISABLED for memory efficiency
            // Only keeping high-quality Name and Name+Company matches
            // else if (hits.companyHit) {
            //     matches.push({
            //         ...baseMatch,
            //         match_type: 'Company Only',
            //         confidence: 60,
            //         contexts: hits.contexts.filter(c => c.type === 'company').slice(0, 2)
            //     });
            // }
        }

        return matches;
    }

    debugMatchStats(matches) {
        const stats = {
            'Name + Company': 0,
            'Name Only': 0,
            'Company Only': 0
        };

        matches.forEach(match => {
            stats[match.match_type]++;
        });

        console.log(`   Match breakdown: Name+Company: ${stats['Name + Company']}, Name: ${stats['Name Only']}, Company: ${stats['Company Only']}`);
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

            // Try multiple URL patterns - SEC has different endpoints
            const urls = [
                // Primary EDGAR Archives URL
                `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionNumber}.txt`,
                // Alternative: SEC search by CIK (always works)
                `https://www.sec.gov/search-filings?cik=${numericCik}`,
                // Alternative: EDGAR browse by CIK
                `https://www.sec.gov/edgar/browse/?CIK=${numericCik}&owner=exclude`
            ];

            // Return the primary URL, but could be enhanced to validate or return alternatives
            return urls[0];
        }
        return null;
    }

    /**
     * AUTO-CHUNKED LINEAR PROCESSING - Handles large prospect datasets automatically
     * Breaks prospects into 15K chunks and processes each chunk against all SEC files
     */
    async processMatchingLinearChunked(secFiles, socket, debugMode = false) {
        const CHUNK_SIZE = 50000; // 50K prospects per chunk (adjusted for M1 8GB)
        const totalProspects = this.prospects.length;
        const totalChunks = Math.ceil(totalProspects / CHUNK_SIZE);

        console.log(`\n🚀 AUTO-CHUNKED LINEAR MATCHING: ${totalProspects} prospects × ${secFiles.length} files`);
        console.log(`📦 Processing in ${totalChunks} chunks of ${CHUNK_SIZE} prospects each`);

        const overallStartTime = Date.now();
        let allMatches = [];
        let totalCandidatesChecked = 0;

        // Process each chunk of prospects
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const chunkStart = chunkIndex * CHUNK_SIZE;
            const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalProspects);
            const chunkProspects = this.prospects.slice(chunkStart, chunkEnd);

            console.log(`\n📦 CHUNK ${chunkIndex + 1}/${totalChunks}: Processing prospects ${chunkStart + 1}-${chunkEnd} (${chunkProspects.length} prospects)`);

            if (socket) {
                socket.emit('status', `Processing chunk ${chunkIndex + 1}/${totalChunks}: ${chunkProspects.length} prospects`);
                socket.emit('chunk-progress', {
                    currentChunk: chunkIndex + 1,
                    totalChunks: totalChunks,
                    prospectsInChunk: chunkProspects.length,
                    totalMatches: allMatches.length
                });
            }

            // Create a temporary LinearMatcher for this chunk
            const chunkMatcher = new LinearMatcher();
            chunkMatcher.prospects = chunkProspects;

            // Process this chunk against all SEC files
            const chunkMatches = await chunkMatcher.processMatchingLinear(secFiles, socket, debugMode);

            // STREAMING: Write chunk results to disk immediately instead of accumulating in memory
            if (chunkMatches.length > 0) {
                const chunkFile = await this.writeChunkToCSV(chunkMatches, chunkIndex, chunkIndex === 0);
                console.log(`💾 Chunk ${chunkIndex + 1} results written to disk: ${chunkMatches.length} matches`);

                // Emit chunk completion for immediate download
                if (socket) {
                    socket.emit('chunk-complete', {
                        chunkNumber: chunkIndex + 1,
                        totalChunks: totalChunks,
                        matchCount: chunkMatches.length,
                        downloadUrl: `/download-chunk/${chunkIndex + 1}`,
                        fileName: `matches_chunk_${chunkIndex + 1}.csv`
                    });
                }
            }

            totalCandidatesChecked += chunkProspects.length * secFiles.length;

            console.log(`✅ Chunk ${chunkIndex + 1}/${totalChunks} completed: ${chunkMatches.length} matches found`);

            // Clear chunk matches immediately to free memory
            const chunkMatchCount = chunkMatches.length;
            chunkMatches.length = 0;

            // Memory cleanup between chunks
            if (global.gc) {
                console.log(`🧹 Memory cleanup after chunk ${chunkIndex + 1}...`);
                global.gc();
            }

            // Brief pause between chunks
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Combine all chunk CSV files into final result
        console.log(`\n📄 Combining chunk results into final CSV...`);
        const finalMatches = await this.combineChunkCSVs(totalChunks, false); // Don't delete chunk files yet
        const totalMatchesCount = finalMatches.length;

        // Store final results (but keep memory light)
        this.matches = finalMatches;

        const totalTime = Date.now() - overallStartTime;
        console.log(`\n🎉 AUTO-CHUNKED STREAMING PROCESSING COMPLETE:`);
        console.log(`- Total time: ${(totalTime / 1000).toFixed(1)}s`);
        console.log(`- Total chunks processed: ${totalChunks}`);
        console.log(`- Total prospects: ${totalProspects}`);
        console.log(`- Files processed: ${secFiles.length}`);
        console.log(`- Total matches: ${totalMatchesCount}`);
        console.log(`- Average per chunk: ${Math.round(totalTime / totalChunks / 1000)}s`);
        console.log(`💾 Results ready for download as CSV`);

        return finalMatches;
    }

    /**
     * Main processing method - LINEAR COMPLEXITY
     */
    async processMatchingLinear(secFiles, socket, debugMode = false) {
        console.log(`\n🚀 LINEAR MATCHING: ${this.prospects.length} prospects × ${secFiles.length} files`);

        // Build automaton once (O(prospects))
        this.buildAutomaton();

        const overallStartTime = Date.now();
        let allMatches = [];
        let totalCandidatesChecked = 0;

        // MEMORY-OPTIMIZED: Process files in batches with garbage collection
        const BATCH_SIZE = 50; // Process 50 files then clean up memory

        for (let i = 0; i < secFiles.length; i++) {
            const secFile = secFiles[i];
            const startTime = Date.now();

            if (socket) {
                const progress = Math.floor(((i + 1) / secFiles.length) * 100);
                socket.emit('status', `Linear processing: ${i + 1}/${secFiles.length} files`);
                socket.emit('progress', {
                    progress,
                    current: i + 1,
                    total: secFiles.length,
                    file: secFile.originalname,
                    matches: allMatches.length
                });
            }

            try {
                const fileMatches = await this.processFileLinear(
                    secFile.path,
                    secFile.originalname,
                    debugMode
                );

                allMatches.push(...fileMatches);
                totalCandidatesChecked += this.prospects.length;

                const processingTime = Date.now() - startTime;
                console.log(`File ${i + 1}/${secFiles.length}: ${secFile.originalname} - ${fileMatches.length} matches (${processingTime}ms)`);

                // AGGRESSIVE MEMORY MANAGEMENT for massive datasets
                if ((i + 1) % BATCH_SIZE === 0) {
                    console.log(`\n🧹 Memory cleanup after ${i + 1} files...`);

                    // Clear contexts from matches to free memory
                    allMatches.forEach(match => {
                        if (match.contexts && match.contexts.length > 0) {
                            match.contexts = [match.contexts[0]]; // Keep only first context
                        }
                    });

                    if (global.gc) {
                        global.gc();
                        console.log(`Memory freed. Continuing with remaining ${secFiles.length - i - 1} files.`);
                    }

                    // Brief pause to let memory settle
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

            } catch (error) {
                console.error(`Error processing file ${secFile.originalname}:`, error.message);
                // Continue with next file
            }
        }

        const totalTime = Date.now() - overallStartTime;

        console.log(`\n🎉 LINEAR PROCESSING COMPLETE:`);
        console.log(`- Total time: ${(totalTime / 1000).toFixed(1)}s`);
        console.log(`- Files processed: ${secFiles.length}`);
        console.log(`- Average per file: ${Math.round(totalTime / secFiles.length)}ms`);
        console.log(`- Total matches: ${allMatches.length}`);
        console.log(`- Complexity achieved: O(files × content) instead of O(prospects × files × content)`);

        // Deduplicate matches (same prospect + file should have only highest confidence match)
        const deduplicatedMatches = this.deduplicateMatches(allMatches);
        console.log(`- After deduplication: ${deduplicatedMatches.length} unique matches`);

        this.matches = deduplicatedMatches;
        return deduplicatedMatches;
    }

    deduplicateMatches(matches) {
        const seen = new Map(); // key: "prospectId:filename"

        for (const match of matches) {
            const key = `${match.prospect_id}:${match.sec_filing}`;
            const existing = seen.get(key);

            // Keep the match with highest confidence, or if tied, prefer Name+Company
            if (!existing || match.confidence > existing.confidence ||
                (match.confidence === existing.confidence && match.match_type === 'Name + Company')) {
                seen.set(key, match);
            }
        }

        return Array.from(seen.values())
            .sort((a, b) => {
                // Sort by confidence desc, then by match type priority
                if (b.confidence !== a.confidence) return b.confidence - a.confidence;

                const typeOrder = { 'Name + Company': 3, 'Name Only': 2, 'Company Only': 1 };
                return typeOrder[b.match_type] - typeOrder[a.match_type];
            });
    }

    // Export methods (reuse existing CSV export logic)
    async exportToCsv(outputPath, includeDebugInfo = false) {
        const { createObjectCsvWriter } = require('csv-writer');

        const headers = [
            { id: 'prospect_id', title: 'Prospect ID' },
            { id: 'prospect_name', title: 'Prospect Name' },
            { id: 'company_name', title: 'Company Name' },
            { id: 'sec_filing', title: 'SEC Filing' },
            { id: 'sec_url', title: 'SEC URL' },
            { id: 'match_date', title: 'Match Date' },
            { id: 'match_type', title: 'Match Type' },
            { id: 'confidence', title: 'Confidence Score' }
        ];

        if (includeDebugInfo && this.matches.some(m => m.contexts)) {
            headers.push({ id: 'debug_contexts', title: 'Debug Contexts' });
        }

        const csvWriter = createObjectCsvWriter({
            path: outputPath,
            header: headers
        });

        // Prepare data for CSV
        const csvData = this.matches.map(match => {
            const data = { ...match };

            if (includeDebugInfo && match.contexts) {
                data.debug_contexts = JSON.stringify(match.contexts);
            }

            return data;
        });

        await csvWriter.writeRecords(csvData);
        return this.matches.length;
    }

    /**
     * STREAMING: Write chunk results to temporary CSV file
     */
    async writeChunkToCSV(chunkMatches, chunkIndex, includeHeader = false) {
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, 'temp_chunks');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const chunkFile = path.join(tempDir, `chunk_${chunkIndex + 1}.csv`);

        const headers = [
            { id: 'prospect_id', title: 'prospect_id' },
            { id: 'prospect_name', title: 'prospect_name' },
            { id: 'company_name', title: 'company_name' },
            { id: 'sec_filing', title: 'sec_filing' },
            { id: 'sec_url', title: 'sec_url' },
            { id: 'match_type', title: 'match_type' },
            { id: 'confidence', title: 'confidence' },
            { id: 'match_date', title: 'match_date' },
            { id: 'context_snippets', title: 'context_snippets' }
        ];

        const csvWriter = createObjectCsvWriter({
            path: chunkFile,
            header: headers
        });

        // Prepare CSV data
        const csvData = chunkMatches.map(match => ({
            ...match,
            context_snippets: match.contexts ?
                match.contexts.map(c => c.text).join(' | ') : ''
        }));

        await csvWriter.writeRecords(csvData);
        return chunkFile;
    }

    /**
     * STREAMING: Combine all chunk CSV files into final result
     */
    async combineChunkCSVs(totalChunks, deleteFiles = true) {
        const tempDir = path.join(__dirname, 'temp_chunks');
        const allMatches = [];

        // Read each chunk file sequentially to avoid memory spike
        for (let i = 1; i <= totalChunks; i++) {
            const chunkFile = path.join(tempDir, `chunk_${i}.csv`);

            if (fs.existsSync(chunkFile)) {
                const chunkMatches = await new Promise((resolve, reject) => {
                    const matches = [];
                    fs.createReadStream(chunkFile)
                        .pipe(csvParser())
                        .on('data', (row) => matches.push(row))
                        .on('end', () => resolve(matches))
                        .on('error', reject);
                });

                allMatches.push(...chunkMatches);

                // Optionally delete chunk file after reading
                if (deleteFiles) {
                    try {
                        fs.unlinkSync(chunkFile);
                    } catch (error) {
                        console.warn(`Warning: Could not delete chunk file ${chunkFile}`);
                    }
                }
            }
        }

        // Clean up temp directory only if deleting files
        if (deleteFiles) {
            try {
                fs.rmdirSync(tempDir);
            } catch (error) {
                console.warn(`Warning: Could not delete temp directory ${tempDir}`);
            }
        }

        console.log(`📊 Combined ${totalChunks} chunks into ${allMatches.length} total matches`);
        if (!deleteFiles) {
            console.log(`📁 Chunk files preserved in ${tempDir} for individual download`);
        }
        return allMatches;
    }

    /**
     * Clean up temporary chunk files (call after final download)
     */
    cleanupChunkFiles() {
        const tempDir = path.join(__dirname, 'temp_chunks');
        if (fs.existsSync(tempDir)) {
            try {
                const files = fs.readdirSync(tempDir);
                files.forEach(file => {
                    fs.unlinkSync(path.join(tempDir, file));
                });
                fs.rmdirSync(tempDir);
                console.log(`🧹 Cleaned up chunk files in ${tempDir}`);
            } catch (error) {
                console.warn(`Warning: Could not clean up chunk files: ${error.message}`);
            }
        }
    }
}

module.exports = LinearMatcher;