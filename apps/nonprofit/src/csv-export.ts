import fs from "node:fs";
import { escapeCsvValue } from "@pm/core";
import type { EnrichedGrant, NonprofitMatchResult } from "./types";
import { compareMatchResults } from "./scorer";

function writeCsvRows(filePath: string, headers: string[], rows: string[][]): void {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

export function writeMatchesCsv(filePath: string, matches: NonprofitMatchResult[]): void {
  const sorted = [...matches].sort(compareMatchResults);
  const headers = [
    "Match Confidence",
    "Confidence Tier",
    "Routing Decision",
    "Prospect ID",
    "Prospect Name",
    "Prospect Company",
    "Record Type",
    "Organization Name",
    "Organization EIN",
    "Person Role",
    "Title",
    "Amount",
    "Tax Period",
    "Person City/State",
    "Org State",
    "Location Support",
    "Org Affinity",
    "Prospect Collision Count",
    "Review Bucket",
    "Evidence Signals",
    "Conflict Flags",
    "Filing ID",
    "Source Section",
    "Record Fingerprint",
    "Match Reason",
  ];

  const rows = sorted.map((match) => [
    String(match.matchConfidence),
    match.confidenceTier,
    match.routingDecision,
    match.prospectId,
    match.prospectName,
    match.prospectCompany,
    match.recordType,
    match.orgName,
    match.orgEin,
    match.personRole,
    match.title,
    String(match.amount),
    match.taxPeriod,
    match.personCityState,
    match.orgState,
    match.locationSupport,
    String(match.orgAffinityScore),
    String(match.prospectCollisionCount),
    match.reviewBucket,
    match.evidenceSignals.join(";"),
    match.conflictFlags.join(";"),
    match.filingId,
    match.sourceSection,
    match.recordFingerprint,
    match.matchReason,
  ]);

  writeCsvRows(filePath, headers, rows);
}

export function writeGrantsCsv(filePath: string, grants: EnrichedGrant[]): void {
  const headers = [
    "Matched Prospect IDs",
    "Matched Prospect Names",
    "Foundation Name",
    "Foundation EIN",
    "Foundation Match Tier",
    "Foundation Link Status",
    "Foundation Link Note",
    "Recipient",
    "Grant Amount",
    "Grant Purpose",
    "Tax Period",
  ];

  const rows = grants.map((grant) => [
    grant.matchedProspectIds.join(";"),
    grant.matchedProspectNames.join(";"),
    grant.foundationName,
    grant.foundationEin,
    grant.foundationMatchTier,
    grant.foundationLinkStatus,
    grant.foundationLinkNote,
    grant.recipientName,
    String(grant.grantAmount),
    grant.grantPurpose,
    grant.taxPeriod,
  ]);

  writeCsvRows(filePath, headers, rows);
}

export function writeSummary(
  filePath: string,
  stats: {
    prospectsLoaded: number;
    xmlsScanned: number;
    recordsExtracted: number;
    donorRecords: number;
    officerRecords: number;
    grantsExtracted: number;
    matchesFound: number;
    reviewCount: number;
    uniqueProspectsMatched: number;
    grantsLinked: number;
    duplicateCollapseCount: number;
    ambiguousFoundationCount: number;
    tierCounts: Map<string, number>;
    reviewBucketCounts: Map<string, number>;
    topMatches: NonprofitMatchResult[];
  },
): void {
  const lines = [
    "# Nonprofit 990 Matcher — Run Summary",
    "",
    `**Date:** ${new Date().toISOString().split("T")[0]}`,
    "",
    "## Input",
    `- Prospects loaded: ${stats.prospectsLoaded.toLocaleString()}`,
    `- XML files scanned: ${stats.xmlsScanned.toLocaleString()}`,
    "",
    "## Extraction",
    `- Total records extracted: ${stats.recordsExtracted.toLocaleString()}`,
    `- Officers: ${stats.officerRecords.toLocaleString()}`,
    `- Donors: ${stats.donorRecords.toLocaleString()}`,
    `- Grants extracted: ${stats.grantsExtracted.toLocaleString()}`,
    `- Filing duplicate records collapsed: ${stats.duplicateCollapseCount.toLocaleString()}`,
    "",
    "## Matching",
    `- Accepted matches: ${stats.matchesFound.toLocaleString()}`,
    `- Review items: ${stats.reviewCount.toLocaleString()}`,
    `- Unique prospects matched: ${stats.uniqueProspectsMatched.toLocaleString()}`,
    `- Foundation grants linked: ${stats.grantsLinked.toLocaleString()}`,
    `- Ambiguous foundations: ${stats.ambiguousFoundationCount.toLocaleString()}`,
    "",
    "## Confidence Tiers",
  ];

  for (const [tier, count] of [...stats.tierCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${tier}: ${count.toLocaleString()}`);
  }

  lines.push("");
  lines.push("## Review Buckets");
  for (const [bucket, count] of [...stats.reviewBucketCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${bucket}: ${count.toLocaleString()}`);
  }

  const riskySignals = new Map<string, number>();
  for (const row of stats.topMatches) {
    if (row.confidenceTier !== "Risky") continue;
    for (const flag of row.conflictFlags) {
      riskySignals.set(flag, (riskySignals.get(flag) ?? 0) + 1);
    }
  }

  lines.push("");
  lines.push("## Top Risky Patterns");
  for (const [signal, count] of [...riskySignals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    lines.push(`- ${signal}: ${count.toLocaleString()}`);
  }

  if (stats.topMatches.length > 0) {
    lines.push("");
    lines.push("## Top Matches Preview");
    lines.push("");
    lines.push("| Tier | Score | Prospect | Organization | Role | Evidence |");
    lines.push("|------|-------|----------|--------------|------|----------|");
    for (const match of stats.topMatches.slice(0, 15)) {
      lines.push(
        `| ${match.confidenceTier} | ${match.matchConfidence} | ${match.prospectName} | ${match.orgName} | ${match.personRole} | ${match.evidenceSignals.join("; ")} |`,
      );
    }
  }

  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}
