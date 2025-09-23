const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(cors());
app.use(express.static('.'));
app.use(express.json());

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
        // Use regex with word boundaries to find exact matches
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special chars
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        const matches = [];
        let match;

        while ((match = regex.exec(text)) !== null) {
            matches.push({
                position: match.index,
                text: match[0]
            });
        }

        return matches;
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
                if (distance < minDistance && distance <= 100) { // Reduced from 500 to 100 chars - very near
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

        return { nameToProspects, lastNameToProspects, companyToProspects };
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

        // Check EXACT company matching ONLY
        const companyMatchResult = this.checkExactCompanyMatch(prospect, originalText, debugMode);

        if (debugMode) {
            if (nameMatchResult) {
                console.log(`  ✅ Name MATCH: "${nameMatchResult.firstText}" + "${nameMatchResult.lastText}" (distance: ${nameMatchResult.distance} chars)`);
            } else {
                console.log(`  ❌ Name NOT matched - requires both first AND last name within 100 chars`);
            }

            if (companyMatchResult) {
                console.log(`  ✅ Company EXACT MATCH: "${companyMatchResult.matchedText}"`);
            } else {
                console.log(`  ❌ Company NOT matched - requires EXACT company name match only`);
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
                    console.log(`  ✅ PROXIMITY MATCH: Distance ${bestProximityMatch.distance} chars, Company EXACT`);
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

        // Type 3: Company-only match (EXACT only)
        if (companyMatchResult && !nameMatchResult) {
            const companyOnlyMatch = {
                match: true,
                matchType: 'Company Only (EXACT)',
                distance: 0,
                namePos: null,
                companyPos: companyMatchResult.positions[0],
                nameMatches: {},
                companyMatches: { [companyMatchResult.matchedText]: companyMatchResult.positions },
                baseConfidence: 70, // Good confidence for exact company matches
                companyScore: 100
            };

            if (debugMode && originalText) {
                companyOnlyMatch.nameContext = 'N/A - Company only match';
                companyOnlyMatch.companyContext = this.extractContext(originalText, companyMatchResult.positions[0]);
            }

            matches.push(companyOnlyMatch);
            if (debugMode) {
                console.log(`  ✅ COMPANY-ONLY EXACT MATCH`);
            }
        }

        if (matches.length === 0) {
            if (debugMode) {
                console.log(`  ❌ NO MATCHES: Missing valid name match (first+last within 100 chars) AND exact company match`);
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
                const content = fs.readFileSync(filePath, 'utf8');

                if (debugMode) {
                    console.log(`\n📄 PROCESSING FILE: ${filename}`);
                    console.log(`File size: ${content.length} characters`);
                }

                // Find candidate prospects
                const candidateProspects = new Set();
                const normalized = this.normalizeText(content);

                // Check for first names and last names separately
                for (const [firstName, prospects] of index.nameToProspects) {
                    if (normalized.includes(firstName)) {
                        prospects.forEach(p => candidateProspects.add(p));
                    }
                }

                for (const [lastName, prospects] of index.lastNameToProspects) {
                    if (normalized.includes(lastName)) {
                        prospects.forEach(p => candidateProspects.add(p));
                    }
                }

                // Check for exact company names
                for (const [companyVariation, prospects] of index.companyToProspects) {
                    if (normalized.includes(companyVariation)) {
                        prospects.forEach(p => candidateProspects.add(p));
                    }
                }

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
                            sec_url: secUrl || `file://${path.resolve(filePath)}`,
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
                console.error(`Error processing file ${filePath}:`, error);
                resolve({ matches: [], candidatesChecked: 0, totalTokens: 0 });
            }
        });
    }

    createSECUrl(filename) {
        const match = filename.match(/^(\d+)-(\d{2})-(\d+)\.txt$/);
        if (match) {
            const [, cik, year, sequence] = match;
            const paddedCik = cik.padStart(10, '0');
            const accessionNumber = `${paddedCik}-${year}-${sequence.padStart(6, '0')}`;
            return `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNumber.replace(/-/g, '')}.txt`;
        }
        return null;
    }

    async processMatchingOptimized(secFiles, socket, debugMode = false) {
        console.log(`Building inverted index for ${this.prospects.length} prospects...`);
        if (socket) socket.emit('status', 'Building search index...');

        const index = this.buildProspectIndex();
        console.log(`Index built: ${index.nameToProspects.size} first names, ${index.lastNameToProspects.size} last names, ${index.companyToProspects.size} company tokens`);

        const allMatches = [];
        const totalFiles = secFiles.length;
        let processedFiles = 0;
        let totalCandidatesChecked = 0;
        let totalProcessingTime = 0;
        const overallStartTime = Date.now();

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

            // Emit current file status
            if (socket) {
                socket.emit('status', `Processing file ${i + 1}/${totalFiles}: ${secFile.originalname}`);
            }

            const fileDebugMode = debugMode && secFile.originalname.includes('0001104659-25-088238');
            const result = await this.processFileOptimized(secFile.path, secFile.originalname, index, fileDebugMode);

            allMatches.push(...result.matches);
            totalCandidatesChecked += result.candidatesChecked;
            processedFiles++;

            const progress = Math.floor((processedFiles / totalFiles) * 100);
            const processingTime = Date.now() - startTime;
            totalProcessingTime += processingTime;
            const avgProcessingTime = Math.round(totalProcessingTime / processedFiles);

            // Calculate overall elapsed time
            const overallElapsed = Date.now() - overallStartTime;
            const overallAvgTimePerFile = Math.round(overallElapsed / processedFiles);

            if (socket) {
                const progressData = {
                    progress,
                    current: processedFiles,
                    total: totalFiles,
                    file: secFile.originalname,
                    matches: allMatches.length,
                    candidates: result.candidatesChecked,
                    tokens: result.totalTokens,
                    processingTime,
                    avgProcessingTime: overallAvgTimePerFile, // Use overall average for better ETA
                    filesRemaining: totalFiles - processedFiles,
                    overallElapsed: overallElapsed
                };

                console.log('Sending progress data:', progressData); // Debug log
                socket.emit('progress', progressData);
            }

            console.log(`File ${i + 1}/${totalFiles}: ${secFile.originalname} - ${result.matches.length} matches from ${result.candidatesChecked} candidates (${processingTime}ms)`);
        }

        console.log(`\nOptimized processing complete:`);
        console.log(`- Files processed: ${processedFiles}`);
        console.log(`- Total matches found: ${allMatches.length}`);
        console.log(`- Efficiency: ${((totalCandidatesChecked / (this.prospects.length * secFiles.length)) * 100).toFixed(2)}% of naive approach`);

        const deduplicatedMatches = this.deduplicateMatches(allMatches);
        console.log(`- After deduplication: ${deduplicatedMatches.length} unique matches`);

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

        if (socket) socket.emit('status', debugMode ? 'Starting DEBUG matching process...' : 'Starting optimized matching process...');
        const matches = await matcher.processMatchingOptimized(secFiles, socket, debugMode);
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

    } catch (error) {
        console.error('Matching error:', error);
        if (socket) socket.emit('error', error.message);
        res.status(500).json({
            success: false,
            error: 'Error processing files: ' + error.message
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

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

server.listen(PORT, () => {
    console.log(`🚀 SEC Prospect Matcher running at http://localhost:${PORT}`);
    console.log('📊 Upload your prospect CSV and SEC filing .txt files to start matching!');
});

module.exports = app;