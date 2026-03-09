// Re-export shared types from @pm/core
export type { PersonNameParts, ProspectRecord, VariantType, EmployerMatchResult, ProspectLoadFailure, ProspectLoadSummary } from "@pm/core";

// Import shared types for use in this file's interfaces
import type { EmployerMatchResult, ProspectLoadSummary, VariantType } from "@pm/core";

export type SourceName = "FEC" | "State" | "527" | "Lobbying";

export interface FetchArtifactMeta {
  source: string;
  status: "complete" | "partial" | "failed";
  fetchedAt: string;
  recordsFetched: number;
  pagesFetched: number;
  requestCount: number;
  error?: string;
}

export interface NormalizedContribution {
  source: SourceName;
  sourceRecordId: string;
  sourceCycle: string;
  sourceEntityType: string;
  donorNameRaw: string;
  donorNameNormalized: string;
  donorNameNormalizedFull: string;
  firstName: string;
  middleName: string;
  middleInitial: string;
  lastName: string;
  suffix: string;
  employerRaw: string;
  employerNormalized: string;
  occupationRaw: string;
  city: string;
  state: string;
  zip: string;
  donationDate: string;
  loadDate: string;
  amount: number;
  currency: string;
  transactionType: string;
  memoFlag: boolean;
  refundFlag: boolean;
  amendmentFlag: boolean;
  recipientId: string;
  recipientName: string;
  recipientType: string;
  committeeId: string;
  candidateId: string;
  party: string;
  office: string;
  officeState: string;
  officeDistrict: string;
  rawRef: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface MatchFeatures {
  exactFullName: boolean;
  exactNormalizedName: boolean;
  nicknameMatch: boolean;
  middleNameAgrees: boolean;
  middleNameConflicts: boolean;
  suffixAgrees: boolean;
  suffixConflicts: boolean;
  employerResult: EmployerMatchResult;
  nameFrequencyBucket: "low" | "medium" | "high";
  candidateProspectCount: number;
  repeatedConsistentRows: number;
  repeatedConflictingRows: number;
  recordCompleteness: number;
  sourceReliability: number;
  variantType: VariantType;
}

export interface MatchScore {
  matchConfidence: number;
  matchQuality: "Verified" | "Likely Match" | "Review Needed" | "Low Confidence";
  matchReason: string;
}

export interface MatchRoute {
  bucket: "accepted" | "review" | "rejected";
  guardrailStatus:
    | "pass"
    | "blocked_employer_conflict"
    | "blocked_extreme_ambiguity"
    | "blocked_weak_nickname_match"
    | "blocked_low_information";
  guardrailReason: string;
}

export interface RecipientEnrichment {
  recipient: string;
  recipientType: string;
  party: string;
  candidateName: string;
  candidateOffice: string;
}

export interface MatchResult {
  runId: string;
  prospectId: string;
  prospectName: string;
  prospectCompany: string;
  matchConfidence: number;
  matchQuality: MatchScore["matchQuality"];
  guardrailStatus: MatchRoute["guardrailStatus"];
  matchReason: string;
  employerMatchStatus: EmployerMatchResult["status"];
  dataSource: SourceName;
  donationAmount: number;
  donationDate: string;
  recipient: string;
  recipientType: string;
  party: string;
  candidateName: string;
  candidateOffice: string;
  donorNameFec: string;
  donorEmployer: string;
  donorOccupation: string;
  donorCityState: string;
  partisanLean: string;
  signalTier: number;
  action: string;
  flags: string[];
  contribution: NormalizedContribution;
}

export interface MatchStats {
  totalRecords: number;
  skippedRecords: number;
  candidatePairs: number;
  matchedRows: number;
  acceptedRows: number;
  reviewRows: number;
  rejectedRows: number;
  matchesBySource: Partial<Record<SourceName, number>>;
  warnings: string[];
}

export interface SourceFreshness {
  source: SourceName;
  fetchedAt: string;
  latestRecordDate: string;
  degraded: boolean;
  details: string;
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  finishedAt: string;
  prospectsPath: string;
  outputDir: string;
  sources: SourceName[];
  freshness: SourceFreshness[];
  prospectLoad?: ProspectLoadSummary;
  counts: MatchStats;
  warnings: string[];
  degradedSources: SourceName[];
  outputs: {
    clientCsv: string;
    reviewCsv: string;
    runSummaryJson: string;
    statsJson: string;
    operatorReportMd: string;
  };
}
