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
    // State column is critical: exact_name (40) + same_state (20) = 60 (match threshold)
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

    // matches.csv should exist
    const matchesPath = path.join(outputDir, "matches.csv");
    assert.ok(fs.existsSync(matchesPath), "matches.csv should exist");
    const matchesContent = fs.readFileSync(matchesPath, "utf8");
    const matchLines = matchesContent.trim().split("\n");
    assert.ok(matchLines.length >= 2, "should have header + at least 1 match");

    // Verify header
    assert.ok(matchLines[0].includes("Match Confidence"), "header should contain Match Confidence");
    assert.ok(matchLines[0].includes("Organization Name"), "header should contain Organization Name");

    // Keith Stump should match (exact name in 990)
    assert.ok(matchesContent.includes("Keith Stump"), "Keith Stump should be in matches");

    // Siohvaughn Funches should match (appears as donor AND officer)
    assert.ok(matchesContent.includes("Siohvaughn Funches"), "Siohvaughn Funches should be in matches");

    // summary.md should exist
    const summaryPath = path.join(outputDir, "summary.md");
    assert.ok(fs.existsSync(summaryPath), "summary.md should exist");
    const summaryContent = fs.readFileSync(summaryPath, "utf8");
    assert.ok(summaryContent.includes("XML files scanned: 4"), "should report 4 XML files");

    // Nobody Matcherson should NOT appear in matches
    assert.ok(!matchesContent.includes("Nobody Matcherson"), "Nobody should not match");
  });
});
