import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createLogger, parsePersonName, StateStore, stripLegalSuffixes } from "@pm/core";
import { PoliticalMatcher } from "../src/core/PoliticalMatcher";
import type { NormalizedContribution } from "../src/core/types";

function writeFixture(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeContribution(overrides: Partial<NormalizedContribution> & { donorNameRaw: string }): NormalizedContribution {
  const parsed = parsePersonName(overrides.donorNameRaw);
  if (!parsed) throw new Error(`Could not parse donor name: ${overrides.donorNameRaw}`);

  const base: NormalizedContribution = {
    source: "527",
    signalType: "contribution",
    sourceRecordId: "row-1",
    sourceCycle: "2026",
    sourceEntityType: "IND",
    donorNameRaw: overrides.donorNameRaw,
    donorNameNormalized: parsed.normalized,
    donorNameNormalizedFull: parsed.normalizedFull,
    firstName: parsed.firstName,
    middleName: parsed.middleName,
    middleInitial: parsed.middleInitial,
    lastName: parsed.lastName,
    suffix: parsed.suffix,
    employerRaw: "Example Org",
    employerNormalized: stripLegalSuffixes("Example Org"),
    occupationRaw: "EXECUTIVE",
    city: "Washington",
    state: "DC",
    zip: "20001",
    donationDate: "2026-03-20",
    loadDate: "2026-03-26T00:00:00.000Z",
    amount: 250,
    currency: "USD",
    transactionType: "CONTRIBUTION",
    memoFlag: false,
    refundFlag: false,
    amendmentFlag: false,
    recipientId: "R1",
    recipientName: "Example Recipient",
    recipientType: "527",
    committeeId: "",
    candidateId: "",
    party: "UNKNOWN",
    office: "",
    officeState: "",
    officeDistrict: "",
    rawRef: "fixture",
    metadata: {},
  };

  return {
    ...base,
    ...overrides,
    metadata: {
      ...base.metadata,
      ...(overrides.metadata ?? {}),
    },
  };
}

test("PoliticalMatcher emits mixed FEC, 527, and lobbying rows with signal types", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfund-test-"));
  const stateStore = new StateStore(path.join(tempDir, ".pfund"));
  stateStore.ensure();
  const outputDir = path.join(tempDir, "runs");

  writeFixture(
    path.join(tempDir, "prospects.csv"),
    [
      "prospect_id,name,company,city,state",
      "p1,John Smith,Google,Mountain View,CA",
      "p2,William Smith,Microsoft,Seattle,WA",
      "p3,Jane Lobbyist,Public Affairs Group,Washington,DC",
      "p4,Alice Donor,Google,Washington,DC",
    ].join("\n"),
  );

  writeFixture(
    path.join(stateStore.paths.lookups, "cm.txt"),
    "C001|BIDEN FOR PRESIDENT|TREASURER|PO BOX 1||WASHINGTON|DC|20001|P|P|DEM|Q|C||C001CAND\n",
  );
  writeFixture(
    path.join(stateStore.paths.lookups, "cn.txt"),
    "C001CAND|BIDEN, JOSEPH|DEM|2024|US|P|00\n",
  );
  writeFixture(
    path.join(stateStore.paths.lookups, "ccl.txt"),
    "C001CAND|2024|2024|C001|P|P|1\n",
  );

  writeFixture(
    path.join(stateStore.paths.recent, "fec-individual.txt"),
    [
      "C001|N|Q1||IMG|15|IND|SMITH, JOHN A JR|MOUNTAIN VIEW|CA|94043|GOOGLE INC|ENGINEER|01012026|3500||TRX1|10|||SUB1",
      "C001|N|Q1||IMG|15|IND|SMITH, WILLIAM|SEATTLE|WA|98101|APPLE|MANAGER|01022026|500||TRX2|11|||SUB2",
    ].join("\n"),
  );

  writeJson(path.join(stateStore.paths.recent, "irs527.json"), [
    makeContribution({
      source: "527",
      signalType: "contribution",
      sourceRecordId: "irs-1",
      donorNameRaw: "DONOR, ALICE",
      employerRaw: "Google",
      employerNormalized: stripLegalSuffixes("Google"),
      recipientName: "Progressive Coalition",
      recipientType: "527",
      amount: 500,
      donationDate: "2026-03-18",
    }),
  ]);
  writeJson(path.join(stateStore.paths.recent, "irs527.meta.json"), {
    source: "527",
    status: "complete",
    fetchedAt: "2026-03-26T00:00:00.000Z",
    recordsFetched: 1,
    pagesFetched: 1,
    requestCount: 0,
    mode: "diff",
  });

  writeJson(path.join(stateStore.paths.recent, "lda.json"), [
    makeContribution({
      source: "Lobbying",
      signalType: "registration",
      sourceRecordId: "registration:301:401",
      donorNameRaw: "LOBBYIST, JANE",
      employerRaw: "Public Affairs Group",
      employerNormalized: stripLegalSuffixes("Public Affairs Group"),
      occupationRaw: "LOBBYIST",
      donationDate: "",
      loadDate: "2026-03-26T00:00:00.000Z",
      amount: 0,
      transactionType: "REGISTRATION",
      recipientId: "401",
      recipientName: "Public Affairs Group",
      recipientType: "Lobbying Firm",
      party: "",
      metadata: {
        lobbyistId: 301,
        registrantId: 401,
      },
    }),
  ]);
  writeJson(path.join(stateStore.paths.recent, "lda.meta.json"), {
    source: "Lobbying",
    status: "complete",
    fetchedAt: "2026-03-26T00:00:00.000Z",
    recordsFetched: 1,
    pagesFetched: 1,
    requestCount: 1,
    mode: "posted_overlap_1d",
    authenticated: false,
    contributionRows: 0,
    registrationRows: 1,
  });

  const matcher = new PoliticalMatcher({
    runId: "test-run",
    logger: createLogger(false),
    stateStore,
    outputDir,
    maxProspectSkipRate: 0.05,
  });

  const manifest = matcher.execute(path.join(tempDir, "prospects.csv"));
  const clientCsv = fs.readFileSync(manifest.outputs.clientCsv, "utf8");
  const reviewCsv = fs.readFileSync(manifest.outputs.reviewCsv, "utf8");
  const combinedCsv = `${clientCsv}\n${reviewCsv}`;

  assert.match(clientCsv, /Signal Type/);
  assert.match(clientCsv, /Location Match/);
  assert.match(clientCsv, /Prospect City\/State/);
  assert.match(combinedCsv, /John Smith/);
  assert.match(combinedCsv, /Alice Donor/);
  assert.match(combinedCsv, /Jane Lobbyist/);
  assert.match(combinedCsv, /Registration/);
  assert.match(combinedCsv, /\$0\.00/);
  assert.match(combinedCsv, /Registered Lobbyist/);
  assert.match(combinedCsv, /Progressive Coalition/);
  assert.match(combinedCsv, /city_state_match|state_match|zip_match/);
  assert.match(reviewCsv, /William Smith/);
  assert.ok(manifest.warnings.includes("LDA fetch ran without LDA_API_KEY; anonymous rate limits may reduce freshness."));
});
