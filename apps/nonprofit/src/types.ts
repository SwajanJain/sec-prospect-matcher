// Re-export shared types from @pm/core
export type { ProspectRecord, VariantType, PersonNameParts } from "@pm/core";

export type NonprofitSource = "990-PF-DONOR" | "990-PF-OFFICER" | "990-OFFICER";
export type NonprofitSourceSection =
  | "schedule_b_contributor"
  | "pf_officer_info"
  | "part_vii_section_a"
  | "schedule_j_related_org";
export type TitleBucket =
  | "board_trustee"
  | "executive"
  | "senior_staff"
  | "professional_staff"
  | "frontline_or_operational";
export type PersonLocationSource = "person_address" | "filing_org" | "unknown";
export type ConfidenceTier = "Verified" | "Likely" | "Risky" | "Review Needed";
export type RoutingDecision = "accepted" | "review" | "suppressed";
export type ReviewBucket =
  | "none"
  | "duplicate_prospect_name"
  | "weak_staff_role"
  | "duplicate_filing_record"
  | "weak_foundation_link"
  | "common_name"
  | "insufficient_corroboration";
export type LocationSupport =
  | "person_full_address"
  | "person_city_state_zip"
  | "person_city_state"
  | "person_state"
  | "org_city_state"
  | "org_state"
  | "mismatch"
  | "unknown";
export type FoundationLinkStatus = "verified_foundation_link" | "ambiguous_foundation_link";

/** Filing metadata from XML header */
export interface FilingHeader {
  ein: string;
  orgName: string;
  orgCity: string;
  orgState: string;
  taxPeriodEnd: string;
  returnType: "990" | "990PF";
  objectId: string;
}

/** Person record extracted from a filing (officer or donor) */
export interface NonprofitRecord {
  source: NonprofitSource;
  sourceSection: NonprofitSourceSection;
  filing: FilingHeader;
  personName: string;
  personNameNormalized: string;
  firstName: string;
  lastName: string;
  middleName: string;
  suffix: string;
  title: string;
  normalizedTitle: string;
  titleBucket: TitleBucket;
  role: string;
  amount: number;
  hoursPerWeek: number;
  street: string;
  city: string;
  state: string;
  zip: string;
  personLocationSource: PersonLocationSource;
  recordFingerprint: string;
  withinFilingDuplicateCount: number;
}

/** Grant from 990-PF Part XV */
export interface GrantRecord {
  filing: FilingHeader;
  recipientName: string;
  recipientCity: string;
  recipientState: string;
  amount: number;
  purpose: string;
}

/** Match result for CSV output */
export interface NonprofitMatchResult {
  matchConfidence: number;
  confidenceTier: ConfidenceTier;
  routingDecision: RoutingDecision;
  prospectId: string;
  prospectName: string;
  prospectCompany: string;
  prospectCityState: string;
  irsPersonName: string;
  irsPersonAddress: string;
  recordType: NonprofitSource;
  orgName: string;
  orgEin: string;
  personRole: string;
  title: string;
  amount: number;
  taxPeriod: string;
  personCityState: string;
  orgState: string;
  filingId: string;
  matchReason: string;
  evidenceSignals: string[];
  conflictFlags: string[];
  prospectCollisionCount: number;
  orgAffinityScore: number;
  locationSupport: LocationSupport;
  reviewBucket: ReviewBucket;
  recordFingerprint: string;
  personNameNormalized: string;
  normalizedTitle: string;
  sourceSection: NonprofitSourceSection;
}

/** Foundation-level grant output row */
export interface EnrichedGrant {
  matchedProspectNames: string[];
  matchedProspectIds: string[];
  matchedProspectCompanies: string[];
  matchedProspectCityStates: string[];
  matchedIrsPersonNames: string[];
  matchedIrsPersonAddresses: string[];
  foundationName: string;
  foundationEin: string;
  foundationMatchTier: ConfidenceTier;
  foundationLinkStatus: FoundationLinkStatus;
  foundationLinkNote: string;
  recipientName: string;
  grantAmount: number;
  grantPurpose: string;
  taxPeriod: string;
}
