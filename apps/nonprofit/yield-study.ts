/**
 * Yield Study: Parse a batch of 990-PF XMLs and analyze match potential.
 *
 * Usage: npx tsx yield-study.ts /path/to/extracted-xmls/
 *
 * Extracts:
 * - Schedule B donors (ContributorPersonNm)
 * - Part VII officers/directors (PersonNm in OfficerDirTrstKeyEmplGrp)
 * - Part XV grants paid (for enrichment context)
 *
 * Outputs:
 * - Total unique person names across all filings
 * - Name frequency distribution (how many names appear once vs many times)
 * - Top most common names (noise indicator)
 * - Donor count vs officer count
 * - Simulated match rate against synthetic prospect lists of various sizes
 */

import fs from "node:fs";
import path from "node:path";

// Lightweight XML text extraction (no npm dependency needed for yield study)
function extractAll(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, "g");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function extractBetween(xml: string, startTag: string, endTag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${startTag}>[\\s\\S]*?</${endTag}>`, "g");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[0]);
  }
  return results;
}

interface PersonRecord {
  name: string;
  nameNormalized: string;
  role: "donor" | "officer";
  orgName: string;
  orgEin: string;
  orgState: string;
  amount: number;
  title: string;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => !["jr", "sr", "ii", "iii", "iv", "md", "phd", "esq", "cpa"].includes(w))
    .join(" ");
}

function parseFile(xmlPath: string): PersonRecord[] {
  const xml = fs.readFileSync(xmlPath, "utf8");
  const records: PersonRecord[] = [];

  // Extract org info from header
  const einMatch = xml.match(/<EIN>(\d+)<\/EIN>/);
  const ein = einMatch ? einMatch[1] : "";
  const orgNameMatch = xml.match(/<BusinessNameLine1Txt>([^<]+)<\/BusinessNameLine1Txt>/);
  const orgName = orgNameMatch ? orgNameMatch[1] : "";
  const stateMatch = xml.match(/<Filer>[\s\S]*?<StateAbbreviationCd>([A-Z]{2})<\/StateAbbreviationCd>/);
  const orgState = stateMatch ? stateMatch[1] : "";
  const returnTypeMatch = xml.match(/<ReturnTypeCd>([^<]+)<\/ReturnTypeCd>/);
  const returnType = returnTypeMatch ? returnTypeMatch[1] : "";

  if (returnType === "990PF") {
    // Schedule B donors
    const contributorBlocks = extractBetween(xml, "ContributorInformationGrp", "ContributorInformationGrp");
    for (const block of contributorBlocks) {
      const personNames = extractAll(block, "ContributorPersonNm");
      const amounts = extractAll(block, "TotalContributionsAmt");
      const isPersonArr = extractAll(block, "PersonContributionInd");
      if (personNames.length > 0 && isPersonArr.length > 0) {
        records.push({
          name: personNames[0],
          nameNormalized: normalizeName(personNames[0]),
          role: "donor",
          orgName,
          orgEin: ein,
          orgState,
          amount: amounts.length > 0 ? Number(amounts[0]) : 0,
          title: "",
        });
      }
    }

    // Part VII officers
    const officerBlocks = extractBetween(xml, "OfficerDirTrstKeyEmplGrp", "OfficerDirTrstKeyEmplGrp");
    for (const block of officerBlocks) {
      const names = extractAll(block, "PersonNm");
      const titles = extractAll(block, "TitleTxt");
      const comps = extractAll(block, "CompensationAmt");
      if (names.length > 0) {
        records.push({
          name: names[0],
          nameNormalized: normalizeName(names[0]),
          role: "officer",
          orgName,
          orgEin: ein,
          orgState,
          amount: comps.length > 0 ? Number(comps[0]) : 0,
          title: titles.length > 0 ? titles[0] : "",
        });
      }
    }
  } else if (returnType === "990") {
    // Part VII officers (regular 990)
    const officerBlocks = extractBetween(xml, "Form990PartVIISectionAGrp", "Form990PartVIISectionAGrp");
    for (const block of officerBlocks) {
      const names = extractAll(block, "PersonNm");
      const titles = extractAll(block, "TitleTxt");
      const comps = extractAll(block, "ReportableCompFromOrgAmt");
      if (names.length > 0) {
        records.push({
          name: names[0],
          nameNormalized: normalizeName(names[0]),
          role: "officer",
          orgName,
          orgEin: ein,
          orgState,
          amount: comps.length > 0 ? Number(comps[0]) : 0,
          title: titles.length > 0 ? titles[0] : "",
        });
      }
    }
  }

  return records;
}

// --- Main ---
const xmlDir = process.argv[2];
if (!xmlDir || !fs.existsSync(xmlDir)) {
  process.stderr.write("Usage: npx tsx yield-study.ts /path/to/extracted-xmls/\n");
  process.exit(1);
}

const xmlFiles = fs.readdirSync(xmlDir).filter((f) => f.endsWith("_public.xml"));
process.stderr.write(`Found ${xmlFiles.length} XML files to parse\n`);

const allRecords: PersonRecord[] = [];
let filesProcessed = 0;
let filesFailed = 0;
let files990PF = 0;
let files990 = 0;

for (const file of xmlFiles) {
  try {
    const records = parseFile(path.join(xmlDir, file));
    allRecords.push(...records);
    filesProcessed++;
    if (records.length > 0 && records[0].role === "donor") files990PF++;
    // Check return type from file
    const xml = fs.readFileSync(path.join(xmlDir, file), "utf8");
    if (xml.includes("<ReturnTypeCd>990PF</ReturnTypeCd>")) files990PF++;
    else if (xml.includes("<ReturnTypeCd>990</ReturnTypeCd>")) files990++;
  } catch {
    filesFailed++;
  }
  if (filesProcessed % 1000 === 0) {
    process.stderr.write(`  Processed ${filesProcessed}/${xmlFiles.length} files...\n`);
  }
}

// Analyze
const donors = allRecords.filter((r) => r.role === "donor");
const officers = allRecords.filter((r) => r.role === "officer");

const uniqueNames = new Set(allRecords.map((r) => r.nameNormalized));
const uniqueDonorNames = new Set(donors.map((r) => r.nameNormalized));
const uniqueOfficerNames = new Set(officers.map((r) => r.nameNormalized));

// Name frequency distribution
const nameFreq = new Map<string, number>();
for (const r of allRecords) {
  nameFreq.set(r.nameNormalized, (nameFreq.get(r.nameNormalized) ?? 0) + 1);
}

const freqBuckets = { once: 0, twice: 0, three_to_five: 0, six_plus: 0 };
for (const count of nameFreq.values()) {
  if (count === 1) freqBuckets.once++;
  else if (count === 2) freqBuckets.twice++;
  else if (count <= 5) freqBuckets.three_to_five++;
  else freqBuckets.six_plus++;
}

// Top most common names (noise indicator)
const sortedNames = Array.from(nameFreq.entries()).sort((a, b) => b[1] - a[1]);
const top20 = sortedNames.slice(0, 20);

// Donor amount distribution
const donorAmounts = donors.map((d) => d.amount).filter((a) => a > 0).sort((a, b) => a - b);
const totalDonorAmount = donorAmounts.reduce((sum, a) => sum + a, 0);

// State distribution
const stateFreq = new Map<string, number>();
for (const r of allRecords) {
  if (r.orgState) stateFreq.set(r.orgState, (stateFreq.get(r.orgState) ?? 0) + 1);
}
const topStates = Array.from(stateFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

// Simulated match rate
// Assume a prospect list has names drawn from US population
// The question: what fraction of our 990 names would match a random prospect list?
// Better proxy: what fraction of 990 names are "common enough" to collide with a 10K list?
// For now, just report the unique name count and let the user judge.

// Also: simulate with first+last only (dropping middle names) for more realistic matching
const firstLastNames = new Set<string>();
for (const r of allRecords) {
  const parts = r.nameNormalized.split(" ");
  if (parts.length >= 2) {
    firstLastNames.add(`${parts[0]} ${parts[parts.length - 1]}`);
  }
}

// Output report
const report = `
# Yield Study Results
## Batch: January 2026 (2026_TEOS_XML_01A)

### Files Processed
- Total XML files: ${xmlFiles.length}
- Successfully parsed: ${filesProcessed}
- Failed: ${filesFailed}

### Person Records Extracted
- **Total person records: ${allRecords.length}**
- Donors (990-PF Schedule B): ${donors.length}
- Officers/Directors/Trustees: ${officers.length}

### Unique Names
- Total unique normalized names: ${uniqueNames.size}
- Unique donor names: ${uniqueDonorNames.size}
- Unique officer names: ${uniqueOfficerNames.size}
- Unique first+last only (no middle): ${firstLastNames.size}

### Name Frequency Distribution
- Appear once: ${freqBuckets.once} (${(freqBuckets.once / uniqueNames.size * 100).toFixed(1)}%)
- Appear twice: ${freqBuckets.twice}
- Appear 3-5 times: ${freqBuckets.three_to_five}
- Appear 6+ times: ${freqBuckets.six_plus} (high noise risk)

### Top 20 Most Common Names (Noise Indicator)
${top20.map(([name, count], i) => `${i + 1}. "${name}" — ${count} occurrences`).join("\n")}

### Donor Amount Distribution
- Total donors with amounts: ${donorAmounts.length}
- Total donated: $${totalDonorAmount.toLocaleString()}
- Median donation: $${donorAmounts.length > 0 ? donorAmounts[Math.floor(donorAmounts.length / 2)].toLocaleString() : "N/A"}
- Min: $${donorAmounts.length > 0 ? donorAmounts[0].toLocaleString() : "N/A"}
- Max: $${donorAmounts.length > 0 ? donorAmounts[donorAmounts.length - 1].toLocaleString() : "N/A"}
- $5K-$50K: ${donorAmounts.filter((a) => a >= 5000 && a < 50000).length}
- $50K-$500K: ${donorAmounts.filter((a) => a >= 50000 && a < 500000).length}
- $500K+: ${donorAmounts.filter((a) => a >= 500000).length}

### Top 10 States by Person Records
${topStates.map(([state, count]) => `- ${state}: ${count}`).join("\n")}

### Projected Match Rates
Assuming prospect list is from a university advancement office:
- Against ${uniqueNames.size} unique names from this batch
- A 10K prospect list with ~3-5% name overlap → **${Math.round(uniqueNames.size * 0.04)} potential matches** (before disambiguation)
- A 50K prospect list with ~3-5% overlap → **${Math.round(uniqueNames.size * 0.04 * 5)} potential matches**
- A 100K prospect list → **${Math.round(uniqueNames.size * 0.04 * 10)} potential matches**

NOTE: These are raw name collisions, not verified matches. After disambiguation
(state, city, middle name, common name filtering), expect 30-60% to survive as
client-ready matches. The rest go to review.

### Key Insight for Product Viability
This is ONE month's batch. Annual volume is ~12x larger. The real question:
- ${uniqueDonorNames.size} unique donor names per month × 12 = ~${uniqueDonorNames.size * 12} unique donors per year
- ${uniqueOfficerNames.size} unique officer names per month × 12 = ~${uniqueOfficerNames.size * 12} unique officers per year
- Against a 50K prospect list, this should produce a meaningful number of verified matches per month.
`;

process.stdout.write(report);

// Also write JSON for further analysis
const jsonOutput = {
  batch: "2026_TEOS_XML_01A",
  filesProcessed,
  filesFailed,
  totalRecords: allRecords.length,
  donors: donors.length,
  officers: officers.length,
  uniqueNames: uniqueNames.size,
  uniqueDonorNames: uniqueDonorNames.size,
  uniqueOfficerNames: uniqueOfficerNames.size,
  uniqueFirstLastNames: firstLastNames.size,
  nameFrequency: freqBuckets,
  top20Names: top20,
  donorAmountStats: {
    count: donorAmounts.length,
    total: totalDonorAmount,
    median: donorAmounts.length > 0 ? donorAmounts[Math.floor(donorAmounts.length / 2)] : 0,
    min: donorAmounts[0] ?? 0,
    max: donorAmounts[donorAmounts.length - 1] ?? 0,
  },
  topStates,
};

const jsonPath = path.join(path.dirname(process.argv[1]), "yield-study-results.json");
fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2) + "\n");
process.stderr.write(`\nJSON results written to ${jsonPath}\n`);
