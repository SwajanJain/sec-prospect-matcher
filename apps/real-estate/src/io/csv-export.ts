import fs from "node:fs";
import path from "node:path";

import { escapeCsvValue } from "@pm/core";

import type { PropertyMatch } from "../core/types";

const CLIENT_HEADERS = [
  "Prospect ID",
  "Prospect Name",
  "Role",
  "Match Quality",
  "Combined Score",
  "Match Reason",
  "Source Name on Record",
  "Property Address",
  "Property City",
  "Property State",
  "Property ZIP",
  "Sale Date",
  "Sale Price",
  "Property Type",
  "Assessed Value",
  "Buyer Mailing Address",
  "Disclaimer",
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
      row.role,
      row.quality,
      row.combinedScore,
      row.matchReasons.join("; "),
      row.sourceNameOnRecord || row.matchedOwner.raw || row.property.ownerRaw,
      row.property.situsAddress,
      row.property.situsCity ?? "",
      row.property.situsState ?? "",
      row.property.situsZip ?? "",
      row.property.saleRecordDate ?? row.property.saleTransactionDate ?? row.property.lastSaleDate ?? "",
      row.property.lastSalePrice ?? "",
      row.property.propertyType ?? "",
      row.property.assessedTotal ?? "",
      row.role === "buyer" ? row.property.ownerMailingAddress ?? "" : "",
      row.disclaimer ?? "",
      row.signals.map((signal) => signal.signal).join("; "),
      row.signals.map((signal) => signal.action).join("; "),
      row.property.source,
      row.property.sourcePropertyId,
    ].map(escapeCsvValue).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}
