import { MatchFeatures, MatchScore } from "../core/types";

export function scoreMatch(features: MatchFeatures): MatchScore {
  let score = 0;
  const reasons: string[] = [];

  // Name base
  if (features.exactFullName) {
    score += 45;
    reasons.push("exact_name");
  } else if (features.exactNormalizedName) {
    score += 40;
    reasons.push("normalized_name");
  } else if (features.nicknameMatch) {
    score += 20;
    reasons.push("nickname");
  }

  // Middle name / suffix (positive only)
  if (features.middleNameAgrees) {
    score += 10;
    reasons.push("middle_match");
  }
  if (features.suffixAgrees) {
    score += 5;
  }

  // Employer (positive only)
  if (features.employerResult.status === "confirmed") {
    score += 35;
    reasons.push("confirmed");
  } else if (features.employerResult.status === "likely") {
    score += 25;
    reasons.push("likely");
  } else if (features.employerResult.status === "weak_overlap") {
    score += 10;
    reasons.push("weak_overlap");
  }

  // Location
  if (features.locationMatch.status === "zip_match") {
    score += 20;
    reasons.push("zip_match");
  } else if (features.locationMatch.status === "city_state_match") {
    score += 15;
    reasons.push("city_state");
  } else if (features.locationMatch.status === "state_match") {
    score += 5;
    reasons.push("state_match");
  }

  // Occupation
  if (features.occupationMatch.status === "corroborated") {
    score += 8;
    reasons.push("occupation");
  }

  // Repeated consistent rows (positive only)
  score += Math.min(features.repeatedConsistentRows * 5, 15);

  // Convergence bonus
  if (features.identitySignalCount >= 3) {
    score += 10;
  } else if (features.identitySignalCount >= 2) {
    score += 5;
  }

  const matchConfidence = Math.max(0, Math.min(100, score));

  let matchQuality: MatchScore["matchQuality"] = "Low Confidence";
  if (matchConfidence >= 85 && (
    features.employerResult.status === "confirmed" ||
    features.employerResult.status === "likely" ||
    features.identitySignalCount >= 2
  )) {
    matchQuality = "Verified";
  } else if (matchConfidence >= 70) {
    matchQuality = "Likely Match";
  } else if (matchConfidence >= 35) {
    matchQuality = "Review Needed";
  }

  return {
    matchConfidence,
    matchQuality,
    matchReason: reasons.slice(0, 3).join("+") || "name_only",
  };
}
