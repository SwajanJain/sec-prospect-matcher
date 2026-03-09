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

export function deriveLocationSupport(prospect: ProspectRecord, record: NonprofitRecord): LocationSupport {
  const prospectState = prospect.state.trim().toUpperCase();
  const personState = record.state.trim().toUpperCase();
  const orgState = record.filing.orgState.trim().toUpperCase();

  if (!prospectState) return "unknown";
  if (personState) return prospectState === personState ? "strong_person_state" : "mismatch";
  if (orgState) return prospectState === orgState ? "weak_org_state" : "mismatch";
  return "unknown";
}

export function locationSupportScore(locationSupport: LocationSupport): number {
  switch (locationSupport) {
    case "strong_person_state":
      return 15;
    case "weak_org_state":
      return 8;
    case "mismatch":
      return -8;
    default:
      return 0;
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
