import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseIrsXml } from "../src/xml-parser";

// __dirname at runtime is dist/tests/, so go up 2 levels to reach apps/nonprofit/
const SAMPLES_DIR = path.join(__dirname, "..", "..", "samples");

function loadSample(filename: string): string {
  return fs.readFileSync(path.join(SAMPLES_DIR, filename), "utf8");
}

describe("parseIrsXml", () => {
  it("parses 990-PF with donors (sample-990pf-with-donors.xml)", () => {
    const xml = loadSample("sample-990pf-with-donors.xml");
    const { records, grants } = parseIrsXml(xml, "test-990pf-donors");

    // Header
    const filing = records[0]?.filing;
    assert.ok(filing, "should have at least one record");
    assert.equal(filing.ein, "208765349");
    assert.equal(filing.orgName, "A WOMANS WORTH FOUNDATION INC");
    assert.equal(filing.orgState, "GA");
    assert.equal(filing.returnType, "990PF");
    assert.equal(filing.taxPeriodEnd, "2024-12-31");

    // Donors
    const donors = records.filter((r) => r.source === "990-PF-DONOR");
    assert.equal(donors.length, 2, "should have 2 person donors");
    assert.equal(donors[0].personName, "DARLENE FUNCHES");
    assert.equal(donors[0].amount, 9518);
    assert.equal(donors[0].state, "IL");
    assert.equal(donors[1].personName, "SIOHVAUGHN FUNCHES");
    assert.equal(donors[1].amount, 23400);

    // Officers
    const officers = records.filter((r) => r.source === "990-PF-OFFICER");
    assert.equal(officers.length, 1, "should have 1 officer");
    assert.equal(officers[0].personName, "SIOHVAUGHN FUNCHES");
    assert.equal(officers[0].title, "DIRECTOR");
    assert.equal(officers[0].role, "director");

    // Grants
    assert.equal(grants.length, 1, "should have 1 grant");
    assert.equal(grants[0].recipientName, "MISC RECIPIENTS");
    assert.equal(grants[0].amount, 13294);
  });

  it("parses 990 with officers (sample-990.xml)", () => {
    const xml = loadSample("sample-990.xml");
    const { records, grants } = parseIrsXml(xml, "test-990");

    // Header
    const filing = records[0]?.filing;
    assert.ok(filing);
    assert.equal(filing.ein, "946086713");
    assert.equal(filing.orgName, "ABLE INDUSTRIES");
    assert.equal(filing.returnType, "990");

    // All should be 990-OFFICER
    assert.ok(records.every((r) => r.source === "990-OFFICER"));
    assert.equal(records.length, 12, "should have 12 officers");

    // Spot check executive director
    const keith = records.find((r) => r.personName === "KEITH STUMP");
    assert.ok(keith);
    assert.equal(keith.title, "Executive Dir.");
    assert.equal(keith.amount, 108997);
    assert.equal(keith.role, "officer");

    // Directors
    const jennifer = records.find((r) => r.personName === "JENNIFER SMITH");
    assert.ok(jennifer);
    assert.equal(jennifer.role, "director");

    // No grants on 990
    assert.equal(grants.length, 0);
  });

  it("parses 990-PF officers without Schedule B (sample-990pf.xml)", () => {
    const xml = loadSample("sample-990pf.xml");
    const { records, grants } = parseIrsXml(xml, "test-990pf");

    const filing = records[0]?.filing;
    assert.ok(filing);
    assert.equal(filing.ein, "396057530");
    assert.equal(filing.orgName, "JOHN OSTER FAMILY FOUNDATION INC");

    // Officers only (no Schedule B donors)
    const donors = records.filter((r) => r.source === "990-PF-DONOR");
    assert.equal(donors.length, 0, "no donors expected");

    const officers = records.filter((r) => r.source === "990-PF-OFFICER");
    assert.ok(officers.length >= 2, "should have at least 2 officers");

    const jose = officers.find((r) => r.lastName === "ferrer");
    assert.ok(jose, "should find JOSE M FERRER IV");
    assert.equal(jose.suffix, "iv");
    assert.equal(jose.role, "trustee");

    // Should have grants
    assert.ok(grants.length >= 3, "should have grants from SupplementaryInformationGrp");
  });

  it("parses 990-PF with name annotation (sample-990pf-2.xml)", () => {
    const xml = loadSample("sample-990pf-2.xml");
    const { records, grants } = parseIrsXml(xml, "test-990pf-2");

    const filing = records[0]?.filing;
    assert.ok(filing);
    assert.equal(filing.ein, "742822598");
    assert.equal(filing.orgName, "THE GORMAN FOUNDATION");

    // Officer with "AS OF JUNE 2024" annotation should be cleaned
    const michael = records.find((r) => r.firstName === "michael" && r.lastName === "schott");
    assert.ok(michael, "should parse MICHAEL A SCHOTT despite 'AS OF JUNE 2024' annotation");
    assert.equal(michael.middleName, "a");

    // James W Gorman III
    const james = records.find((r) => r.firstName === "james" && r.lastName === "gorman");
    assert.ok(james);
    assert.equal(james.suffix, "iii");

    // Should have grants
    assert.ok(grants.length >= 5, "should have multiple grants");
  });
});
