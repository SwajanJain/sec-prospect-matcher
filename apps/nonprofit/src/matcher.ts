import fs from "node:fs";
import path from "node:path";
import { loadProspectsDetailed, buildProspectIndex, createLogger } from "@pm/core";
import type { IndexedProspect } from "@pm/core";
import { parseIrsXml } from "./xml-parser";
import { scoreNonprofitMatch } from "./scorer";
import { writeMatchesCsv, writeGrantsCsv, writeSummary } from "./csv-export";
import type { NonprofitRecord, GrantRecord, NonprofitMatchResult, EnrichedGrant } from "./types";

export function runNonprofitMatcher(options: {
  prospectsPath: string;
  xmlDir: string;
  outputDir: string;
  verbose: boolean;
}): void {
  const log = createLogger(options.verbose);

  // 1. Load prospects
  log.info(`Loading prospects from ${options.prospectsPath}`);
  const { prospects, summary: loadSummary } = loadProspectsDetailed(options.prospectsPath);
  log.info(`Loaded ${prospects.length} prospects (${loadSummary.skippedRows} skipped)`);

  // 2. Build prospect index
  log.info("Building prospect name index...");
  const { prospectIndex } = buildProspectIndex(prospects);
  log.info(`Index built: ${prospectIndex.size} name variants`);

  // 3. Scan XML files
  const xmlFiles = fs.readdirSync(options.xmlDir).filter((f) => f.endsWith(".xml"));
  log.info(`Found ${xmlFiles.length} XML files in ${options.xmlDir}`);

  const allRecords: NonprofitRecord[] = [];
  const allGrants: GrantRecord[] = [];
  let parseErrors = 0;

  for (const file of xmlFiles) {
    try {
      const content = fs.readFileSync(path.join(options.xmlDir, file), "utf8");
      const objectId = path.basename(file, ".xml");
      const { records, grants } = parseIrsXml(content, objectId);
      allRecords.push(...records);
      allGrants.push(...grants);
    } catch {
      parseErrors++;
    }
  }

  const donorRecords = allRecords.filter((r) => r.source === "990-PF-DONOR").length;
  const officerRecords = allRecords.length - donorRecords;
  log.info(`Extracted ${allRecords.length} records (${officerRecords} officers, ${donorRecords} donors)`);
  log.info(`Extracted ${allGrants.length} grants`);
  if (parseErrors > 0) log.warn(`${parseErrors} files failed to parse`);

  // 4. Build name frequency map
  const nameFreq = new Map<string, number>();
  for (const r of allRecords) {
    const key = r.personNameNormalized;
    nameFreq.set(key, (nameFreq.get(key) ?? 0) + 1);
  }

  // 5. Build grants-by-EIN map for enrichment
  const grantsByEin = new Map<string, GrantRecord[]>();
  for (const g of allGrants) {
    const ein = g.filing.ein;
    const existing = grantsByEin.get(ein) ?? [];
    existing.push(g);
    grantsByEin.set(ein, existing);
  }

  // 6. Match records against prospects
  log.info("Matching records against prospects...");
  const matches: NonprofitMatchResult[] = [];
  const review: NonprofitMatchResult[] = [];
  const matchedProspectIds = new Set<string>();

  for (const record of allRecords) {
    const lookupKey = record.personNameNormalized;
    const hits: IndexedProspect[] = prospectIndex.get(lookupKey) ?? [];
    if (hits.length === 0) continue;

    const freq = nameFreq.get(lookupKey) ?? 1;

    for (const hit of hits) {
      const { matchConfidence, matchQuality, matchReason } = scoreNonprofitMatch(
        hit.prospect, record, hit.variantType, freq,
      );

      const result: NonprofitMatchResult = {
        matchConfidence,
        matchQuality,
        prospectId: hit.prospect.prospectId,
        prospectName: hit.prospect.nameRaw,
        prospectCompany: hit.prospect.companyRaw,
        recordType: record.source,
        orgName: record.filing.orgName,
        orgEin: record.filing.ein,
        personRole: record.role,
        title: record.title,
        amount: record.amount,
        taxPeriod: record.filing.taxPeriodEnd,
        personCityState: [record.city, record.state].filter(Boolean).join(", "),
        orgState: record.filing.orgState,
        filingId: record.filing.objectId,
        matchReason,
      };

      if (matchConfidence >= 60) {
        matches.push(result);
        matchedProspectIds.add(hit.prospect.prospectId);
      } else {
        review.push(result);
      }
    }
  }

  log.info(`Matches: ${matches.length} (score >= 60), Review: ${review.length}`);
  log.info(`Unique prospects matched: ${matchedProspectIds.size}`);

  // 7. Grant enrichment: link grants from foundations where matched prospects are officers
  const enrichedGrants: EnrichedGrant[] = [];
  const matchedOfficerEins = new Set<string>();
  const prospectByEin = new Map<string, { name: string; id: string }>();

  for (const m of matches) {
    if (m.recordType === "990-PF-OFFICER") {
      matchedOfficerEins.add(m.orgEin);
      prospectByEin.set(m.orgEin, { name: m.prospectName, id: m.prospectId });
    }
  }

  for (const ein of matchedOfficerEins) {
    const grants = grantsByEin.get(ein);
    if (!grants) continue;
    const prospect = prospectByEin.get(ein)!;
    for (const g of grants) {
      enrichedGrants.push({
        prospectName: prospect.name,
        prospectId: prospect.id,
        foundationName: g.filing.orgName,
        foundationEin: ein,
        recipientName: g.recipientName,
        grantAmount: g.amount,
        grantPurpose: g.purpose,
        taxPeriod: g.filing.taxPeriodEnd,
      });
    }
  }

  log.info(`Grants linked to matched prospects: ${enrichedGrants.length}`);

  // 8. Write output
  fs.mkdirSync(options.outputDir, { recursive: true });

  const matchesPath = path.join(options.outputDir, "matches.csv");
  writeMatchesCsv(matchesPath, matches);
  log.info(`Wrote ${matches.length} matches to ${matchesPath}`);

  if (review.length > 0) {
    const reviewPath = path.join(options.outputDir, "review.csv");
    writeMatchesCsv(reviewPath, review);
    log.info(`Wrote ${review.length} review items to ${reviewPath}`);
  }

  if (enrichedGrants.length > 0) {
    const grantsPath = path.join(options.outputDir, "grants.csv");
    writeGrantsCsv(grantsPath, enrichedGrants);
    log.info(`Wrote ${enrichedGrants.length} grants to ${grantsPath}`);
  }

  // Sort for top matches preview
  const sortedMatches = [...matches].sort((a, b) => b.matchConfidence - a.matchConfidence || b.amount - a.amount);

  const summaryPath = path.join(options.outputDir, "summary.md");
  writeSummary(summaryPath, {
    prospectsLoaded: prospects.length,
    xmlsScanned: xmlFiles.length,
    recordsExtracted: allRecords.length,
    donorRecords,
    officerRecords,
    grantsExtracted: allGrants.length,
    matchesFound: matches.length,
    reviewCount: review.length,
    uniqueProspectsMatched: matchedProspectIds.size,
    grantsLinked: enrichedGrants.length,
    topMatches: sortedMatches,
  });
  log.info(`Summary written to ${summaryPath}`);
}
