import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runNonprofitMatcher } from "../src/matcher";

describe("runNonprofitMatcher integration", () => {
  let tmpDir: string;
  let prospectsPath: string;
  // __dirname at runtime is dist/tests/, so go up 2 levels to reach apps/nonprofit/
  const samplesDir = path.join(__dirname, "..", "..", "samples");

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nonprofit-test-"));

    // Create synthetic prospect CSV with names from sample XMLs
    const csv = [
      "prospect_id,prospect_name,prospect_alias_name,prospect_company,prospect_other_company,state",
      'P001,Keith Stump,,"ABLE INDUSTRIES",,CA',
      'P002,Siohvaughn Funches,,,,GA',
      'P003,Jose M Ferrer IV,,"John Oster Foundation",,WI',
      'P004,James W Gorman III,,,,TX',
      'P005,Jennifer Smith,,Acme Corp,,CA',
      'P006,Nobody Matcherson,,,,',
    ].join("\n");

    prospectsPath = path.join(tmpDir, "prospects.csv");
    fs.writeFileSync(prospectsPath, csv, "utf8");
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("matches prospects against sample XMLs and produces output files", () => {
    const outputDir = path.join(tmpDir, "output");
    runNonprofitMatcher({
      prospectsPath,
      xmlDir: samplesDir,
      outputDir,
      verbose: false,
    });

    // client.csv should exist (sample matches have corroboration → Verified/Likely)
    const clientCsvPath = path.join(outputDir, "client.csv");
    assert.ok(fs.existsSync(clientCsvPath), "client.csv should exist");
    const clientContent = fs.readFileSync(clientCsvPath, "utf8");
    const clientLines = clientContent.trim().split("\n");
    assert.ok(clientLines.length >= 2, "should have header + at least 1 match");

    // Verify guide rows + headers exist in content
    assert.ok(clientContent.includes("About This Report"), "should have guide section");
    assert.ok(clientContent.includes("Board/Leadership Role"), "should explain Board/Leadership Role");
    assert.ok(clientContent.includes("Personal Donation"), "should explain Personal Donation");
    assert.ok(clientContent.includes("Foundation Giving"), "should explain Foundation Giving");
    assert.ok(clientContent.includes("Signal Type"), "should have Signal Type header");
    assert.ok(clientContent.includes("Match Quality"), "should have Match Quality header");

    // Keith Stump should match (exact name + org affinity → Verified)
    assert.ok(clientContent.includes("Keith Stump"), "Keith Stump should be in client matches");

    // Siohvaughn Funches should match (donor with state match → Likely)
    assert.ok(clientContent.includes("Siohvaughn Funches"), "Siohvaughn Funches should be in client matches");

    // summary.md should exist
    const summaryPath = path.join(outputDir, "summary.md");
    assert.ok(fs.existsSync(summaryPath), "summary.md should exist");
    const summaryContent = fs.readFileSync(summaryPath, "utf8");
    assert.ok(summaryContent.includes("XML files scanned: 4"), "should report 4 XML files");
    assert.ok(summaryContent.includes("Confidence Tiers"), "summary should include tier counts");

    // Nobody Matcherson should NOT appear in any output
    assert.ok(!clientContent.includes("Nobody Matcherson"), "Nobody should not match");
  });
});
