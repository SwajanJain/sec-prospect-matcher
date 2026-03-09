import { EmployerMatchResult, MatchFeatures, NormalizedContribution, ProspectRecord, VariantType } from "../core/types";
import { matchEmployer } from "@pm/core";

export interface NameStats {
  donorNameCounts: Map<string, number>;
  prospectNameCounts: Map<string, number>;
}

function getNameFrequencyBucket(count: number): "low" | "medium" | "high" {
  if (count >= 5) return "high";
  if (count >= 2) return "medium";
  return "low";
}

function bestEmployerMatch(prospect: ProspectRecord, donorEmployer: string): EmployerMatchResult {
  const allCompanies = [prospect.companyRaw, ...prospect.otherCompanies].filter(Boolean);
  if (allCompanies.length === 0) {
    return matchEmployer("", donorEmployer);
  }
  let best: EmployerMatchResult | null = null;
  for (const company of allCompanies) {
    const result = matchEmployer(company, donorEmployer);
    if (!best || result.scoreImpact > best.scoreImpact) {
      best = result;
    }
  }
  return best!;
}

export function buildMatchFeatures(
  prospect: ProspectRecord,
  record: NormalizedContribution,
  variantType: VariantType,
  nameStats: NameStats,
): MatchFeatures {
  const donorCount = nameStats.donorNameCounts.get(record.donorNameNormalized) ?? 1;
  const prospectCount = nameStats.prospectNameCounts.get(record.donorNameNormalized) ?? 1;
  const employerResult = bestEmployerMatch(prospect, record.employerRaw);

  return {
    exactFullName: prospect.nameNormalizedFull === record.donorNameNormalizedFull,
    exactNormalizedName: prospect.nameNormalized === record.donorNameNormalized,
    nicknameMatch: variantType === "nickname",
    middleNameAgrees: Boolean(prospect.middleName && record.middleName && prospect.middleInitial === record.middleInitial),
    middleNameConflicts:
      Boolean(prospect.middleInitial && record.middleInitial) && prospect.middleInitial !== record.middleInitial,
    suffixAgrees: Boolean(prospect.suffix && record.suffix && prospect.suffix === record.suffix),
    suffixConflicts: Boolean(prospect.suffix && record.suffix) && prospect.suffix !== record.suffix,
    employerResult,
    nameFrequencyBucket: getNameFrequencyBucket(Math.max(donorCount, prospectCount)),
    candidateProspectCount: prospectCount,
    repeatedConsistentRows: donorCount > 1 && employerResult.status !== "mismatch" ? donorCount - 1 : 0,
    repeatedConflictingRows: donorCount > 1 && employerResult.status === "mismatch" ? donorCount - 1 : 0,
    recordCompleteness: [
      record.city,
      record.state,
      record.employerRaw,
      record.occupationRaw,
      record.donationDate,
    ].filter(Boolean).length,
    sourceReliability: record.source === "FEC" ? 2 : 1,
    variantType,
  };
}
