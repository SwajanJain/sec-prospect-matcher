import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { PoliticalMatcher } from "../src/core/PoliticalMatcher";
import { createLogger, StateStore } from "@pm/core";

function writeFixture(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("PoliticalMatcher produces client and review CSVs from staged FEC files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfund-test-"));
  const stateStore = new StateStore(path.join(tempDir, ".pfund"));
  stateStore.ensure();
  const outputDir = path.join(tempDir, "runs");

  writeFixture(
    path.join(tempDir, "prospects.csv"),
    [
      "prospect_id,name,company",
      "p1,John Smith,Google",
      "p2,William Smith,Microsoft",
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

  assert.match(clientCsv, /John Smith/);
  assert.match(clientCsv, /BIDEN FOR PRESIDENT/);
  assert.match(reviewCsv, /William Smith/);
});
