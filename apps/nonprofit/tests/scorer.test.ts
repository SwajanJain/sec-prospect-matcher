import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreNonprofitMatch } from "../src/scorer";
import type { NonprofitRecord, ProspectRecord } from "../src/types";

function makeProspect(overrides: Partial<ProspectRecord> = {}): ProspectRecord {
  return {
    prospectId: "P1",
    nameRaw: "Jane Smith",
    firstName: "jane",
    middleName: "",
    middleInitial: "",
    lastName: "smith",
    suffix: "",
    nameNormalized: "jane smith",
    nameNormalizedFull: "jane smith",
    aliasNames: [],
    otherCompanies: [],
    companyRaw: "Acme Health",
    companyNormalized: "acme health",
    allCompaniesNormalized: ["acme health"],
    title: "",
    address: "",
    city: "",
    state: "CA",
    zip: "",
    country: "",
    externalId: "",
    ...overrides,
  };
}

function makeRecord(overrides: Partial<NonprofitRecord> = {}): NonprofitRecord {
  return {
    source: "990-OFFICER",
    sourceSection: "part_vii_section_a",
    filing: {
      ein: "123456789",
      orgName: "Community Outreach Center",
      orgCity: "San Francisco",
      orgState: "CA",
      taxPeriodEnd: "2025-06-30",
      returnType: "990",
      objectId: "filing-1",
    },
    personName: "Jane Smith",
    personNameNormalized: "jane smith",
    firstName: "jane",
    lastName: "smith",
    middleName: "",
    suffix: "",
    title: "Chief Financial Officer",
    normalizedTitle: "chief financial officer",
    titleBucket: "senior_staff",
    role: "officer",
    amount: 250000,
    hoursPerWeek: 40,
    street: "",
    city: "",
    state: "",
    zip: "",
    personLocationSource: "unknown",
    recordFingerprint: "fingerprint",
    withinFilingDuplicateCount: 1,
    ...overrides,
  };
}

describe("scoreNonprofitMatch", () => {
  it("does not treat exact name plus compensation alone as likely", () => {
    const prospect = makeProspect({ companyRaw: "Different Company", companyNormalized: "different company", allCompaniesNormalized: ["different company"], state: "" });
    const record = makeRecord({ title: "Executive Director", normalizedTitle: "executive director", titleBucket: "executive" });
    const result = scoreNonprofitMatch(prospect, record, "exact", {
      nameFrequency: 1,
      prospectCollisionCount: 1,
      repeatedEinPersonCount: 1,
    });

    assert.equal(result.confidenceTier, "Risky");
  });

  it("keeps direct named donors strong when identity is corroborated", () => {
    const prospect = makeProspect({ companyRaw: "", companyNormalized: "", allCompaniesNormalized: [], state: "GA", city: "Atlanta" });
    const record = makeRecord({
      source: "990-PF-DONOR",
      sourceSection: "schedule_b_contributor",
      filing: {
        ein: "987654321",
        orgName: "Smith Family Foundation",
        orgCity: "Atlanta",
        orgState: "GA",
        taxPeriodEnd: "2024-12-31",
        returnType: "990PF",
        objectId: "pf-1",
      },
      title: "",
      normalizedTitle: "",
      titleBucket: "board_trustee",
      role: "donor",
      amount: 100000,
      street: "",
      city: "Atlanta",
      state: "GA",
      zip: "",
      personLocationSource: "person_address",
    });

    const result = scoreNonprofitMatch(prospect, record, "exact", {
      nameFrequency: 1,
      prospectCollisionCount: 1,
      repeatedEinPersonCount: 1,
    });

    // identity signals: city+state match (1) + family foundation affinity (2) → Verified
    assert.equal(result.confidenceTier, "Verified");
  });

  it("routes same-name prospect collisions away from likely", () => {
    const prospect = makeProspect({ companyRaw: "Other Org", companyNormalized: "other org", allCompaniesNormalized: ["other org"] });
    const record = makeRecord({ title: "President", normalizedTitle: "president", titleBucket: "executive" });
    const result = scoreNonprofitMatch(prospect, record, "exact", {
      nameFrequency: 1,
      prospectCollisionCount: 2,
      repeatedEinPersonCount: 1,
    });

    assert.notEqual(result.confidenceTier, "Likely");
    assert.ok(result.conflictFlags.includes("duplicate_prospect_name"));
  });

  it("name-only match without identity corroboration stays Risky", () => {
    const prospect = makeProspect({ state: "", city: "", companyRaw: "Unrelated Corp", companyNormalized: "unrelated corp", allCompaniesNormalized: ["unrelated corp"] });
    const record = makeRecord({
      source: "990-PF-OFFICER",
      sourceSection: "pf_officer_info",
      filing: {
        ein: "111111111",
        orgName: "THE BLOCK FRIEDMAN FAMILY FOUNDATION",
        orgCity: "", orgState: "",
        taxPeriodEnd: "2025-11-30", returnType: "990PF", objectId: "pf-2",
      },
      title: "VICE PRESIDENT", normalizedTitle: "vice president",
      titleBucket: "board_trustee", role: "director",
      amount: 0, street: "", city: "", state: "", zip: "",
      personLocationSource: "unknown",
    });

    const result = scoreNonprofitMatch(prospect, record, "exact", {
      nameFrequency: 1, prospectCollisionCount: 1, repeatedEinPersonCount: 1,
    });

    // No state, no org affinity, no foundation affinity → no identity signals
    assert.equal(result.confidenceTier, "Risky");
  });

  it("city+state match elevates to Likely", () => {
    const prospect = makeProspect({ state: "NY", city: "New York", companyRaw: "Other Co", companyNormalized: "other co", allCompaniesNormalized: ["other co"] });
    const record = makeRecord({
      source: "990-PF-OFFICER",
      sourceSection: "pf_officer_info",
      filing: {
        ein: "222222222",
        orgName: "Some Foundation",
        orgCity: "New York", orgState: "NY",
        taxPeriodEnd: "2025-06-30", returnType: "990PF", objectId: "pf-3",
      },
      title: "PRESIDENT", normalizedTitle: "president",
      titleBucket: "executive", role: "officer",
      amount: 0, street: "", city: "New York", state: "NY", zip: "",
      personLocationSource: "person_address",
    });

    const result = scoreNonprofitMatch(prospect, record, "exact", {
      nameFrequency: 1, prospectCollisionCount: 1, repeatedEinPersonCount: 1,
    });

    // city+state match = 1 identity signal → Likely (not Verified, needs 2)
    assert.equal(result.confidenceTier, "Likely");
  });

  it("requires corroboration for professional staff roles", () => {
    const prospect = makeProspect({ companyRaw: "Finance Co", companyNormalized: "finance co", allCompaniesNormalized: ["finance co"], state: "" });
    const record = makeRecord({
      title: "Nurse Practitioner",
      normalizedTitle: "nurse practitioner",
      titleBucket: "professional_staff",
      role: "key_employee",
    });

    const result = scoreNonprofitMatch(prospect, record, "exact", {
      nameFrequency: 1,
      prospectCollisionCount: 1,
      repeatedEinPersonCount: 1,
    });

    assert.equal(result.confidenceTier, "Review Needed");
    assert.equal(result.reviewBucket, "weak_staff_role");
  });
});
