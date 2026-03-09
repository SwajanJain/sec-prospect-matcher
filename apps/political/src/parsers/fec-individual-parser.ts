import fs from "node:fs";
import path from "node:path";

import { NormalizedContribution } from "../core/types";
import { stripLegalSuffixes, parseFecName } from "@pm/core";

function parseDate(value: string): string {
  if (!value || value.length !== 8) return "";
  return `${value.slice(4, 8)}-${value.slice(0, 2)}-${value.slice(2, 4)}`;
}

function normalizeParty(rawParty: string): string {
  if (rawParty === "DEM") return "DEM";
  if (rawParty === "REP") return "REP";
  return rawParty || "UNKNOWN";
}

export function parseFecIndividualRecord(line: string, rawRef = ""): NormalizedContribution | null {
  const columns = line.split("|");
  if (columns.length < 21) return null;

  const [
    committeeId,
    amendmentIndicator,
    reportType,
    _transactionPgi,
    _imageNumber,
    transactionType,
    entityType,
    donorNameRaw,
    city,
    state,
    zip,
    employerRaw,
    occupationRaw,
    transactionDate,
    transactionAmount,
    _otherId,
    transactionId,
    fileNumber,
    memoCode,
    _memoText,
    subId,
  ] = columns;

  if (!donorNameRaw || !donorNameRaw.includes(",") || memoCode === "X" || (entityType && entityType !== "IND")) {
    return null;
  }

  const parsedName = parseFecName(donorNameRaw);
  if (!parsedName) return null;

  const amount = Number.parseFloat(transactionAmount || "0");

  return {
    source: "FEC",
    sourceRecordId: subId || transactionId || `${committeeId}-${fileNumber}`,
    sourceCycle: reportType,
    sourceEntityType: entityType,
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
    occupationRaw,
    city,
    state,
    zip,
    donationDate: parseDate(transactionDate),
    loadDate: "",
    amount,
    currency: "USD",
    transactionType,
    memoFlag: memoCode === "X",
    refundFlag: amount < 0,
    amendmentFlag: amendmentIndicator === "A",
    recipientId: committeeId,
    recipientName: "",
    recipientType: "",
    committeeId,
    candidateId: "",
    party: normalizeParty(""),
    office: "",
    officeState: "",
    officeDistrict: "",
    rawRef,
    metadata: {
      amendmentIndicator,
      reportType,
      transactionId,
      fileNumber,
    },
  };
}

export function parseFecIndividualFile(filePath: string): NormalizedContribution[] {
  const content = fs.readFileSync(filePath, "utf8");
  const rows = content.split(/\r?\n/).filter(Boolean);
  return rows
    .map((line, index) => parseFecIndividualRecord(line, `${path.basename(filePath)}:${index + 1}`))
    .filter((row): row is NormalizedContribution => row !== null);
}
