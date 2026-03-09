import fs from "node:fs";
import path from "node:path";
import { escapeCsvValue } from "@pm/core";
import { NonprofitMatchResult, EnrichedGrant } from "./types";

function writeCsvRows(filePath: string, headers: string[], rows: string[][]): void {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

export function writeMatchesCsv(filePath: string, matches: NonprofitMatchResult[]): void {
  const sorted = [...matches].sort((a, b) => b.matchConfidence - a.matchConfidence || b.amount - a.amount);

  const headers = [
    "Match Confidence", "Match Quality", "Prospect Name", "Prospect Company",
    "Record Type", "Organization Name", "Organization EIN", "Person Role",
    "Title", "Amount", "Tax Period", "Person City/State", "Org State",
    "Filing ID", "Match Reason",
  ];

  const rows = sorted.map((m) => [
    String(m.matchConfidence),
    m.matchQuality,
    m.prospectName,
    m.prospectCompany,
    m.recordType,
    m.orgName,
    m.orgEin,
    m.personRole,
    m.title,
    String(m.amount),
    m.taxPeriod,
    m.personCityState,
    m.orgState,
    m.filingId,
    m.matchReason,
  ]);

  writeCsvRows(filePath, headers, rows);
}

export function writeGrantsCsv(filePath: string, grants: EnrichedGrant[]): void {
  const headers = [
    "Prospect Name", "Prospect ID", "Foundation Name", "Foundation EIN",
    "Recipient", "Grant Amount", "Grant Purpose", "Tax Period",
  ];

  const rows = grants.map((g) => [
    g.prospectName,
    g.prospectId,
    g.foundationName,
    g.foundationEin,
    g.recipientName,
    String(g.grantAmount),
    g.grantPurpose,
    g.taxPeriod,
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
    `  - Officers: ${stats.officerRecords.toLocaleString()}`,
    `  - Donors: ${stats.donorRecords.toLocaleString()}`,
    `- Grants extracted: ${stats.grantsExtracted.toLocaleString()}`,
    "",
    "## Matching",
    `- Matches (score >= 60): ${stats.matchesFound.toLocaleString()}`,
    `- Review needed (score < 60): ${stats.reviewCount.toLocaleString()}`,
    `- Unique prospects matched: ${stats.uniqueProspectsMatched.toLocaleString()}`,
    `- Grants linked to matched prospects: ${stats.grantsLinked.toLocaleString()}`,
    "",
  ];

  if (stats.topMatches.length > 0) {
    lines.push("## Top Matches Preview");
    lines.push("");
    lines.push("| Score | Quality | Prospect | Organization | Role | Type |");
    lines.push("|-------|---------|----------|--------------|------|------|");
    for (const m of stats.topMatches.slice(0, 15)) {
      lines.push(`| ${m.matchConfidence} | ${m.matchQuality} | ${m.prospectName} | ${m.orgName} | ${m.personRole} | ${m.recordType} |`);
    }
    lines.push("");
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}
