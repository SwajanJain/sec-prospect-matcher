import type { ProspectRecord } from "@pm/core";
import type { MatchFeatures, NormalizedContribution } from "../core/types";
import { classifyOccupation } from "./occupation-matcher";

export function generateMatchTags(
  features: MatchFeatures,
  prospect: ProspectRecord,
  record: NormalizedContribution,
): string[] {
  const tags: string[] = [];

  // --- Name tags (hierarchy) ---
  if (features.exactFullName) {
    tags.push("exact_name");
  } else if (features.exactNormalizedName) {
    tags.push("first_last_name_match");
  } else if (features.aliasExactNameMatch) {
    tags.push("alias_exact_name_match");
  } else if (features.aliasFirstLastMatch) {
    tags.push("alias_first_last_name_match");
  } else if (features.nicknameMatch) {
    tags.push("partial_name_match");
  } else if (features.aliasNicknameMatch) {
    tags.push("alias_partial_name_match");
  }

  // --- Company tags ---
  if (features.employerResult.status === "confirmed") {
    tags.push("exact_company_match");
  } else if (features.employerResult.status === "likely" || features.employerResult.status === "weak_overlap") {
    tags.push("partial_company_match");
  }

  // --- Title / Occupation tag ---
  if (prospect.title && record.occupationRaw) {
    const titleCategory = classifyOccupation(prospect.title);
    const occupationCategory = classifyOccupation(record.occupationRaw);
    if (titleCategory && occupationCategory && titleCategory === occupationCategory) {
      tags.push("title_occupation_match");
    }
  }

  // --- Location tags ---
  switch (features.locationMatch.status) {
    case "zip_match":
      tags.push("zip_match");
      break;
    case "city_state_match":
      tags.push("city_state_match");
      break;
    case "city_match":
      tags.push("city_match");
      break;
    case "state_match":
      tags.push("state_match");
      break;
  }

  return tags;
}
