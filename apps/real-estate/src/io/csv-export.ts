import fs from "node:fs";
import path from "node:path";

import { escapeCsvValue } from "@pm/core";

import type { PropertyMatch } from "../core/types";

const CLIENT_HEADERS = [
  "Prospect ID",
  "Prospect Name",
  "Match Quality",
  "Combined Score",
  "Change Type",
  "Match Reason",
  "Owner Name on Record",
  "Ownership Type",
  "Property Address",
  "Property City",
  "Property State",
  "Owner Mailing Address",
  "Owner-Occupied Flag",
  "Property Type",
  "Assessed Value",
  "Estimated Value",
  "Last Sale Date",
  "Last Sale Amount",
  "Mortgage Amount",
  "Lender",
  "Signal",
  "Action",
  "Source Vendor",
  "Source Property ID",
];

export function writeMatchCsv(filePath: string, rows: PropertyMatch[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [CLIENT_HEADERS.join(",")];
  for (const row of rows) {
    lines.push([
      row.prospectId,
      row.prospectName,
      row.quality,
      row.combinedScore,
      row.changeType,
      row.matchReasons.join("; "),
      row.matchedOwner.raw || row.property.ownerRaw,
      row.property.ownerType,
      row.property.situsAddress,
      row.property.situsCity ?? "",
      row.property.situsState ?? "",
      row.property.ownerMailingAddress ?? "",
      row.property.isOwnerOccupied ? "yes" : row.property.isAbsenteeOwner ? "no" : "",
      row.property.propertyType ?? "",
      row.property.assessedTotal ?? "",
      row.property.estimatedValue ?? "",
      row.property.lastSaleDate ?? "",
      row.property.lastSalePrice ?? "",
      row.property.mortgageAmount ?? "",
      row.property.mortgageLender ?? "",
      row.signals.map((signal) => signal.signal).join("; "),
      row.signals.map((signal) => signal.action).join("; "),
      row.property.source,
      row.property.sourcePropertyId,
    ].map(escapeCsvValue).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}
