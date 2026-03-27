import fs from "node:fs";
import readline from "node:readline";
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
    signalType: "contribution",
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

export interface FecParseOptions {
  lastNameFilter?: Set<string>;
  minAmount?: number;
  minDate?: string; // ISO date "YYYY-MM-DD"
  maxDate?: string; // ISO date "YYYY-MM-DD"
}

export function parseFecIndividualFile(filePath: string, options?: FecParseOptions | Set<string>): NormalizedContribution[] {
  // Backward compat: accept bare Set as second arg
  const opts: FecParseOptions = options instanceof Set ? { lastNameFilter: options } : (options ?? {});
  const stats = fs.statSync(filePath);
  if (stats.size > 500_000_000) {
    return parseFecIndividualFileStreaming(filePath, opts);
  }
  const content = fs.readFileSync(filePath, "utf8");
  const rows = content.split(/\r?\n/).filter(Boolean);
  return rows
    .map((line, index) => parseFecIndividualRecord(line, `${path.basename(filePath)}:${index + 1}`))
    .filter((row): row is NormalizedContribution => {
      if (!row) return false;
      if (opts.lastNameFilter && !opts.lastNameFilter.has(row.lastName.toUpperCase())) return false;
      if (opts.minAmount && row.amount < opts.minAmount) return false;
      if (opts.minDate && row.donationDate && row.donationDate < opts.minDate) return false;
      if (opts.maxDate && row.donationDate && row.donationDate > opts.maxDate) return false;
      return true;
    });
}

function nthPipeField(line: string, fieldIndex: number): string {
  let start = 0;
  for (let i = 0; i < fieldIndex; i++) {
    const idx = line.indexOf("|", start);
    if (idx === -1) return "";
    start = idx + 1;
  }
  const end = line.indexOf("|", start);
  return end === -1 ? line.slice(start) : line.slice(start, end);
}

function quickFilterLine(line: string, opts: FecParseOptions): boolean {
  // Amount filter (field index 14)
  if (opts.minAmount) {
    const amtStr = nthPipeField(line, 14);
    const amt = Number.parseFloat(amtStr || "0");
    if (amt < opts.minAmount) return false;
  }
  // Date filter (field index 13, MMDDYYYY format)
  if (opts.minDate || opts.maxDate) {
    const dateStr = nthPipeField(line, 13);
    if (dateStr.length === 8) {
      const yyyymmdd = dateStr.slice(4, 8) + dateStr.slice(0, 2) + dateStr.slice(2, 4);
      if (opts.minDate && yyyymmdd < opts.minDate.replace(/-/g, "")) return false;
      if (opts.maxDate && yyyymmdd > opts.maxDate.replace(/-/g, "")) return false;
    }
  }
  // Last name filter (field index 7 = donor name, "LAST, FIRST...")
  if (opts.lastNameFilter) {
    const nameField = nthPipeField(line, 7);
    const commaIdx = nameField.indexOf(",");
    if (commaIdx <= 0) return false;
    const lastName = nameField.slice(0, commaIdx).trim().toUpperCase();
    if (!opts.lastNameFilter.has(lastName)) return false;
  }
  return true;
}

function quickFilterBuffer(buf: Buffer, start: number, end: number, opts: FecParseOptions): boolean {
  const PIPE = 0x7c; // '|'
  const needAmount = !!opts.minAmount;
  const needDate = !!(opts.minDate || opts.maxDate);
  if (!needAmount && !needDate) return true;

  // Date is field 13, amount is field 14 — scan to pipe 15 to extract both
  let pipeCount = 0;
  let f13Start = start;
  let f13End = -1;
  let f14Start = start;

  for (let i = start; i < end; i++) {
    if (buf[i] === PIPE) {
      pipeCount++;
      if (pipeCount === 13) { f13Start = i + 1; }
      if (pipeCount === 14) { f13End = i; f14Start = i + 1; }
      if (pipeCount === 15) {
        if (needAmount) {
          const amtStr = buf.toString("ascii", f14Start, i);
          const amt = Number.parseFloat(amtStr || "0");
          if (amt < opts.minAmount!) return false;
        }
        if (needDate && f13End > 0 && (f13End - f13Start) === 8) {
          // FEC date is MMDDYYYY — rearrange to YYYYMMDD for comparison
          const d = buf.toString("ascii", f13Start, f13End);
          const yyyymmdd = d.slice(4, 8) + d.slice(0, 2) + d.slice(2, 4);
          if (opts.minDate && yyyymmdd < opts.minDate.replace(/-/g, "")) return false;
          if (opts.maxDate && yyyymmdd > opts.maxDate.replace(/-/g, "")) return false;
        }
        break;
      }
    }
  }
  if (pipeCount < 15) return false;
  return true;
}

function parseFecIndividualFileStreaming(filePath: string, opts: FecParseOptions): NormalizedContribution[] {
  const results: NormalizedContribution[] = [];
  const baseName = path.basename(filePath);
  const fd = fs.openSync(filePath, "r");
  const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB chunks
  const buf = Buffer.alloc(CHUNK_SIZE + 4096); // extra for leftover
  let leftoverLen = 0;
  let lineNum = 0;
  let bytesRead: number;
  const NL = 0x0a;
  const CR = 0x0d;

  while ((bytesRead = fs.readSync(fd, buf, leftoverLen, CHUNK_SIZE, null)) > 0) {
    const totalLen = leftoverLen + bytesRead;
    let lineStart = 0;

    for (let i = 0; i < totalLen; i++) {
      if (buf[i] === NL) {
        lineNum++;
        let lineEnd = i;
        if (lineEnd > lineStart && buf[lineEnd - 1] === CR) lineEnd--;

        if (lineEnd > lineStart && quickFilterBuffer(buf, lineStart, lineEnd, opts)) {
          const line = buf.toString("utf8", lineStart, lineEnd);
          if (opts.lastNameFilter) {
            const nameField = nthPipeField(line, 7);
            const commaIdx = nameField.indexOf(",");
            if (commaIdx > 0) {
              const lastName = nameField.slice(0, commaIdx).trim().toUpperCase();
              if (opts.lastNameFilter.has(lastName)) {
                const record = parseFecIndividualRecord(line, `${baseName}:${lineNum}`);
                if (record) results.push(record);
              }
            }
          } else {
            const record = parseFecIndividualRecord(line, `${baseName}:${lineNum}`);
            if (record) results.push(record);
          }
        }

        lineStart = i + 1;
      }
    }

    // Copy leftover bytes to start of buffer
    leftoverLen = totalLen - lineStart;
    if (leftoverLen > 0) {
      buf.copy(buf, 0, lineStart, totalLen);
    }
  }
  fs.closeSync(fd);

  // Handle final line without trailing newline
  if (leftoverLen > 0) {
    lineNum++;
    let lineEnd = leftoverLen;
    if (buf[lineEnd - 1] === CR) lineEnd--;
    if (lineEnd > 0 && quickFilterBuffer(buf, 0, lineEnd, opts)) {
      const line = buf.toString("utf8", 0, lineEnd);
      const record = parseFecIndividualRecord(line, `${baseName}:${lineNum}`);
      if (record) results.push(record);
    }
  }

  return results;
}
