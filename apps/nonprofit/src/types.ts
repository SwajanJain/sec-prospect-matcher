// Re-export shared types from @pm/core
export type { ProspectRecord, VariantType, PersonNameParts } from "@pm/core";

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
  source: "990-PF-DONOR" | "990-PF-OFFICER" | "990-OFFICER";
  filing: FilingHeader;
  personName: string;
  personNameNormalized: string;
  firstName: string;
  lastName: string;
  middleName: string;
  suffix: string;
  title: string;
  role: string;
  amount: number;
  hoursPerWeek: number;
  city: string;
  state: string;
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
  matchQuality: "Verified" | "Likely Match" | "Review Needed";
  prospectId: string;
  prospectName: string;
  prospectCompany: string;
  recordType: NonprofitRecord["source"];
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
}

/** Enriched grant for grants.csv */
export interface EnrichedGrant {
  prospectName: string;
  prospectId: string;
  foundationName: string;
  foundationEin: string;
  recipientName: string;
  grantAmount: number;
  grantPurpose: string;
  taxPeriod: string;
}
