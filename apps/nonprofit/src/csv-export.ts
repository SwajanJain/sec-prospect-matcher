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

function formatCurrency(amount: number): string {
  if (amount === 0) return "$0";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}`;
}

function signalType(recordType: string): string {
  switch (recordType) {
    case "990-PF-DONOR":
      return "Personal Donation";
    case "990-PF-OFFICER":
    case "990-OFFICER":
      return "Board/Leadership Role";
    default:
      return recordType;
  }
}

function amountLabel(recordType: string): string {
  switch (recordType) {
    case "990-PF-DONOR":
      return "Donation";
    case "990-PF-OFFICER":
    case "990-OFFICER":
      return "Compensation";
    default:
      return "";
  }
}

function buildMatchQuality(match: NonprofitMatchResult): string {
  const tier = match.confidenceTier;
  const signals = match.evidenceSignals;

  if (tier === "Verified") {
    if (signals.includes("direct_org_affinity")) return "Verified — Company confirmed as officer";
    if (signals.includes("family_foundation_affinity")) return "Verified — Family foundation match";
    if (signals.includes("direct_named_donor")) return "Verified — Named donor with corroboration";
    return "Verified — Multiple corroborating signals";
  }
  if (tier === "Likely") {
    if (signals.includes("strong_org_affinity")) return "Likely — Strong org name match";
    if (signals.includes("family_foundation_affinity")) return "Likely — Family foundation match";
    if (signals.includes("direct_named_donor")) return "Likely — Named donor";
    return "Likely — Corroborated match";
  }
  if (tier === "Risky") {
    if (signals.includes("direct_named_donor")) return "Risky — Donor, no corroboration";
    return "Risky — Name match only, verify manually";
  }
  // Review Needed
  if (match.reviewBucket === "duplicate_prospect_name") return "Review — Multiple prospects share this name";
  if (match.reviewBucket === "weak_staff_role") return "Review — Weak staff role, unlikely prospect";
  if (match.reviewBucket === "common_name") return "Review — Common name, high false-positive risk";
  if (match.reviewBucket === "duplicate_filing_record") return "Review — Duplicate record in filing";
  return "Review — Insufficient evidence";
}

function buildAction(match: NonprofitMatchResult): string {
  const signals = match.evidenceSignals;
  const recordType = match.recordType;

  if (recordType === "990-PF-DONOR") {
    if (match.amount >= 50000) return "Major donor — high philanthropic capacity";
    return "Donor — verify identity";
  }

  if (recordType === "990-PF-OFFICER") {
    if (signals.includes("family_foundation_affinity")) return "Runs family foundation — see grants below for giving interests";
    if (signals.includes("direct_org_affinity")) return "Foundation leadership — company confirmed";
    return "Foundation leadership — verify connection";
  }

  // 990-OFFICER
  if (signals.includes("direct_org_affinity")) return "Confirmed at known org";
  if (match.personRole === "director" || match.personRole === "trustee") return "Board member — verify identity";
  return "Nonprofit leadership — verify identity";
}

// ---------------------------------------------------------------------------
// Client CSV — unified format combining matches + grants
// ---------------------------------------------------------------------------

export interface ClientRow {
  signalType: string;
  prospectId: string;
  prospectName: string;
  prospectCompany: string;
  confidenceTier: string;
  matchConfidence: number;
  matchQuality: string;
  organizationName: string;
  organizationEin: string;
  roleOrTitle: string;
  amountLabel: string;
  amount: number;
  recipient: string;
  grantPurpose: string;
  taxPeriod: string;
  orgState: string;
  evidence: string;
  action: string;
  filingId: string;
}

const CLIENT_HEADERS = [
  // What kind of finding is this?
  "Signal Type",
  // Who is this prospect?
  "Prospect ID",
  "Prospect Name",
  "Prospect Company",
  // How confident are we?
  "Confidence Tier",
  "Match Confidence",
  "Match Quality",
  // What did we find?
  "Organization Name",
  "Organization EIN",
  "Role / Title",
  "Amount Type",
  "Amount",
  "Grant Recipient",
  "Grant Purpose",
  "Tax Period",
  "Org State",
  // Why do we think it's them?
  "Evidence",
  // What should the gift officer do?
  "Action",
  // Source
  "Filing ID",
];

function matchToClientRow(match: NonprofitMatchResult): ClientRow {
  return {
    signalType: signalType(match.recordType),
    prospectId: match.prospectId,
    prospectName: match.prospectName,
    prospectCompany: match.prospectCompany,
    confidenceTier: match.confidenceTier,
    matchConfidence: match.matchConfidence,
    matchQuality: buildMatchQuality(match),
    organizationName: match.orgName,
    organizationEin: match.orgEin,
    roleOrTitle: [match.personRole, match.title].filter(Boolean).join(" — "),
    amountLabel: amountLabel(match.recordType),
    amount: match.amount,
    recipient: "",
    grantPurpose: "",
    taxPeriod: match.taxPeriod,
    orgState: match.orgState,
    evidence: match.evidenceSignals.join("; "),
    action: buildAction(match),
    filingId: match.filingId,
  };
}

function grantToClientRow(grant: EnrichedGrant): ClientRow {
  return {
    signalType: "Foundation Giving",
    prospectId: grant.matchedProspectIds.join("; "),
    prospectName: grant.matchedProspectNames.join("; "),
    prospectCompany: "",
    confidenceTier: grant.foundationMatchTier,
    matchConfidence: 0,
    matchQuality: grant.foundationLinkStatus === "verified_foundation_link"
      ? "Verified — Single prospect linked to foundation"
      : "Review — Multiple prospects linked to foundation",
    organizationName: grant.foundationName,
    organizationEin: grant.foundationEin,
    roleOrTitle: "",
    amountLabel: "Grant",
    amount: grant.grantAmount,
    recipient: grant.recipientName,
    grantPurpose: grant.grantPurpose,
    taxPeriod: grant.taxPeriod,
    orgState: "",
    evidence: grant.foundationLinkNote,
    action: "Shows where this prospect's foundation directs funding",
    filingId: "",
  };
}

function clientRowToValues(row: ClientRow): string[] {
  return [
    row.signalType,
    row.prospectId,
    row.prospectName,
    row.prospectCompany,
    row.confidenceTier,
    String(row.matchConfidence),
    row.matchQuality,
    row.organizationName,
    row.organizationEin,
    row.roleOrTitle,
    row.amountLabel,
    formatCurrency(row.amount),
    row.recipient,
    row.grantPurpose,
    row.taxPeriod,
    row.orgState,
    row.evidence,
    row.action,
    row.filingId,
  ];
}

function buildGuideRows(): string[] {
  return [
    `"About This Report"`,
    `"Each row is one finding from IRS 990 nonprofit filings matched against your prospect list."`,
    `"The Signal Type column tells you what kind of finding each row represents:"`,
    `""`,
    `"Board/Leadership Role","This prospect holds a board, officer, or executive position at a nonprofit organization."`,
    `"","Example: Jennifer Stern is Executive Director of Great MN Schools, earning $348,162 in compensation."`,
    `""`,
    `"Personal Donation","This prospect personally donated money to a private foundation (from IRS Schedule B)."`,
    `"","Example: Michael Jacobs donated $100,000 to The Neuberg Family Foundation."`,
    `""`,
    `"Foundation Giving","A foundation where this prospect is an officer gave a grant to another organization. Shows their philanthropic interests and priorities."`,
    `"","Example: The James W Taylor Family Foundation (where James Taylor is President) gave $25,000 to Community Food Bank."`,
    `""`,
    `"Confidence Tiers: Verified = strong corroborating evidence (company match, family foundation). Likely = one corroborating signal. Risky = name match only, needs manual verification."`,
    `""`,
  ];
}

export function writeClientCsv(
  filePath: string,
  matches: NonprofitMatchResult[],
  grants: EnrichedGrant[],
): void {
  const matchRows = [...matches].sort(compareMatchResults).map(matchToClientRow);
  const grantRows = grants.map(grantToClientRow);

  // Interleave: for each prospect, show their officer/donor rows first, then their grants
  const byProspect = new Map<string, ClientRow[]>();
  for (const row of [...matchRows, ...grantRows]) {
    const ids = row.prospectId.split("; ");
    for (const id of ids) {
      const existing = byProspect.get(id) ?? [];
      existing.push(row);
      byProspect.set(id, existing);
    }
  }

  // Sort prospect groups by best match confidence
  const prospectOrder = [...byProspect.entries()]
    .sort((a, b) => {
      const bestA = Math.max(...a[1].map((r) => r.matchConfidence));
      const bestB = Math.max(...b[1].map((r) => r.matchConfidence));
      return bestB - bestA;
    });

  const seen = new Set<ClientRow>();
  const orderedRows: ClientRow[] = [];
  for (const [, rows] of prospectOrder) {
    for (const row of rows) {
      if (seen.has(row)) continue;
      seen.add(row);
      orderedRows.push(row);
    }
  }

  const guide = buildGuideRows();
  const headerLine = CLIENT_HEADERS.join(",");
  const dataLines = orderedRows.map((row) => clientRowToValues(row).map(escapeCsvValue).join(","));
  const allLines = [...guide, headerLine, ...dataLines];
  fs.writeFileSync(filePath, allLines.join("\n") + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Debug/internal CSV — full diagnostic columns
// ---------------------------------------------------------------------------

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
