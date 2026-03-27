import { ProspectRecord, stripLegalSuffixes } from "@pm/core";
import type { LocationSupport, NonprofitRecord, TitleBucket } from "./types";

const WHITESPACE_RE = /\s+/g;
const FOUNDATION_KEYWORD_RE = /\b(found|foundation|trust|fund|charitable|memorial|family)\b/;

export function normalizeFreeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

export function normalizeTitle(title: string): string {
  return normalizeFreeText(title);
}

export function classifyTitleBucket(title: string, role: string): TitleBucket {
  if (role === "donor") return "board_trustee";

  const normalized = normalizeTitle(title);
  const haystack = `${normalized} ${normalizeFreeText(role)}`.trim();

  if (
    /\b(trustee|director|board|chair|secretary|treasurer|vice chair|member at large)\b/.test(haystack)
  ) {
    return "board_trustee";
  }

  if (
    /\b(ceo|chief executive|president|executive director|head of school|founder|commissioner|chancellor)\b/.test(haystack)
  ) {
    return "executive";
  }

  if (
    /\b(cfo|coo|chief|vp|vice president|provost|dean|principal|superintendent|controller|administrator|officer|headmaster)\b/.test(haystack)
  ) {
    return "senior_staff";
  }

  if (
    /\b(physician|doctor|nurse|professor|teacher|faculty|lecturer|attorney|architect|engineer|counsel|dentist|medical)\b/.test(haystack)
  ) {
    return "professional_staff";
  }

  return "frontline_or_operational";
}

export function normalizeOrgName(name: string): string {
  return normalizeFreeText(stripLegalSuffixes(name));
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeFreeText(value)
      .split(" ")
      .filter((token) => token.length >= 3),
  );
}

export function scoreOrgAffinity(prospect: ProspectRecord, orgName: string): number {
  const normalizedOrg = normalizeOrgName(orgName);
  if (!normalizedOrg) return 0;

  const companyCandidates = prospect.allCompaniesNormalized
    .map((value) => normalizeOrgName(value))
    .filter(Boolean);

  let best = 0;
  for (const company of companyCandidates) {
    if (!company) continue;
    if (company === normalizedOrg) best = Math.max(best, 100);
    else if (company.includes(normalizedOrg) || normalizedOrg.includes(company)) best = Math.max(best, 80);
    else {
      const companyTokens = tokenSet(company);
      const orgTokens = tokenSet(normalizedOrg);
      const overlap = [...companyTokens].filter((token) => orgTokens.has(token)).length;
      if (overlap >= 2) best = Math.max(best, 60);
      else if (overlap >= 1) best = Math.max(best, 35);
    }
  }

  return best;
}

export function scoreFamilyFoundationAffinity(prospect: ProspectRecord, record: NonprofitRecord): number {
  if (record.source === "990-OFFICER") return 0;

  const normalizedOrg = normalizeOrgName(record.filing.orgName);
  if (!normalizedOrg || !FOUNDATION_KEYWORD_RE.test(normalizedOrg)) return 0;

  const lastName = normalizeFreeText(prospect.lastName);
  if (!lastName || lastName.length < 4) return 0;

  if (normalizedOrg.includes(lastName)) return 80;
  return 0;
}

const STATE_NAME_TO_ABBREV: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
  HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA",
  KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO",
  MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
  OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT",
  VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
  WISCONSIN: "WI", WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC",
  "PUERTO RICO": "PR", GUAM: "GU", "VIRGIN ISLANDS": "VI",
  "AMERICAN SAMOA": "AS", "NORTHERN MARIANA ISLANDS": "MP",
};
const VALID_ABBREVS = new Set(Object.values(STATE_NAME_TO_ABBREV));

export function normalizeState(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return "";
  if (VALID_ABBREVS.has(trimmed)) return trimmed;
  return STATE_NAME_TO_ABBREV[trimmed] ?? trimmed;
}

function normalizeCity(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z\s]/g, "").replace(/\s+/g, " ");
}

function normalizeStreet(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, "").replace(/\s+/g, " ");
}

function normalizeZip5(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.slice(0, 5);
}

export function deriveLocationSupport(prospect: ProspectRecord, record: NonprofitRecord): LocationSupport {
  const pState = normalizeState(prospect.state);
  if (!pState) return "unknown";

  const rState = normalizeState(record.state);
  const rCity = normalizeCity(record.city);
  const rStreet = normalizeStreet(record.street ?? "");
  const rZip = normalizeZip5(record.zip ?? "");

  // Person address available on the 990 record
  if (rState) {
    if (pState !== rState) return "mismatch";

    const pCity = normalizeCity(prospect.city);
    const pStreet = normalizeStreet(prospect.address ?? "");
    const pZip = normalizeZip5(prospect.zip ?? "");

    if (pStreet && rStreet && pStreet === rStreet && pCity && rCity && pCity === rCity) {
      return "person_full_address";
    }
    if (pZip && rZip && pZip === rZip && pCity && rCity && pCity === rCity) {
      return "person_city_state_zip";
    }
    if (pCity && rCity && pCity === rCity) {
      return "person_city_state";
    }
    return "person_state";
  }

  // Fall back to org address
  const orgState = normalizeState(record.filing.orgState);
  const orgCity = normalizeCity(record.filing.orgCity);
  if (orgState) {
    if (pState !== orgState) return "mismatch";
    const pCity = normalizeCity(prospect.city);
    if (pCity && orgCity && pCity === orgCity) return "org_city_state";
    return "org_state";
  }

  return "unknown";
}

export function locationSupportScore(locationSupport: LocationSupport): number {
  switch (locationSupport) {
    case "person_full_address":   return 30;
    case "person_city_state_zip": return 25;
    case "person_city_state":     return 18;
    case "person_state":          return 12;
    case "org_city_state":        return 10;
    case "org_state":             return 5;
    case "mismatch":              return -10;
    default:                      return 0;
  }
}

export function buildRecordFingerprint(
  filingId: string,
  source: string,
  personNameNormalized: string,
  normalizedTitle: string,
  amount: number,
  sourceSection: string,
): string {
  return [
    filingId,
    source,
    personNameNormalized,
    normalizedTitle || "-",
    String(amount),
    sourceSection,
  ].join("|");
}

export function buildRecordDedupKey(
  filingId: string,
  source: string,
  personNameNormalized: string,
  normalizedTitle: string,
  amount: number,
): string {
  return [
    filingId,
    source,
    personNameNormalized,
    normalizedTitle || "-",
    String(amount),
  ].join("|");
}
