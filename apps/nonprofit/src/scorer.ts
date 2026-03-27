import type {
  ConfidenceTier,
  LocationSupport,
  NonprofitMatchResult,
  NonprofitRecord,
  ReviewBucket,
} from "./types";
import type { ProspectRecord, VariantType } from "./types";
import {
  deriveLocationSupport,
  locationSupportScore,
  scoreFamilyFoundationAffinity,
  scoreOrgAffinity,
} from "./match-utils";

export interface MatchContext {
  nameFrequency: number;
  prospectCollisionCount: number;
  repeatedEinPersonCount: number;
}

type ScoreResult = Pick<
  NonprofitMatchResult,
  | "matchConfidence"
  | "confidenceTier"
  | "routingDecision"
  | "matchReason"
  | "evidenceSignals"
  | "conflictFlags"
  | "prospectCollisionCount"
  | "orgAffinityScore"
  | "locationSupport"
  | "reviewBucket"
>;

function variantScore(variantType: VariantType): number {
  switch (variantType) {
    case "exact":
      return 45;
    case "suffix_stripped":
      return 40;
    case "middle_dropped":
      return 38;
    case "dehyphenated":
    case "initial_variant":
      return 35;
    case "nickname":
      return 24;
  }
}

function titleBucketScore(record: NonprofitRecord): number {
  switch (record.titleBucket) {
    case "board_trustee":
      return 10;
    case "executive":
      return 12;
    case "senior_staff":
      return 5;
    case "professional_staff":
      return -6;
    case "frontline_or_operational":
      return -12;
  }
}

function donorScore(record: NonprofitRecord, signals: string[]): number {
  if (record.source !== "990-PF-DONOR") return 0;
  let score = 25;
  signals.push("direct_named_donor");
  if (record.amount >= 50000) {
    score += 20;
    signals.push("donor_50k");
  } else if (record.amount >= 5000) {
    score += 10;
    signals.push("donor_5k");
  }
  return score;
}

function repeatedHistoryScore(context: MatchContext, signals: string[]): number {
  if (context.repeatedEinPersonCount >= 3) {
    signals.push("repeated_filing_history_3x");
    return 15;
  }
  if (context.repeatedEinPersonCount >= 2) {
    signals.push("repeated_filing_history_2x");
    return 8;
  }
  return 0;
}

function resolveReviewBucket(params: {
  conflictFlags: string[];
  record: NonprofitRecord;
  unresolvedCollision: boolean;
  unresolvedFoundationLink: boolean;
  insufficientCorroboration: boolean;
  nameFrequency: number;
}): ReviewBucket {
  if (params.conflictFlags.includes("duplicate_filing_record")) return "duplicate_filing_record";
  if (params.unresolvedCollision) return "duplicate_prospect_name";
  if (params.unresolvedFoundationLink) return "weak_foundation_link";
  if (params.record.titleBucket === "professional_staff" || params.record.titleBucket === "frontline_or_operational") {
    return "weak_staff_role";
  }
  if (params.nameFrequency >= 5) return "common_name";
  if (params.insufficientCorroboration) return "insufficient_corroboration";
  return "none";
}

function tierPriority(tier: ConfidenceTier): number {
  switch (tier) {
    case "Verified":
      return 4;
    case "Likely":
      return 3;
    case "Risky":
      return 2;
    case "Review Needed":
      return 1;
  }
}

export function compareMatchResults(a: NonprofitMatchResult, b: NonprofitMatchResult): number {
  return (
    tierPriority(b.confidenceTier) - tierPriority(a.confidenceTier) ||
    b.matchConfidence - a.matchConfidence ||
    b.orgAffinityScore - a.orgAffinityScore ||
    b.amount - a.amount ||
    a.prospectName.localeCompare(b.prospectName)
  );
}

export function scoreNonprofitMatch(
  prospect: ProspectRecord,
  record: NonprofitRecord,
  variantType: VariantType,
  context: MatchContext,
): ScoreResult {
  let score = variantScore(variantType);
  const evidenceSignals: string[] = [];
  const conflictFlags: string[] = [];

  if (variantType === "exact") evidenceSignals.push("exact_name");
  else if (variantType === "nickname") evidenceSignals.push("nickname_name");
  else evidenceSignals.push(`variant_${variantType}`);

  score += donorScore(record, evidenceSignals);
  score += titleBucketScore(record);

  const orgAffinityScore = scoreOrgAffinity(prospect, record.filing.orgName);
  if (orgAffinityScore >= 100) {
    score += 35;
    evidenceSignals.push("direct_org_affinity");
  } else if (orgAffinityScore >= 80) {
    score += 28;
    evidenceSignals.push("strong_org_affinity");
  } else if (orgAffinityScore >= 60) {
    score += 16;
    evidenceSignals.push("partial_org_affinity");
  } else if (orgAffinityScore >= 35) {
    score += 8;
    evidenceSignals.push("weak_org_affinity");
  }

  const foundationAffinity = scoreFamilyFoundationAffinity(prospect, record);
  if (foundationAffinity >= 80) {
    score += 25;
    evidenceSignals.push("family_foundation_affinity");
  }

  const locationSupport = deriveLocationSupport(prospect, record);
  score += locationSupportScore(locationSupport);
  if (locationSupport === "person_full_address") evidenceSignals.push("person_full_address_match");
  else if (locationSupport === "person_city_state_zip") evidenceSignals.push("person_city_state_zip_match");
  else if (locationSupport === "person_city_state") evidenceSignals.push("person_city_state_match");
  else if (locationSupport === "person_state") evidenceSignals.push("person_state_match");
  else if (locationSupport === "org_city_state") evidenceSignals.push("org_city_state_match");
  else if (locationSupport === "org_state") evidenceSignals.push("org_state_match");
  else if (locationSupport === "mismatch") conflictFlags.push("location_mismatch");

  score += repeatedHistoryScore(context, evidenceSignals);

  if (record.withinFilingDuplicateCount > 1) {
    conflictFlags.push("duplicate_filing_record");
    score -= 8;
  }

  if (context.nameFrequency >= 10) {
    conflictFlags.push("common_name_10x");
    score -= 18;
  } else if (context.nameFrequency >= 5) {
    conflictFlags.push("common_name_5x");
    score -= 10;
  }

  if (context.prospectCollisionCount > 1) {
    conflictFlags.push("duplicate_prospect_name");
    score -= 22;
  }

  // Identity signals: independent data points beyond name that confirm
  // the 990 record is about THIS prospect, not a different person with the same name.
  const hasLocationIdentity = [
    "person_full_address", "person_city_state_zip", "person_city_state", "person_state",
  ].includes(locationSupport);
  const hasStrongLocation = [
    "person_full_address", "person_city_state_zip",
  ].includes(locationSupport);

  const identitySignalCount = [
    hasLocationIdentity,
    orgAffinityScore >= 60,
    foundationAffinity >= 80,
  ].filter(Boolean).length;

  // Full address match counts double — it's near-certain identity
  const effectiveIdentityCount = hasStrongLocation
    ? identitySignalCount + 1
    : identitySignalCount;

  // Match quality signals (not identity, but relevant for scoring)
  const corroboratorCount = [
    hasLocationIdentity,
    orgAffinityScore >= 60,
    foundationAffinity >= 80,
    context.repeatedEinPersonCount >= 2,
    record.source === "990-PF-DONOR",
  ].filter(Boolean).length;

  const weakStaffRole = record.titleBucket === "professional_staff" || record.titleBucket === "frontline_or_operational";
  if (weakStaffRole) {
    conflictFlags.push("weak_staff_role");
  }

  const unresolvedCollision = context.prospectCollisionCount > 1 && orgAffinityScore < 80 && foundationAffinity < 80;
  const unresolvedFoundationLink = record.source === "990-PF-OFFICER" && foundationAffinity < 80 && orgAffinityScore < 80;
  const insufficientCorroboration = effectiveIdentityCount === 0;

  // Tier assignment: identity verification is a PREREQUISITE, not a bonus.
  // "Verified" = we are confident this is the right person AND the signal is strong.
  // "Likely"   = we have at least one identity corroborator beyond name.
  // "Risky"    = name matched but no identity verification — DO NOT trust donation data.
  let confidenceTier: ConfidenceTier = "Review Needed";
  if (
    score >= 85 &&
    effectiveIdentityCount >= 2 &&
    !unresolvedCollision &&
    !weakStaffRole
  ) {
    confidenceTier = "Verified";
  } else if (
    score >= 70 &&
    effectiveIdentityCount >= 1 &&
    !unresolvedCollision &&
    (!weakStaffRole || effectiveIdentityCount >= 2)
  ) {
    confidenceTier = "Likely";
  } else if (score >= 50 && (!weakStaffRole || effectiveIdentityCount >= 1)) {
    confidenceTier = "Risky";
  }

  if (weakStaffRole && effectiveIdentityCount === 0 && record.source !== "990-PF-DONOR") {
    confidenceTier = "Review Needed";
  }

  const reviewBucket = resolveReviewBucket({
    conflictFlags,
    record,
    unresolvedCollision,
    unresolvedFoundationLink,
    insufficientCorroboration,
    nameFrequency: context.nameFrequency,
  });

  const routingDecision = confidenceTier === "Review Needed" ? "review" : "accepted";
  const clampedScore = Math.max(0, Math.min(100, score));

  return {
    matchConfidence: clampedScore,
    confidenceTier,
    routingDecision,
    matchReason: evidenceSignals.join("+") || "name_only",
    evidenceSignals,
    conflictFlags,
    prospectCollisionCount: context.prospectCollisionCount,
    orgAffinityScore,
    locationSupport,
    reviewBucket: confidenceTier === "Review Needed" ? reviewBucket : reviewBucket === "none" ? "none" : reviewBucket,
  };
}
