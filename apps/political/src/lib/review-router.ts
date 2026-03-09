import { MatchFeatures, MatchRoute, MatchScore } from "../core/types";

export function routeMatch(features: MatchFeatures, score: MatchScore): MatchRoute {
  if (
    features.employerResult.status === "mismatch" &&
    score.matchConfidence < 90
  ) {
    return {
      bucket: "review",
      guardrailStatus: "blocked_employer_conflict",
      guardrailReason: features.employerResult.note,
    };
  }

  if (features.nameFrequencyBucket === "high" && features.candidateProspectCount >= 3) {
    return {
      bucket: "review",
      guardrailStatus: "blocked_extreme_ambiguity",
      guardrailReason: "Common name with multiple matching prospects",
    };
  }

  if (features.nicknameMatch && !["confirmed", "likely"].includes(features.employerResult.status)) {
    return {
      bucket: "review",
      guardrailStatus: "blocked_weak_nickname_match",
      guardrailReason: "Nickname-based match without strong employer support",
    };
  }

  if (features.recordCompleteness <= 1) {
    return {
      bucket: "review",
      guardrailStatus: "blocked_low_information",
      guardrailReason: "Low-information donor record",
    };
  }

  return {
    bucket: score.matchConfidence >= 75 ? "accepted" : score.matchConfidence >= 40 ? "review" : "rejected",
    guardrailStatus: "pass",
    guardrailReason: "",
  };
}
