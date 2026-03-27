import fs from "node:fs";
import path from "node:path";
import { buildProspectIndex, createLogger, loadProspectsDetailed } from "@pm/core";
import type { IndexedProspect, VariantType } from "@pm/core";
import { parseIrsXml } from "./xml-parser";
import { compareMatchResults, scoreNonprofitMatch } from "./scorer";
import {
  writeClientCsv,
  writeGrantsCsv,
  writeMatchesCsv,
  writeSummary,
} from "./csv-export";
import type {
  ConfidenceTier,
  EnrichedGrant,
  GrantRecord,
  NonprofitMatchResult,
  NonprofitRecord,
  ReviewBucket,
} from "./types";

function variantPriority(variantType: VariantType): number {
  switch (variantType) {
    case "exact":
      return 6;
    case "suffix_stripped":
      return 5;
    case "middle_dropped":
      return 4;
    case "initial_variant":
      return 3;
    case "dehyphenated":
      return 2;
    case "nickname":
      return 1;
  }
}

function dedupeIndexedProspects(hits: IndexedProspect[]): IndexedProspect[] {
  const byProspectId = new Map<string, IndexedProspect>();
  for (const hit of hits) {
    const existing = byProspectId.get(hit.prospect.prospectId);
    if (!existing || variantPriority(hit.variantType) > variantPriority(existing.variantType)) {
      byProspectId.set(hit.prospect.prospectId, hit);
    }
  }
  return [...byProspectId.values()];
}

function dedupeMatchResults(results: NonprofitMatchResult[]): NonprofitMatchResult[] {
  const deduped = new Map<string, NonprofitMatchResult>();
  for (const result of results) {
    const key = [
      result.prospectId,
      result.filingId,
      result.orgEin,
      result.personNameNormalized,
      result.normalizedTitle || "-",
      String(result.amount),
    ].join("|");
    const existing = deduped.get(key);
    if (!existing || compareMatchResults(result, existing) < 0) {
      deduped.set(key, result);
    }
  }
  return [...deduped.values()];
}

function resolveAcceptedRecordCollisions(results: NonprofitMatchResult[]): {
  accepted: NonprofitMatchResult[];
  movedToReview: NonprofitMatchResult[];
} {
  const byFingerprint = new Map<string, NonprofitMatchResult[]>();
  for (const result of results) {
    const existing = byFingerprint.get(result.recordFingerprint) ?? [];
    existing.push(result);
    byFingerprint.set(result.recordFingerprint, existing);
  }

  const accepted: NonprofitMatchResult[] = [];
  const movedToReview: NonprofitMatchResult[] = [];

  for (const group of byFingerprint.values()) {
    if (group.length === 1) {
      accepted.push(group[0]);
      continue;
    }

    for (const result of group) {
      movedToReview.push({
        ...result,
        confidenceTier: "Review Needed",
        routingDecision: "review",
        reviewBucket: "duplicate_prospect_name",
        conflictFlags: result.conflictFlags.includes("duplicate_prospect_name")
          ? result.conflictFlags
          : [...result.conflictFlags, "duplicate_prospect_name"],
      });
    }
  }

  return { accepted, movedToReview };
}

function tierPriority(tier: ConfidenceTier): number {
  switch (tier) {
    case "Verified":
      return 4;
    case "Likely":
      return 3;
    case "Risky":
      return 2;
    case "Review Needed":
      return 1;
  }
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function highestTier(results: NonprofitMatchResult[]): ConfidenceTier {
  return [...results].sort((a, b) => tierPriority(b.confidenceTier) - tierPriority(a.confidenceTier))[0]?.confidenceTier ?? "Risky";
}

function buildFoundationGrants(
  matches: NonprofitMatchResult[],
  grantsByEin: Map<string, GrantRecord[]>,
): {
  grants: EnrichedGrant[];
  clientGrants: EnrichedGrant[];
  riskyGrants: EnrichedGrant[];
  ambiguousFoundationCount: number;
} {
  const foundationMatches = new Map<string, NonprofitMatchResult[]>();
  for (const match of matches) {
    if (match.recordType !== "990-PF-OFFICER") continue;
    const existing = foundationMatches.get(match.orgEin) ?? [];
    existing.push(match);
    foundationMatches.set(match.orgEin, existing);
  }

  const grants: EnrichedGrant[] = [];
  const clientGrants: EnrichedGrant[] = [];
  const riskyGrants: EnrichedGrant[] = [];
  let ambiguousFoundationCount = 0;

  for (const [foundationEin, foundationRows] of foundationMatches.entries()) {
    const grantRows = grantsByEin.get(foundationEin);
    if (!grantRows || grantRows.length === 0) continue;

    const uniqueProspects = new Map<string, NonprofitMatchResult>();
    for (const row of foundationRows) {
      const existing = uniqueProspects.get(row.prospectId);
      if (!existing || compareMatchResults(row, existing) < 0) {
        uniqueProspects.set(row.prospectId, row);
      }
    }

    const uniqueMatches = [...uniqueProspects.values()].sort(compareMatchResults);
    const foundationMatchTier = highestTier(uniqueMatches);
    const ambiguous = uniqueMatches.length > 1;
    if (ambiguous) ambiguousFoundationCount++;

    const foundationLinkStatus = ambiguous ? "ambiguous_foundation_link" : "verified_foundation_link";
    const foundationLinkNote = ambiguous
      ? `Multiple matched prospects for foundation EIN ${foundationEin}`
      : `Single matched prospect for foundation EIN ${foundationEin}`;

    for (const grant of grantRows) {
      const row: EnrichedGrant = {
        matchedProspectNames: uniqueMatches.map((match) => match.prospectName),
        matchedProspectIds: uniqueMatches.map((match) => match.prospectId),
        matchedProspectCompanies: uniqueMatches.map((match) => match.prospectCompany),
        matchedProspectCityStates: uniqueMatches.map((match) => match.prospectCityState),
        matchedIrsPersonNames: uniqueMatches.map((match) => match.irsPersonName),
        matchedIrsPersonAddresses: uniqueMatches.map((match) => match.irsPersonAddress),
        foundationName: grant.filing.orgName,
        foundationEin,
        foundationMatchTier,
        foundationLinkStatus,
        foundationLinkNote,
        recipientName: grant.recipientName,
        grantAmount: grant.amount,
        grantPurpose: grant.purpose,
        taxPeriod: grant.filing.taxPeriodEnd,
      };
      grants.push(row);
      if (!ambiguous && (foundationMatchTier === "Verified" || foundationMatchTier === "Likely")) {
        clientGrants.push(row);
      } else {
        riskyGrants.push(row);
      }
    }
  }

  return { grants, clientGrants, riskyGrants, ambiguousFoundationCount };
}

export function runNonprofitMatcher(options: {
  prospectsPath: string;
  xmlDir: string;
  outputDir: string;
  verbose: boolean;
}): void {
  const log = createLogger(options.verbose);

  log.info(`Loading prospects from ${options.prospectsPath}`);
  const { prospects, summary: loadSummary } = loadProspectsDetailed(options.prospectsPath);
  log.info(`Loaded ${prospects.length} prospects (${loadSummary.skippedRows} skipped)`);

  log.info("Building prospect name index...");
  const { prospectIndex } = buildProspectIndex(prospects);
  log.info(`Index built: ${prospectIndex.size} name variants`);

  const xmlFiles = fs.readdirSync(options.xmlDir).filter((file) => file.endsWith(".xml"));
  log.info(`Found ${xmlFiles.length} XML files in ${options.xmlDir}`);

  const allRecords: NonprofitRecord[] = [];
  const allGrants: GrantRecord[] = [];
  let parseErrors = 0;
  let duplicateCollapseCount = 0;

  for (const file of xmlFiles) {
    try {
      const content = fs.readFileSync(path.join(options.xmlDir, file), "utf8");
      const objectId = path.basename(file, ".xml");
      const { records, grants, duplicateCollapseCount: fileDuplicateCollapseCount } = parseIrsXml(content, objectId);
      allRecords.push(...records);
      allGrants.push(...grants);
      duplicateCollapseCount += fileDuplicateCollapseCount;
    } catch {
      parseErrors++;
    }
  }

  const donorRecords = allRecords.filter((record) => record.source === "990-PF-DONOR").length;
  const officerRecords = allRecords.length - donorRecords;
  log.info(`Extracted ${allRecords.length} records (${officerRecords} officers, ${donorRecords} donors)`);
  log.info(`Extracted ${allGrants.length} grants`);
  if (parseErrors > 0) log.warn(`${parseErrors} files failed to parse`);

  const nameFreq = new Map<string, number>();
  const einPersonHistory = new Map<string, Set<string>>();
  for (const record of allRecords) {
    incrementCount(nameFreq, record.personNameNormalized);
    const key = `${record.filing.ein}|${record.personNameNormalized}`;
    const existing = einPersonHistory.get(key) ?? new Set<string>();
    existing.add(record.filing.taxPeriodEnd || record.filing.objectId);
    einPersonHistory.set(key, existing);
  }

  const grantsByEin = new Map<string, GrantRecord[]>();
  for (const grant of allGrants) {
    const existing = grantsByEin.get(grant.filing.ein) ?? [];
    existing.push(grant);
    grantsByEin.set(grant.filing.ein, existing);
  }

  log.info("Matching records against prospects...");
  const accepted: NonprofitMatchResult[] = [];
  const review: NonprofitMatchResult[] = [];
  const matchedProspectIds = new Set<string>();

  for (const record of allRecords) {
    const hits = dedupeIndexedProspects(prospectIndex.get(record.personNameNormalized) ?? []);
    if (hits.length === 0) continue;

    const contextBase = {
      nameFrequency: nameFreq.get(record.personNameNormalized) ?? 1,
      prospectCollisionCount: hits.length,
      repeatedEinPersonCount: einPersonHistory.get(`${record.filing.ein}|${record.personNameNormalized}`)?.size ?? 1,
    };

    for (const hit of hits) {
      const score = scoreNonprofitMatch(hit.prospect, record, hit.variantType, contextBase);
      const result: NonprofitMatchResult = {
        matchConfidence: score.matchConfidence,
        confidenceTier: score.confidenceTier,
        routingDecision: score.routingDecision,
        prospectId: hit.prospect.prospectId,
        prospectName: hit.prospect.nameRaw,
        prospectCompany: hit.prospect.companyRaw,
        prospectCityState: [hit.prospect.city, hit.prospect.state].filter(Boolean).join(", "),
        irsPersonName: record.personName,
        irsPersonAddress: [record.street, record.city, record.state, record.zip].filter(Boolean).join(", "),
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
        matchReason: score.matchReason,
        evidenceSignals: score.evidenceSignals,
        conflictFlags: score.conflictFlags,
        prospectCollisionCount: score.prospectCollisionCount,
        orgAffinityScore: score.orgAffinityScore,
        locationSupport: score.locationSupport,
        reviewBucket: score.reviewBucket,
        recordFingerprint: record.recordFingerprint,
        personNameNormalized: record.personNameNormalized,
        normalizedTitle: record.normalizedTitle,
        sourceSection: record.sourceSection,
      };

      if (result.routingDecision === "accepted") {
        accepted.push(result);
        matchedProspectIds.add(hit.prospect.prospectId);
      } else {
        review.push(result);
      }
    }
  }

  const dedupedAccepted = dedupeMatchResults(accepted);
  const resolvedCollisions = resolveAcceptedRecordCollisions(dedupedAccepted);
  const dedupedMatches = dedupeMatchResults(resolvedCollisions.accepted).sort(compareMatchResults);
  const dedupedReview = dedupeMatchResults([...review, ...resolvedCollisions.movedToReview]).sort(compareMatchResults);
  const verifiedMatches = dedupedMatches.filter((row) => row.confidenceTier === "Verified");
  const clientMatches = dedupedMatches.filter((row) => row.confidenceTier === "Verified" || row.confidenceTier === "Likely");
  const riskyMatches = dedupedMatches.filter((row) => row.confidenceTier === "Risky");

  log.info(`Matches: ${dedupedMatches.length}, Review: ${dedupedReview.length}`);
  log.info(`Unique prospects matched: ${matchedProspectIds.size}`);

  const foundationGrants = buildFoundationGrants(dedupedMatches, grantsByEin);
  log.info(`Grants linked to matched foundations: ${foundationGrants.grants.length}`);

  const tierCounts = new Map<string, number>();
  for (const row of dedupedMatches) incrementCount(tierCounts, row.confidenceTier);
  for (const row of dedupedReview) incrementCount(tierCounts, row.confidenceTier);

  const reviewBucketCounts = new Map<string, number>();
  for (const row of [...dedupedMatches, ...dedupedReview]) {
    if (row.reviewBucket !== "none") incrementCount(reviewBucketCounts, row.reviewBucket);
  }

  fs.mkdirSync(options.outputDir, { recursive: true });

  // Client-ready CSV — unified format with Signal Type column (Verified + Likely + their grants)
  const clientCsvPath = path.join(options.outputDir, "client.csv");
  writeClientCsv(clientCsvPath, clientMatches, foundationGrants.clientGrants);
  log.info(`Wrote client.csv: ${clientMatches.length} matches + ${foundationGrants.clientGrants.length} grants`);

  // Risky CSV — same unified format (name-only matches + risky/ambiguous grants)
  const riskyCsvPath = path.join(options.outputDir, "risky.csv");
  writeClientCsv(riskyCsvPath, riskyMatches, foundationGrants.riskyGrants);
  log.info(`Wrote risky.csv: ${riskyMatches.length} matches + ${foundationGrants.riskyGrants.length} grants`);

  // Review CSV — same unified format (collisions, weak roles, common names)
  if (dedupedReview.length > 0) {
    const reviewCsvPath = path.join(options.outputDir, "review.csv");
    writeClientCsv(reviewCsvPath, dedupedReview, []);
    log.info(`Wrote review.csv: ${dedupedReview.length} items`);
  }

  // Debug CSV — full diagnostic columns (internal use only)
  const debugMatchesPath = path.join(options.outputDir, "debug_matches.csv");
  writeMatchesCsv(debugMatchesPath, dedupedMatches);
  log.info(`Wrote ${dedupedMatches.length} debug matches to ${debugMatchesPath}`);

  if (foundationGrants.grants.length > 0) {
    const debugGrantsPath = path.join(options.outputDir, "debug_grants.csv");
    writeGrantsCsv(debugGrantsPath, foundationGrants.grants);
    log.info(`Wrote ${foundationGrants.grants.length} debug grants to ${debugGrantsPath}`);
  }

  const summaryPath = path.join(options.outputDir, "summary.md");
  writeSummary(summaryPath, {
    prospectsLoaded: prospects.length,
    xmlsScanned: xmlFiles.length,
    recordsExtracted: allRecords.length,
    donorRecords,
    officerRecords,
    grantsExtracted: allGrants.length,
    matchesFound: dedupedMatches.length,
    reviewCount: dedupedReview.length,
    uniqueProspectsMatched: matchedProspectIds.size,
    grantsLinked: foundationGrants.grants.length,
    duplicateCollapseCount,
    ambiguousFoundationCount: foundationGrants.ambiguousFoundationCount,
    tierCounts,
    reviewBucketCounts,
    topMatches: dedupedMatches,
  });
  log.info(`Summary written to ${summaryPath}`);
}
