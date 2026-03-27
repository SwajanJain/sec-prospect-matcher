import { MatchFeatures, MatchRoute, MatchScore } from "../core/types";

export function routeMatch(features: MatchFeatures, score: MatchScore): MatchRoute {
  if (features.locationMatch.status === "state_mismatch") {
    return {
      bucket: "review",
      guardrailStatus: "blocked_state_conflict",
      guardrailReason: features.locationMatch.detail,
    };
  }

  if (
    features.employerResult.status === "mismatch" &&
    features.identitySignalCount < 2
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

  if (features.nicknameMatch && !["confirmed", "likely"].includes(features.employerResult.status) && features.identitySignalCount < 2) {
    return {
      bucket: "review",
      guardrailStatus: "blocked_weak_nickname_match",
      guardrailReason: "Nickname-based match without strong corroboration",
    };
  }

  if (features.identitySignalCount === 0) {
    return {
      bucket: "review",
      guardrailStatus: "blocked_no_corroboration",
      guardrailReason: "Name match without any corroborating signals (employer, location, occupation)",
    };
  }

  return {
    bucket: score.matchConfidence >= 70 ? "accepted" : score.matchConfidence >= 35 ? "review" : "rejected",
    guardrailStatus: "pass",
    guardrailReason: "",
  };
}
