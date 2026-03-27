import fs from "node:fs";
import path from "node:path";

import { NormalizedContribution } from "../core/types";
import { parsePersonName, stripLegalSuffixes } from "@pm/core";

// IRS 527 Schedule A (skeda.txt) column layout (pipe-delimited, 17 fields):
// 0: Record type ("A")
// 1: Form ID number
// 2: Schedule A ID
// 3: Organization name (recipient)
// 4: EIN
// 5: Contributor name
// 6: Contributor address line 1
// 7: Contributor address line 2
// 8: Contributor city
// 9: Contributor state
// 10: Contributor ZIP code
// 11: Contributor ZIP extension
// 12: Contributor employer
// 13: Contribution amount
// 14: Contributor occupation
// 15: Aggregate contribution YTD
// 16: Contribution date

export function normalize527Date(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }

  const mmddyyyy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return trimmed;
}

export function parse527Record(line: string, rawRef = ""): NormalizedContribution | null {
  const columns = line.split("|");
  if (columns.length < 17) return null;
  if (columns[0] !== "A") return null;

  const donorNameRaw = (columns[5] || "").trim();
  const parsedName = parsePersonName(donorNameRaw);
  if (!parsedName) return null;

  const amount = Number.parseFloat(columns[13] || "0");
  const recipientName = (columns[3] || "").trim();
  const employerRaw = (columns[12] || "").trim();
  const scheduleAId = (columns[2] || "").trim();
  const formId = (columns[1] || "").trim();

  return {
    source: "527",
    signalType: "contribution",
    sourceRecordId: scheduleAId || `${formId}:${donorNameRaw}:${columns[13] || ""}:${columns[16] || ""}`,
    sourceCycle: "",
    sourceEntityType: "IND",
    donorNameRaw,
    donorNameNormalized: parsedName.normalized,
    donorNameNormalizedFull: parsedName.normalizedFull,
    firstName: parsedName.firstName,
    middleName: parsedName.middleName,
    middleInitial: parsedName.middleInitial,
    lastName: parsedName.lastName,
    suffix: parsedName.suffix,
    employerRaw,
    employerNormalized: stripLegalSuffixes(employerRaw),
    occupationRaw: (columns[14] || "").trim(),
    city: (columns[8] || "").trim(),
    state: (columns[9] || "").trim(),
    zip: (columns[10] || "").trim(),
    donationDate: normalize527Date(columns[16] || ""),
    loadDate: "",
    amount,
    currency: "USD",
    transactionType: "CONTRIBUTION",
    memoFlag: false,
    refundFlag: amount < 0,
    amendmentFlag: false,
    recipientId: (columns[4] || "").trim(),
    recipientName,
    recipientType: "527",
    committeeId: "",
    candidateId: "",
    party: "UNKNOWN",
    office: "",
    officeState: "",
    officeDistrict: "",
    rawRef,
    metadata: {
      formId,
      scheduleAId,
    },
  };
}

export function parse527File(filePath: string): NormalizedContribution[] {
  const rows = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  return rows
    .map((line, index) => parse527Record(line, `${path.basename(filePath)}:${index + 1}`))
    .filter((row): row is NormalizedContribution => row !== null);
}
