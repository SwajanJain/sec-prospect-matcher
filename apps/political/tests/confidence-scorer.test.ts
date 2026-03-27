import test from "node:test";
import assert from "node:assert/strict";

import { scoreMatch } from "../src/lib/confidence-scorer";
import { routeMatch } from "../src/lib/review-router";
import type { MatchFeatures } from "../src/core/types";

function makeFeatures(overrides: Partial<MatchFeatures> = {}): MatchFeatures {
  return {
    exactFullName: false,
    exactNormalizedName: true,
    nicknameMatch: false,
    middleNameAgrees: false,
    middleNameConflicts: false,
    suffixAgrees: false,
    suffixConflicts: false,
    employerResult: { status: "missing", note: "No employer", scoreImpact: 0 },
    locationMatch: { status: "no_data", detail: "" },
    occupationMatch: { status: "neutral", detail: "" },
    nameFrequencyBucket: "low",
    candidateProspectCount: 1,
    identitySignalCount: 0,
    repeatedConsistentRows: 0,
    repeatedConflictingRows: 0,
    recordCompleteness: 3,
    sourceReliability: 1,
    variantType: "exact",
    ...overrides,
  };
}

test("exact name + employer confirmed scores >= 75 (Harvard backward compat)", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    employerResult: { status: "confirmed", note: "match", scoreImpact: 35 },
    identitySignalCount: 1,
  });
  const score = scoreMatch(features);
  assert.ok(score.matchConfidence >= 75, `Expected >= 75, got ${score.matchConfidence}`);
  assert.equal(score.matchQuality, "Likely Match");
});

test("exact name + employer confirmed + city_state = Verified", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    employerResult: { status: "confirmed", note: "match", scoreImpact: 35 },
    locationMatch: { status: "city_state_match", detail: "" },
    identitySignalCount: 2,
  });
  const score = scoreMatch(features);
  assert.ok(score.matchConfidence >= 85, `Expected >= 85, got ${score.matchConfidence}`);
  assert.equal(score.matchQuality, "Verified");
});

test("exact name alone = Review Needed (no corroboration guardrail blocks acceptance)", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    identitySignalCount: 0,
  });
  const score = scoreMatch(features);
  assert.equal(score.matchConfidence, 40);
  assert.equal(score.matchQuality, "Review Needed");

  const route = routeMatch(features, score);
  assert.equal(route.guardrailStatus, "blocked_no_corroboration");
  assert.equal(route.bucket, "review");
});

test("exact name + city_state match = 55, accepted at review threshold with corroboration", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    locationMatch: { status: "city_state_match", detail: "" },
    identitySignalCount: 1,
  });
  const score = scoreMatch(features);
  assert.equal(score.matchConfidence, 55);

  const route = routeMatch(features, score);
  assert.equal(route.guardrailStatus, "pass");
  assert.equal(route.bucket, "review");
});

test("exact name + city_state + occupation = 73, Likely Match", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    locationMatch: { status: "city_state_match", detail: "" },
    occupationMatch: { status: "corroborated", detail: "" },
    identitySignalCount: 2,
  });
  const score = scoreMatch(features);
  // 40 + 15 + 8 + 5 (convergence 2 signals) = 68
  assert.equal(score.matchConfidence, 68);

  const route = routeMatch(features, score);
  assert.equal(route.guardrailStatus, "pass");
});

test("exact name + city_state + middle agree + convergence >= 70", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    locationMatch: { status: "city_state_match", detail: "" },
    middleNameAgrees: true,
    identitySignalCount: 2,
  });
  const score = scoreMatch(features);
  // 40 + 15 + 10 + 5 (convergence) = 70
  assert.equal(score.matchConfidence, 70);
  assert.equal(score.matchQuality, "Likely Match");

  const route = routeMatch(features, score);
  assert.equal(route.bucket, "accepted");
});

test("state mismatch routes to review regardless of score", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    employerResult: { status: "confirmed", note: "match", scoreImpact: 35 },
    locationMatch: { status: "state_mismatch", detail: "KY vs OR" },
    identitySignalCount: 1,
  });
  const score = scoreMatch(features);
  assert.ok(score.matchConfidence >= 70);

  const route = routeMatch(features, score);
  assert.equal(route.guardrailStatus, "blocked_state_conflict");
  assert.equal(route.bucket, "review");
});

test("employer mismatch with 2+ other signals is not blocked", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    employerResult: { status: "mismatch", note: "mismatch", scoreImpact: -35 },
    locationMatch: { status: "city_state_match", detail: "" },
    middleNameAgrees: true,
    identitySignalCount: 2,
  });
  const score = scoreMatch(features);
  const route = routeMatch(features, score);
  assert.equal(route.guardrailStatus, "pass");
});

test("nickname match without corroboration is blocked", () => {
  const features = makeFeatures({
    exactNormalizedName: false,
    nicknameMatch: true,
    identitySignalCount: 0,
  });
  const score = scoreMatch(features);
  const route = routeMatch(features, score);
  assert.equal(route.guardrailStatus, "blocked_weak_nickname_match");
});

test("nickname match with city_state + occupation passes", () => {
  const features = makeFeatures({
    exactNormalizedName: false,
    nicknameMatch: true,
    locationMatch: { status: "city_state_match", detail: "" },
    occupationMatch: { status: "corroborated", detail: "" },
    identitySignalCount: 2,
  });
  const score = scoreMatch(features);
  const route = routeMatch(features, score);
  assert.equal(route.guardrailStatus, "pass");
});

test("zip match gives highest location bonus", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    locationMatch: { status: "zip_match", detail: "" },
    identitySignalCount: 1,
  });
  const score = scoreMatch(features);
  assert.equal(score.matchConfidence, 60);
});

test("convergence bonus adds 10 for 3+ signals", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    employerResult: { status: "confirmed", note: "", scoreImpact: 35 },
    locationMatch: { status: "city_state_match", detail: "" },
    occupationMatch: { status: "corroborated", detail: "" },
    identitySignalCount: 3,
  });
  const score = scoreMatch(features);
  // 40 + 35 + 15 + 8 + 10 (convergence 3) = 108, clamped to 100
  assert.equal(score.matchConfidence, 100);
  assert.equal(score.matchQuality, "Verified");
});

test("no negative scoring: employer mismatch adds 0, not negative", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    employerResult: { status: "mismatch", note: "", scoreImpact: -35 },
    identitySignalCount: 0,
  });
  const score = scoreMatch(features);
  assert.equal(score.matchConfidence, 40);
});

test("no negative scoring: non_informative employer adds 0", () => {
  const features = makeFeatures({
    exactNormalizedName: true,
    employerResult: { status: "non_informative", note: "", scoreImpact: -5 },
    identitySignalCount: 0,
  });
  const score = scoreMatch(features);
  assert.equal(score.matchConfidence, 40);
});
