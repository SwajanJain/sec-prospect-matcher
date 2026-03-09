import { MatchFeatures, MatchScore } from "../core/types";

export function scoreMatch(features: MatchFeatures): MatchScore {
  let score = 0;
  const reasons: string[] = [];

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

  if (features.middleNameAgrees) {
    score += 10;
    reasons.push("middle_match");
  }
  if (features.middleNameConflicts) score -= 15;
  if (features.suffixAgrees) score += 5;
  if (features.suffixConflicts) score -= 10;

  score += features.employerResult.scoreImpact;
  if (["confirmed", "likely", "weak_overlap"].includes(features.employerResult.status)) {
    reasons.push(features.employerResult.status);
  }

  if (features.nameFrequencyBucket === "medium") score -= 10;
  if (features.nameFrequencyBucket === "high") score -= 20;

  score += Math.min(features.repeatedConsistentRows * 5, 15);
  score -= Math.min(features.repeatedConflictingRows * 10, 25);
  const matchConfidence = Math.max(0, Math.min(100, score));
  let matchQuality: MatchScore["matchQuality"] = "Low Confidence";
  if (matchConfidence >= 90 && ["confirmed", "likely"].includes(features.employerResult.status)) {
    matchQuality = "Verified";
  } else if (matchConfidence >= 75) {
    matchQuality = "Likely Match";
  } else if (matchConfidence >= 40) {
    matchQuality = "Review Needed";
  }

  return {
    matchConfidence,
    matchQuality,
    matchReason: reasons.slice(0, 2).join("+") || "name_only",
  };
}
