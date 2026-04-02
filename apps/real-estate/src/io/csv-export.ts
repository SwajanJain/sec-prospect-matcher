import fs from "node:fs";
import path from "node:path";

import { escapeCsvValue } from "@pm/core";

import type { MonitoringStats, PropertyMatch } from "../core/types";

function propertyAddressOneLine(row: PropertyMatch): string {
  const parts: string[] = [];
  const street = row.property.situsAddress?.split(",")[0]?.trim();
  if (street) parts.push(street);
  if (row.property.situsCity) parts.push(row.property.situsCity);
  const stateZip = [row.property.situsState, row.property.situsZip].filter(Boolean).join(" ");
  if (stateZip) parts.push(stateZip);
  return parts.join(", ");
}

const CLIENT_HEADERS = [
  "Prospect Name",
  "Source Name on Record",
  "Role",
  "Prospect Address (from CRM)",
  "Property Address (from ATTOM)",
  "Buyer Mailing Address (from ATTOM)",
  "Match Quality",
  "Combined Score",
  "Match Reason",
  "Sale Date",
  "Sale Price",
  "Property Type",
  "Assessed Value",
  "Sale Transaction Type",
  "Quitclaim",
  "Disclaimer",
  "Signal",
  "Action",
  "Prospect ID",
  "Source Property ID",
];

export function writeMatchCsv(filePath: string, rows: PropertyMatch[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [CLIENT_HEADERS.join(",")];
  for (const row of rows) {
    lines.push([
      row.prospectName,
      row.sourceNameOnRecord || row.matchedOwner.raw || row.property.ownerRaw,
      row.role,
      row.prospectAddress ?? "",
      propertyAddressOneLine(row),
      row.role === "buyer" ? row.property.ownerMailingAddress ?? "" : "",
      row.quality,
      row.combinedScore,
      row.matchReasons.join("; "),
      row.property.saleRecordDate ?? row.property.saleTransactionDate ?? row.property.lastSaleDate ?? "",
      row.property.lastSalePrice ?? "",
      row.property.propertyType ?? "",
      row.property.assessedTotal ?? "",
      row.property.saleTransactionType ?? "",
      row.property.quitClaimFlag ?? "",
      row.disclaimer ?? "",
      row.signals.map((signal) => signal.signal).join("; "),
      row.signals.map((signal) => signal.action).join("; "),
      row.prospectId,
      row.property.sourcePropertyId,
    ].map(escapeCsvValue).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function usNum(value: number): string {
  return value.toLocaleString("en-US");
}

export function writeSummary(
  filePath: string,
  accepted: PropertyMatch[],
  review: PropertyMatch[],
  stats: MonitoringStats,
  options: { startDate: string; endDate: string; prospectsPath: string },
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const buyers = accepted.filter((r) => r.role === "buyer");
  const sellers = accepted.filter((r) => r.role === "seller");
  const high = accepted.filter((r) => r.quality === "high");
  const prices = accepted.map((r) => r.property.lastSalePrice ?? 0).filter((p) => p > 0);
  const totalValue = prices.reduce((sum, p) => sum + p, 0);
  const uniqueProspects = new Set(accepted.map((r) => r.prospectId)).size;

  const stateCounts: Record<string, number> = {};
  for (const r of accepted) {
    const s = r.property.situsState ?? "??";
    stateCounts[s] = (stateCounts[s] ?? 0) + 1;
  }
  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s} (${n})`)
    .join(", ");

  const lines: string[] = [];
  lines.push(`Real Estate Alerts — ${options.startDate} to ${options.endDate}`);
  lines.push("");
  lines.push(`Matched ${options.prospectsPath} against ${stats.propertyRecordsProcessed.toLocaleString("en-US")} ATTOM property records across ${stats.countiesScanned} counties.`);
  lines.push("");
  lines.push(`Results: ${accepted.length} client matches (${uniqueProspects} unique prospects)`);
  lines.push(`  Buyers: ${buyers.length}    Sellers: ${sellers.length}`);
  lines.push(`  High confidence: ${high.length}    Medium confidence: ${accepted.length - high.length}`);
  if (prices.length > 0) {
    lines.push(`  Price range: $${Math.min(...prices).toLocaleString("en-US")} – $${Math.max(...prices).toLocaleString("en-US")}`);
    lines.push(`  Total transaction value: $${totalValue.toLocaleString("en-US")}`);
  }
  lines.push(`  Top states: ${topStates}`);
  lines.push("");

  if (high.length > 0) {
    lines.push("High confidence matches (ZIP-level address confirmed):");
    for (const r of high) {
      const price = r.property.lastSalePrice ? `$${r.property.lastSalePrice.toLocaleString("en-US")}` : "N/A";
      const action = r.role === "buyer" ? "bought" : "sold";
      const propType = r.property.propertyType ?? "property";
      lines.push(`  ${r.prospectName} — ${action} ${price} ${propType} in ${r.property.situsCity ?? ""}, ${r.property.situsState ?? ""}`);
    }
    lines.push("");
  }

  lines.push(`Review queue: ${review.length} lower-confidence matches for manual triage`);
  lines.push("");
  lines.push("Data notes:");
  lines.push("  - Buyer matches confirmed via owner mailing address corroboration");
  lines.push("  - Seller matches use property address only (no post-sale address from ATTOM) — capped at medium confidence");
  lines.push(`  - ${stats.apiCalls} live API calls made (all data from cache)`);
  lines.push(`  - ${stats.ownersParsed.toLocaleString("en-US")} owner/seller names parsed`);
  lines.push("");

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}
