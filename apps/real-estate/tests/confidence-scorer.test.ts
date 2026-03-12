import test from "node:test";
import assert from "node:assert/strict";

import { scoreMatch } from "../src/lib/confidence-scorer";
import type { MatchFeatures } from "../src/core/types";

function baseFeatures(overrides: Partial<MatchFeatures> = {}): MatchFeatures {
  return {
    variantType: "exact",
    addressStatus: "mismatch",
    stateMatch: true,
    portfolioCorroborationCount: 1,
    changeType: "owner_change",
    ...overrides,
  };
}

test("exact name + owner_change reaches medium quality", () => {
  // exact=50 + change=15 = 65 → medium
  const result = scoreMatch(baseFeatures());
  assert.equal(result.quality, "medium");
  assert.equal(result.combinedScore, 65);
});

test("exact name + mailing city_state reaches high quality", () => {
  // exact=50 + mailing_city_state=35 + change=15 = 100
  const result = scoreMatch(baseFeatures({ addressStatus: "mailing_city_state" }));
  assert.equal(result.quality, "high");
  assert.ok(result.combinedScore >= 80);
});

test("state mismatch penalty is 20 points", () => {
  const base = scoreMatch(baseFeatures());
  const mismatch = scoreMatch(baseFeatures({ stateMatch: false }));
  assert.equal(base.combinedScore - mismatch.combinedScore, 20);
});

test("state mismatch penalty applied", () => {
  const base = scoreMatch(baseFeatures());
  const mismatch = scoreMatch(baseFeatures({ stateMatch: false }));
  assert.equal(base.combinedScore - mismatch.combinedScore, 20);
  assert.ok(mismatch.reasons.includes("penalty:state_mismatch"));
});

test("portfolio noted in reasons but does not inflate score", () => {
  const single = scoreMatch(baseFeatures({ portfolioCorroborationCount: 1 }));
  const multi = scoreMatch(baseFeatures({ portfolioCorroborationCount: 3 }));
  assert.equal(multi.combinedScore, single.combinedScore);
  assert.ok(multi.reasons.some((r) => r.startsWith("portfolio:")));
  assert.ok(!single.reasons.some((r) => r.startsWith("portfolio:")));
});

test("nickname variant scores lower than exact", () => {
  const exact = scoreMatch(baseFeatures({ variantType: "exact" }));
  const nickname = scoreMatch(baseFeatures({ variantType: "nickname" }));
  assert.ok(exact.combinedScore > nickname.combinedScore);
});

test("new_to_cache does not appear in reasons", () => {
  const result = scoreMatch(baseFeatures({ changeType: "new_to_cache" }));
  assert.ok(!result.reasons.some((r) => r.startsWith("change:")));
});

test("no_change gets zero change bonus", () => {
  const result = scoreMatch(baseFeatures({ changeType: "no_change" }));
  assert.ok(!result.reasons.some((r) => r.startsWith("change:")));
});

test("exact name reason shows first_last not exact", () => {
  const result = scoreMatch(baseFeatures({ variantType: "exact" }));
  assert.ok(result.reasons.includes("name:first_last"));
  assert.ok(!result.reasons.includes("name:exact"));
});

test("mailing address outweighs situs address", () => {
  const mailing = scoreMatch(baseFeatures({ addressStatus: "mailing_city_state", changeType: "no_change" }));
  const situs = scoreMatch(baseFeatures({ addressStatus: "situs_city_state", changeType: "no_change" }));
  assert.ok(mailing.combinedScore > situs.combinedScore);
});

test("quality thresholds: high >= 80, medium >= 60, low >= 40, review < 40", () => {
  assert.equal(scoreMatch(baseFeatures({ addressStatus: "mailing_city_state" })).quality, "high"); // 50+35+15=100
  assert.equal(scoreMatch(baseFeatures()).quality, "medium"); // 50+15=65
  assert.equal(scoreMatch(baseFeatures({ variantType: "fuzzy", changeType: "no_change" })).quality, "review"); // 20
});
