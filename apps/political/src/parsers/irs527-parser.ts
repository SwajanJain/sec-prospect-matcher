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

  return {
    source: "527",
    sourceRecordId: columns[2] || `${columns[1]}-${columns[2]}`,
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
    donationDate: (columns[16] || "").trim(),
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
      formId: columns[1] || "",
    },
  };
}

export function parse527File(filePath: string): NormalizedContribution[] {
  const rows = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  return rows
    .map((line, index) => parse527Record(line, `${path.basename(filePath)}:${index + 1}`))
    .filter((row): row is NormalizedContribution => row !== null);
}
