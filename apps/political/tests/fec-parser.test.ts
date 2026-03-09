import test from "node:test";
import assert from "node:assert/strict";

import { parseFecIndividualRecord } from "../src/parsers/fec-individual-parser";

function makeFecLine(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    committeeId: "C001",
    amendmentIndicator: "N",
    reportType: "Q1",
    transactionPgi: "",
    imageNumber: "IMG",
    transactionType: "15",
    entityType: "IND",
    donorNameRaw: "SMITH, JOHN A",
    city: "NEW YORK",
    state: "NY",
    zip: "10001",
    employerRaw: "GOOGLE INC",
    occupationRaw: "ENGINEER",
    transactionDate: "01012026",
    transactionAmount: "2700",
    otherId: "",
    transactionId: "TRX1",
    fileNumber: "10",
    memoCode: "",
    memoText: "",
    subId: "SUB1",
  };
  const merged = { ...defaults, ...overrides };
  return [
    merged.committeeId, merged.amendmentIndicator, merged.reportType,
    merged.transactionPgi, merged.imageNumber, merged.transactionType,
    merged.entityType, merged.donorNameRaw, merged.city, merged.state,
    merged.zip, merged.employerRaw, merged.occupationRaw, merged.transactionDate,
    merged.transactionAmount, merged.otherId, merged.transactionId,
    merged.fileNumber, merged.memoCode, merged.memoText, merged.subId,
  ].join("|");
}

test("parseFecIndividualRecord parses valid IND record", () => {
  const record = parseFecIndividualRecord(makeFecLine());
  assert.ok(record);
  assert.equal(record.firstName, "john");
  assert.equal(record.lastName, "smith");
  assert.equal(record.amount, 2700);
  assert.equal(record.source, "FEC");
});

test("parseFecIndividualRecord accepts empty entity type", () => {
  const record = parseFecIndividualRecord(makeFecLine({ entityType: "" }));
  assert.ok(record, "Empty ENTITY_TP should be accepted (not rejected)");
  assert.equal(record.firstName, "john");
});

test("parseFecIndividualRecord rejects non-IND entity type", () => {
  const record = parseFecIndividualRecord(makeFecLine({ entityType: "ORG" }));
  assert.equal(record, null, "ORG entity type should be rejected");
});

test("parseFecIndividualRecord rejects memo X records", () => {
  const record = parseFecIndividualRecord(makeFecLine({ memoCode: "X" }));
  assert.equal(record, null, "MEMO_CD=X should be rejected (double-counting)");
});

test("parseFecIndividualRecord rejects org names without comma", () => {
  const record = parseFecIndividualRecord(makeFecLine({ donorNameRaw: "ACTBLUE" }));
  assert.equal(record, null, "Org name without comma should be rejected");
});
