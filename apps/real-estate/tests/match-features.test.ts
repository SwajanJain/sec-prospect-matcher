import test from "node:test";
import assert from "node:assert/strict";

import { buildMatchFeatures } from "../src/lib/match-features";
import type { ProspectRecord } from "@pm/core";
import type { AddressMatchResult, PropertyRecord } from "../src/core/types";

function baseProspect(overrides: Partial<ProspectRecord> = {}): ProspectRecord {
  return {
    prospectId: "p1",
    nameRaw: "John Smith",
    firstName: "john",
    middleName: "",
    lastName: "smith",
    suffix: "",
    normalized: "john smith",
    aliasName: "",
    company: "",
    otherCompany: "",
    city: "Austin",
    state: "TX",
    externalId: "",
    variants: [],
    ...overrides,
  } as ProspectRecord;
}

function baseProperty(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    source: "attom",
    sourcePropertyId: "100",
    situsAddress: "1 Main St",
    situsState: "TX",
    ownerRaw: "JOHN SMITH",
    ownerType: "individual",
    parsedOwners: [],
    ownerMailingState: "TX",
    ...overrides,
  };
}

const mailingCityState: AddressMatchResult = { status: "mailing_city_state", confidence: 75, matchedAgainst: "mailing" };
const noAddress: AddressMatchResult = { status: "mismatch", confidence: 0, matchedAgainst: "none" };

test("stateMatch is true when prospect state matches mailing state", () => {
  const features = buildMatchFeatures({
    prospect: baseProspect({ state: "TX" }),
    property: baseProperty({ ownerMailingState: "TX" }),
    variantType: "exact",
    addressMatch: mailingCityState,
    candidateCount: 1,
    portfolioCorroborationCount: 1,
    changeType: "owner_change",
  });
  assert.equal(features.stateMatch, true);
});

test("stateMatch is true (not penalized) when prospect has no state", () => {
  const features = buildMatchFeatures({
    prospect: baseProspect({ state: "" }),
    property: baseProperty({ ownerMailingState: "TX" }),
    variantType: "exact",
    addressMatch: noAddress,
    candidateCount: 1,
    portfolioCorroborationCount: 1,
    changeType: "owner_change",
  });
  assert.equal(features.stateMatch, true);
});

test("portfolioCorroborationCount is passed through", () => {
  const features = buildMatchFeatures({
    prospect: baseProspect(),
    property: baseProperty(),
    variantType: "exact",
    addressMatch: noAddress,
    candidateCount: 1,
    portfolioCorroborationCount: 3,
    changeType: "owner_change",
  });
  assert.equal(features.portfolioCorroborationCount, 3);
});

test("stateMatch is false when prospect state mismatches both mailing and situs", () => {
  const features = buildMatchFeatures({
    prospect: baseProspect({ state: "CA" }),
    property: baseProperty({ ownerMailingState: "TX", situsState: "TX" }),
    variantType: "exact",
    addressMatch: noAddress,
    candidateCount: 1,
    portfolioCorroborationCount: 1,
    changeType: "owner_change",
  });
  assert.equal(features.stateMatch, false);
});
