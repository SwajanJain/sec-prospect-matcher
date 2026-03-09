import { ProspectRecord, VariantType, NonprofitRecord } from "./types";

export function scoreNonprofitMatch(
  prospect: ProspectRecord,
  record: NonprofitRecord,
  variantType: VariantType,
  nameFrequency: number,
): { matchConfidence: number; matchQuality: "Verified" | "Likely Match" | "Review Needed"; matchReason: string } {
  let score = 0;
  const signals: string[] = [];

  // Name match quality
  if (variantType === "exact") {
    score += 50;
    signals.push("exact_name");
  } else if (variantType === "nickname") {
    score += 25;
    signals.push("nickname");
  } else {
    score += 35;
    signals.push(`variant_${variantType}`);
  }

  // State matching
  const prospectState = prospect.state?.toUpperCase();
  const recordState = (record.state || record.filing.orgState)?.toUpperCase();
  if (prospectState && recordState && prospectState === recordState) {
    score += variantType === "nickname" ? 10 : 20;
    signals.push("same_state");
  }

  // Donor amount signals
  if (record.source === "990-PF-DONOR") {
    if (record.amount >= 50000) {
      score += 20;
      signals.push("donor_50k");
    } else if (record.amount >= 5000) {
      score += 10;
      signals.push("donor_5k");
    }
  }

  // Compensated board member
  if (record.source !== "990-PF-DONOR" && record.amount > 0) {
    score += 10;
    signals.push("compensated");
  }

  // Name frequency penalty (common names produce false positives)
  if (nameFrequency >= 10) {
    score -= 25;
    signals.push("common_name_10x");
  } else if (nameFrequency >= 5) {
    score -= 15;
    signals.push("common_name_5x");
  }

  const matchReason = signals.join("+");
  const clamped = Math.max(0, Math.min(100, score));

  let matchQuality: "Verified" | "Likely Match" | "Review Needed";
  if (clamped >= 80) matchQuality = "Verified";
  else if (clamped >= 60) matchQuality = "Likely Match";
  else matchQuality = "Review Needed";

  return { matchConfidence: clamped, matchQuality, matchReason };
}
