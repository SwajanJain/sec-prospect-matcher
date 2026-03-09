import fs from "node:fs";
import path from "node:path";

import { MatchResult, RunManifest } from "../core/types";
import { escapeCsvValue } from "@pm/core";

function toFecDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return "";
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

function buildFecLink(row: MatchResult): string {
  const c = row.contribution;
  if (c.source !== "FEC" || !c.committeeId) return "";
  const lastName = (c.lastName || "").toUpperCase();
  const fecDate = toFecDate(c.donationDate);
  const params = new URLSearchParams({
    committee_id: c.committeeId,
    contributor_name: lastName,
  });
  if (fecDate) {
    params.set("min_date", fecDate);
    params.set("max_date", fecDate);
  }
  return `https://www.fec.gov/data/receipts/individual-contributions/?${params.toString()}`;
}

function formatCurrency(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount).toFixed(2);
  const [whole, decimal] = abs.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${withCommas}.${decimal}`;
}

const HEADERS = [
  // Who is this prospect?
  "Prospect ID",
  "Prospect Name",
  "Prospect Company",
  // What did they do?
  "Donation Amount",
  "Donation Date",
  "Recipient",
  "Candidate Name",
  "Candidate Office",
  "Party",
  "Data Source",
  // Why do we think this is them? (verification columns)
  "Match Confidence",
  "Match Quality",
  "Donor Name (FEC)",
  "Donor Employer (FEC)",
  "Donor Occupation (FEC)",
  "Donor City/State (FEC)",
  "Employer Match",
  "Match Reason",
  // Bigger picture (aggregate intelligence)
  "Signal Tier",
  "Partisan Lean",
  "Flags",
  // Source verification
  "FEC Filing Link",
];

export function writeMatchCsv(filePath: string, rows: MatchResult[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [HEADERS.join(",")];
  for (const row of rows) {
    lines.push([
      // Who is this prospect?
      row.prospectId,
      row.prospectName,
      row.prospectCompany,
      // What did they do?
      formatCurrency(row.donationAmount),
      row.donationDate,
      row.recipient,
      row.candidateName,
      row.candidateOffice,
      row.party,
      row.dataSource,
      // Why do we think this is them?
      row.matchConfidence,
      row.matchQuality,
      row.donorNameFec,
      row.donorEmployer,
      row.donorOccupation,
      row.donorCityState,
      row.employerMatchStatus,
      row.matchReason,
      // Bigger picture
      row.signalTier,
      row.partisanLean,
      row.flags.join("; "),
      // Source verification
      buildFecLink(row),
    ].map(escapeCsvValue).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

export function writeOperatorReport(filePath: string, manifest: RunManifest): void {
  const freshness = manifest.freshness
    .map((entry) => `- ${entry.source}: fetched=${entry.fetchedAt || "n/a"}, latest_record=${entry.latestRecordDate || "n/a"}, degraded=${entry.degraded}`)
    .join("\n");
  const warnings = manifest.warnings.length > 0 ? manifest.warnings.map((warning) => `- ${warning}`).join("\n") : "- none";
  const content = [
    `# Political Funding Run ${manifest.runId}`,
    "",
    `Started: ${manifest.startedAt}`,
    `Finished: ${manifest.finishedAt}`,
    `Prospects: ${manifest.prospectsPath}`,
    "",
    "## Counts",
    `- total_records: ${manifest.counts.totalRecords}`,
    `- skipped_records: ${manifest.counts.skippedRecords}`,
    `- candidate_pairs: ${manifest.counts.candidatePairs}`,
    `- matched_rows: ${manifest.counts.matchedRows}`,
    `- accepted_rows: ${manifest.counts.acceptedRows}`,
    `- review_rows: ${manifest.counts.reviewRows}`,
    `- rejected_rows: ${manifest.counts.rejectedRows}`,
    "",
    "## Freshness",
    freshness || "- none",
    "",
    "## Warnings",
    warnings,
  ].join("\n");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`, "utf8");
}
